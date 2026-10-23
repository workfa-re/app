BEGIN;

-- Events and channel deliveries have separate lifecycles. Turning off the bell
-- must never delete the event needed by a later, explicitly opted-in channel.
CREATE SCHEMA IF NOT EXISTS notification_private;
REVOKE ALL ON SCHEMA notification_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA notification_private TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER TABLE public.notifications
  ADD COLUMN priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 3),
  ADD COLUMN event_type text NOT NULL DEFAULT 'information',
  ADD COLUMN event_key text,
  ADD COLUMN seen_at timestamptz,
  ADD COLUMN in_app_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN inserted_at timestamptz NOT NULL DEFAULT statement_timestamp();

-- Preserve historical IDs, payloads, read state and all recipients. Historical
-- events cannot safely be retroactively deduplicated from human-facing copy.
UPDATE public.notifications
SET event_key = 'legacy:' || id::text,
    created_at = COALESCE(created_at, statement_timestamp()),
    inserted_at = COALESCE(created_at, statement_timestamp()),
    seen_at = read_at,
    priority = CASE
      WHEN type IN ('security', 'security_alert', 'action_required', 'application_new') THEN 1
      WHEN category IN ('applications', 'messages', 'appointments', 'waitlist') THEN 2
      ELSE 3 END;
ALTER TABLE public.notifications
  ALTER COLUMN event_key SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ADD CONSTRAINT notifications_event_key_length CHECK (char_length(event_key) BETWEEN 1 AND 2048);
CREATE UNIQUE INDEX idx_notifications_recipient_event ON public.notifications(user_id, event_key);
CREATE INDEX idx_notifications_visible_feed ON public.notifications(user_id, created_at DESC, id DESC) WHERE in_app_visible;
CREATE INDEX idx_notifications_unseen ON public.notifications(user_id, created_at DESC) WHERE in_app_visible AND seen_at IS NULL;
CREATE INDEX idx_notifications_visible_unread ON public.notifications(user_id) WHERE in_app_visible AND read_at IS NULL;

ALTER TABLE public.notification_preferences
  ADD COLUMN push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN sms_enabled boolean NOT NULL DEFAULT false;

CREATE FUNCTION notification_private.prepare_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_data jsonb := COALESCE(NEW.data, '{}'::jsonb);
  v_preferences public.notification_preferences%ROWTYPE;
  v_request_status text;
  v_entity_version text;
  v_entity_id text;
  v_category text;
BEGIN
  NEW.id := COALESCE(NEW.id, gen_random_uuid());
  NEW.created_at := COALESCE(NEW.created_at, statement_timestamp());
  NEW.inserted_at := statement_timestamp();
  NEW.read_at := NULL;
  NEW.seen_at := NULL;
  NEW.in_app_visible := true;
  NEW.event_key := COALESCE(NULLIF(NEW.event_key, ''), NULLIF(NEW.dedupe_key, ''));
  -- Prefer explicit entity identity over words in a translated title or body.
  v_category := CASE
    WHEN NULLIF(v_data->>'appointment_request_id', '') IS NOT NULL
      OR NULLIF(v_data->>'appointment_id', '') IS NOT NULL THEN 'appointments'
    WHEN NULLIF(v_data->>'reopen_request_id', '') IS NOT NULL THEN 'applications'
    WHEN NEW.type = 'message' OR NULLIF(v_data->>'message_id', '') IS NOT NULL THEN 'messages'
    WHEN NULLIF(v_data->>'application_id', '') IS NOT NULL THEN 'applications'
    WHEN NEW.category IN ('messages', 'applications', 'appointments', 'jobs', 'waitlist') THEN NEW.category
    WHEN NULLIF(v_data->>'job_id', '') IS NOT NULL THEN 'jobs'
    ELSE 'system' END;
  NEW.category := v_category;
  NEW.event_type := CASE
    WHEN NEW.type IN ('security', 'security_alert', 'action_required') THEN 'security'
    WHEN NEW.type = 'application_new' THEN 'application_created'
    WHEN v_category = 'messages' THEN 'message_received'
    WHEN v_category = 'appointments' THEN 'appointment_updated'
    WHEN v_category = 'applications' THEN 'application_updated'
    WHEN v_category = 'jobs' THEN 'job_updated'
    ELSE 'information' END;
  NEW.priority := CASE
    WHEN NEW.event_type IN ('security', 'application_created') THEN 1
    WHEN v_category IN ('messages', 'applications', 'appointments', 'waitlist') THEN 2
    ELSE 3 END;

  IF NULLIF(v_data->>'message_id', '') IS NOT NULL THEN
    v_entity_id := v_data->>'message_id';
    NEW.event_key := COALESCE(NULLIF(NEW.event_key, ''), 'message:' || v_entity_id);
  ELSIF NULLIF(v_data->>'appointment_request_id', '') IS NOT NULL THEN
    v_entity_id := v_data->>'appointment_request_id';
    SELECT request.status INTO v_request_status FROM public.job_appointment_requests request WHERE request.id::text = v_entity_id;
    NEW.event_type := 'appointment_request_' || COALESCE(v_request_status, 'updated');
    NEW.priority := CASE WHEN v_request_status = 'pending' THEN 1 ELSE 2 END;
    NEW.event_key := COALESCE(NULLIF(NEW.event_key, ''), 'appointment-request:' || v_entity_id || ':' || COALESCE(v_request_status, NEW.id::text));
  ELSIF NULLIF(v_data->>'reopen_request_id', '') IS NOT NULL THEN
    v_entity_id := v_data->>'reopen_request_id';
    SELECT request.status INTO v_request_status FROM public.conversation_reopen_requests request WHERE request.id::text = v_entity_id;
    NEW.event_type := 'conversation_request_' || COALESCE(v_request_status, 'updated');
    NEW.priority := CASE WHEN v_request_status = 'pending' THEN 1 ELSE 2 END;
    NEW.event_key := COALESCE(NULLIF(NEW.event_key, ''), 'conversation-request:' || v_entity_id || ':' || COALESCE(v_request_status, NEW.id::text));
  ELSIF NULLIF(v_data->>'appointment_id', '') IS NOT NULL THEN
    v_entity_id := v_data->>'appointment_id';
    SELECT appointment.status || ':' || appointment.updated_at::text INTO v_entity_version FROM public.job_appointments appointment WHERE appointment.id::text = v_entity_id;
    NEW.event_key := COALESCE(NULLIF(NEW.event_key, ''), 'appointment:' || v_entity_id || ':' || COALESCE(v_entity_version, NEW.id::text));
  ELSIF NULLIF(v_data->>'application_id', '') IS NOT NULL THEN
    v_entity_id := v_data->>'application_id';
    SELECT application.status::text || ':' || application.closure_version::text || ':' || application.conversation_state
      INTO v_entity_version FROM public.applications application WHERE application.id::text = v_entity_id;
    NEW.event_key := COALESCE(NULLIF(NEW.event_key, ''), NEW.event_type || ':' || v_entity_id || ':' || COALESCE(v_entity_version, NEW.id::text));
  END IF;
  NEW.event_key := COALESCE(NULLIF(NEW.event_key, ''), NULLIF(NEW.dedupe_key, ''), 'event:' || NEW.id::text);

  SELECT * INTO v_preferences FROM public.notification_preferences WHERE user_id = NEW.user_id;
  IF FOUND AND NEW.event_type <> 'security' THEN
    NEW.in_app_visible := v_preferences.in_app_enabled AND CASE v_category
      WHEN 'messages' THEN v_preferences.in_app_messages
      WHEN 'applications' THEN v_preferences.in_app_application_updates
      WHEN 'appointments' THEN v_preferences.in_app_appointments
      WHEN 'waitlist' THEN v_preferences.in_app_waitlist_updates
      ELSE true END;
  END IF;

  -- Serialize the same logical event without surfacing a unique violation to
  -- the job/message transaction that emitted it. Different events do not wait.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('notification:' || NEW.user_id::text || ':' || NEW.event_key, 0));
  IF EXISTS (SELECT FROM public.notifications event WHERE event.user_id = NEW.user_id AND event.event_key = NEW.event_key) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION notification_private.prepare_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notifications_prepare_delivery ON public.notifications;
DROP FUNCTION IF EXISTS public.prepare_notification_delivery();
CREATE TRIGGER notifications_prepare_delivery BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION notification_private.prepare_event();

-- Public RPCs are invoker wrappers; privileged implementation stays outside
-- the Data API schemas, with an explicit recipient check on every operation.
CREATE FUNCTION notification_private.get_feed(p_limit integer, p_before_created_at timestamptz, p_before_id uuid, p_unread_only boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.'); END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ungültige Seitenauswahl.');
  END IF;
  WITH page AS (
    SELECT n.* FROM public.notifications n WHERE n.user_id = v_user AND n.in_app_visible
      AND (NOT COALESCE(p_unread_only, false) OR n.read_at IS NULL)
      AND (p_before_created_at IS NULL OR (n.created_at, n.id) < (p_before_created_at, p_before_id))
    ORDER BY n.created_at DESC, n.id DESC LIMIT p_limit + 1
  ), selected AS (SELECT * FROM page ORDER BY created_at DESC, id DESC LIMIT p_limit)
  SELECT jsonb_build_object('ok', true,
    'notifications', COALESCE((SELECT jsonb_agg(to_jsonb(selected) ORDER BY created_at DESC, id DESC) FROM selected), '[]'::jsonb),
    'unread_count', (SELECT count(*) FROM public.notifications n WHERE n.user_id = v_user AND n.in_app_visible AND n.read_at IS NULL),
    'has_more', (SELECT count(*) > p_limit FROM page),
    'snapshot_at', statement_timestamp()) INTO v_result;
  RETURN v_result;
END;
$$;
CREATE FUNCTION public.get_notification_feed(p_limit integer DEFAULT 30, p_before_created_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_unread_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT notification_private.get_feed(p_limit, p_before_created_at, p_before_id, p_unread_only);
$$;

CREATE FUNCTION notification_private.mark_seen(p_notification_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_count integer;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.'); END IF;
  IF p_notification_ids IS NULL OR cardinality(p_notification_ids) > 100 THEN RETURN jsonb_build_object('ok', false, 'error', 'Höchstens 100 Hinweise gleichzeitig.'); END IF;
  UPDATE public.notifications SET seen_at = COALESCE(seen_at, statement_timestamp()) WHERE user_id = v_user AND in_app_visible AND id = ANY(p_notification_ids) AND seen_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated_count', v_count);
END;
$$;
CREATE FUNCTION public.mark_notifications_seen(p_notification_ids uuid[])
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT notification_private.mark_seen(p_notification_ids); $$;

CREATE FUNCTION notification_private.mark_read(p_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_count integer;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.'); END IF;
  UPDATE public.notifications SET read_at = COALESCE(read_at, statement_timestamp()), seen_at = COALESCE(seen_at, statement_timestamp()) WHERE id = p_notification_id AND user_id = v_user AND in_app_visible;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_count > 0, 'updated_count', v_count);
END;
$$;
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT notification_private.mark_read(p_notification_id); $$;

CREATE FUNCTION notification_private.mark_read_through(p_snapshot_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_count integer;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.'); END IF;
  IF p_snapshot_at IS NULL OR p_snapshot_at > statement_timestamp() THEN RETURN jsonb_build_object('ok', false, 'error', 'Ungültiger Stand der Hinweise.'); END IF;
  UPDATE public.notifications SET read_at = statement_timestamp(), seen_at = COALESCE(seen_at, statement_timestamp())
  WHERE user_id = v_user AND in_app_visible AND read_at IS NULL AND inserted_at <= p_snapshot_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated_count', v_count);
END;
$$;
CREATE FUNCTION public.mark_notifications_read_through(p_snapshot_at timestamptz)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT notification_private.mark_read_through(p_snapshot_at); $$;
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT notification_private.mark_read_through(statement_timestamp()); $$;

REVOKE ALL ON FUNCTION notification_private.get_feed(integer,timestamptz,uuid,boolean), notification_private.mark_seen(uuid[]), notification_private.mark_read(uuid), notification_private.mark_read_through(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION notification_private.get_feed(integer,timestamptz,uuid,boolean), notification_private.mark_seen(uuid[]), notification_private.mark_read(uuid), notification_private.mark_read_through(timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_notification_feed(integer,timestamptz,uuid,boolean), public.mark_notifications_seen(uuid[]), public.mark_notification_read(uuid), public.mark_notifications_read_through(timestamptz), public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_notification_feed(integer,timestamptz,uuid,boolean), public.mark_notifications_seen(uuid[]), public.mark_notification_read(uuid), public.mark_notifications_read_through(timestamptz), public.mark_all_notifications_read() TO authenticated, service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
-- Keep the recipient policy independent from visibility: Realtime must still
-- deliver an UPDATE that hides a deleted message from an already open feed.
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Keep the existing authorized message RPC as the only writer. The concrete
-- persisted message ID makes retries and chat-read synchronization exact.
CREATE FUNCTION notification_private.send_application_message("p_application_id" "uuid", "p_content" "text", "p_client_nonce" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_app record;
  v_message public.messages%ROWTYPE;
  v_recipient_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_content) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nachricht darf nicht leer sein.');
  END IF;
  IF char_length(v_content) > 1200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Nachricht darf höchstens 1.200 Zeichen lang sein.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.status,
    a.job_id,
    a.is_primary,
    a.conversation_state,
    j.posted_by,
    j.title
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_user_id <> v_app.user_id AND v_user_id <> v_app.posted_by THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht berechtigt.');
  END IF;
  IF v_app.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieses Gespräch ist geschlossen.');
  END IF;
  IF NOT v_app.is_primary OR v_app.status = 'waitlisted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Auf der Warteliste ist nur die Bewerbungsnachricht möglich. Der Chat wird auf Platz 1 freigeschaltet.');
  END IF;
  IF v_app.status NOT IN ('submitted', 'negotiating', 'accepted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieses Gespräch ist nicht für neue Nachrichten geöffnet.');
  END IF;

  IF p_client_nonce IS NOT NULL THEN
    SELECT * INTO v_message
    FROM public.messages
    WHERE sender_id = v_user_id
      AND client_nonce = p_client_nonce;

    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'message', to_jsonb(v_message), 'unchanged', true);
    END IF;
  END IF;

  IF v_user_id = v_app.posted_by AND v_app.status = 'submitted' THEN
    UPDATE public.applications
    SET status = 'negotiating', updated_at = now()
    WHERE id = p_application_id;
  END IF;

  INSERT INTO public.messages (application_id, sender_id, content, kind, client_nonce)
  VALUES (p_application_id, v_user_id, v_content, 'chat', p_client_nonce)
  RETURNING * INTO v_message;

  v_recipient_id := CASE WHEN v_user_id = v_app.user_id THEN v_app.posted_by ELSE v_app.user_id END;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_recipient_id,
    'message',
    'Neue Nachricht zu „' || v_app.title || '“',
    CASE WHEN v_user_id = v_app.user_id
      THEN 'Du hast eine neue Nachricht von einem Bewerber erhalten.'
      ELSE 'Du hast eine neue Nachricht von einem Anbieter erhalten.'
    END,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_app.job_id,
      'message_id', v_message.id,
      'sender_id', v_user_id,
      'job_title', v_app.title,
      'sender_name', (SELECT profile.full_name FROM public.profiles profile WHERE profile.id = v_user_id)
    )
  );

  RETURN jsonb_build_object('ok', true, 'message', to_jsonb(v_message));
END;
$$;
REVOKE ALL ON FUNCTION notification_private.send_application_message(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION notification_private.send_application_message(uuid,text,uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.send_application_message(p_application_id uuid, p_content text, p_client_nonce uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT notification_private.send_application_message(p_application_id, p_content, p_client_nonce);
$$;
REVOKE ALL ON FUNCTION public.send_application_message(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_application_message(uuid,text,uuid) TO authenticated, service_role;

CREATE FUNCTION notification_private.sync_chat_read()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.notifications SET read_at = COALESCE(read_at, statement_timestamp()), seen_at = COALESCE(seen_at, statement_timestamp()), in_app_visible = false
    WHERE event_key = 'message:' || NEW.id::text AND user_id <> NEW.sender_id;
  ELSIF OLD.read_at IS NULL AND NEW.read_at IS NOT NULL THEN
    UPDATE public.notifications SET read_at = COALESCE(read_at, NEW.read_at), seen_at = COALESCE(seen_at, NEW.read_at)
    WHERE event_key = 'message:' || NEW.id::text AND user_id <> NEW.sender_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION notification_private.sync_chat_read() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER messages_sync_notification_read AFTER UPDATE OF read_at,deleted_at ON public.messages FOR EACH ROW
  WHEN ((OLD.read_at IS NULL AND NEW.read_at IS NOT NULL) OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)) EXECUTE FUNCTION notification_private.sync_chat_read();

-- Future external delivery: private outbox, no provider, no sender and no
-- automatic opt-in. Existing email flags are preferences, not delivery proof.
CREATE TABLE notification_private.channel_configuration (
  channel text PRIMARY KEY CHECK (channel IN ('push','sms','email')),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO notification_private.channel_configuration(channel) VALUES ('push'),('sms'),('email');
CREATE TABLE notification_private.channel_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel text NOT NULL REFERENCES notification_private.channel_configuration(channel),
  endpoint_reference text NOT NULL CHECK (char_length(endpoint_reference) BETWEEN 1 AND 2048),
  consented_at timestamptz,
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(user_id,channel,endpoint_reference)
);
CREATE TABLE notification_private.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL REFERENCES notification_private.channel_configuration(channel),
  endpoint_id uuid REFERENCES notification_private.channel_endpoints(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked','pending','processing','sent','failed','cancelled')),
  blocked_reason text,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  locked_at timestamptz,
  delivered_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(notification_id,channel)
);
CREATE INDEX notification_deliveries_pending ON notification_private.deliveries(available_at,id) WHERE status = 'pending';
CREATE INDEX notification_endpoints_user_channel ON notification_private.channel_endpoints(user_id,channel) WHERE revoked_at IS NULL;
ALTER TABLE notification_private.channel_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_private.channel_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_private.deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA notification_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA notification_private TO service_role;

-- This enqueue boundary is deliberately service-only. A future provider must
-- also recheck consent, revocation, read state and quiet hours immediately
-- before sending; no application route or browser can bypass that contract.
CREATE FUNCTION notification_private.enqueue_delivery(p_notification_id uuid, p_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.notifications%ROWTYPE; v_preferences public.notification_preferences%ROWTYPE;
  v_endpoint uuid; v_enabled boolean; v_reason text; v_delivery notification_private.deliveries%ROWTYPE;
BEGIN
  -- Lock eligibility rows in a stable order. A concurrent read/opt-out/revoke
  -- waits for enqueue, then its cancellation trigger sees the committed work.
  SELECT * INTO v_event FROM public.notifications WHERE id = p_notification_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','notification_not_found'); END IF;
  SELECT enabled INTO v_enabled FROM notification_private.channel_configuration WHERE channel = p_channel FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','unsupported_channel'); END IF;
  SELECT * INTO v_preferences FROM public.notification_preferences WHERE user_id = v_event.user_id FOR SHARE;
  SELECT id INTO v_endpoint FROM notification_private.channel_endpoints WHERE user_id = v_event.user_id AND channel = p_channel
    AND consented_at IS NOT NULL AND verified_at IS NOT NULL AND revoked_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
  v_reason := CASE
    WHEN NOT v_enabled THEN 'channel_not_configured'
    WHEN v_preferences.user_id IS NULL OR NOT CASE p_channel WHEN 'push' THEN v_preferences.push_enabled WHEN 'sms' THEN v_preferences.sms_enabled ELSE v_preferences.email_enabled END THEN 'channel_disabled'
    WHEN v_endpoint IS NULL THEN 'verified_consent_required'
    WHEN v_event.read_at IS NOT NULL THEN 'already_read'
    WHEN p_channel = 'email' AND NOT CASE v_event.category
      WHEN 'messages' THEN v_preferences.email_messages WHEN 'applications' THEN v_preferences.email_application_updates
      WHEN 'appointments' THEN v_preferences.email_appointments WHEN 'jobs' THEN v_preferences.email_job_updates
      WHEN 'waitlist' THEN v_preferences.email_waitlist_updates ELSE true END THEN 'category_disabled'
    WHEN v_preferences.quiet_hours_start IS NOT NULL THEN 'quiet_hours_require_scheduler'
    WHEN p_channel = 'email' AND v_preferences.digest_frequency <> 'instant' THEN 'digest_requires_scheduler'
    ELSE NULL END;
  INSERT INTO notification_private.deliveries(notification_id,channel,endpoint_id,status,blocked_reason)
  VALUES(p_notification_id,p_channel,v_endpoint,CASE WHEN v_reason IS NULL THEN 'pending' ELSE 'blocked' END,v_reason)
  ON CONFLICT(notification_id,channel) DO UPDATE SET
    endpoint_id = EXCLUDED.endpoint_id, status = EXCLUDED.status,
    blocked_reason = EXCLUDED.blocked_reason, updated_at = statement_timestamp()
  WHERE deliveries.status IN ('blocked','failed','cancelled') AND deliveries.delivered_at IS NULL AND deliveries.attempts < 10;
  SELECT * INTO v_delivery FROM notification_private.deliveries WHERE notification_id = p_notification_id AND channel = p_channel;
  RETURN jsonb_build_object('ok',true,'delivery_id',v_delivery.id,'status',v_delivery.status,'blocked_reason',v_delivery.blocked_reason);
END;
$$;
REVOKE ALL ON FUNCTION notification_private.enqueue_delivery(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notification_private.enqueue_delivery(uuid,text) TO service_role;

-- Pending external work cannot survive a recipient read or a later opt-out.
-- No channel handler is installed here; these guards are ready for one.
CREATE FUNCTION notification_private.cancel_read_deliveries()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE notification_private.deliveries SET status = 'cancelled', blocked_reason = 'already_read', updated_at = statement_timestamp()
  WHERE notification_id = NEW.id AND status IN ('blocked','pending','processing');
  RETURN NEW;
END;
$$;
CREATE TRIGGER notifications_cancel_read_deliveries AFTER UPDATE OF read_at ON public.notifications
  FOR EACH ROW WHEN (OLD.read_at IS NULL AND NEW.read_at IS NOT NULL) EXECUTE FUNCTION notification_private.cancel_read_deliveries();
CREATE FUNCTION notification_private.cancel_opted_out_deliveries()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE notification_private.deliveries delivery SET status = 'cancelled', blocked_reason = 'channel_disabled', updated_at = statement_timestamp()
  FROM public.notifications event WHERE event.id = delivery.notification_id AND event.user_id = NEW.user_id
    AND delivery.status IN ('blocked','pending','processing') AND (
      (delivery.channel = 'push' AND NOT NEW.push_enabled) OR (delivery.channel = 'sms' AND NOT NEW.sms_enabled)
      OR (delivery.channel = 'email' AND (NOT NEW.email_enabled OR NOT CASE event.category
        WHEN 'messages' THEN NEW.email_messages WHEN 'applications' THEN NEW.email_application_updates
        WHEN 'appointments' THEN NEW.email_appointments WHEN 'jobs' THEN NEW.email_job_updates
        WHEN 'waitlist' THEN NEW.email_waitlist_updates ELSE true END))
    );
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_preferences_cancel_delivery AFTER UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION notification_private.cancel_opted_out_deliveries();
CREATE FUNCTION notification_private.cancel_revoked_endpoint()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.revoked_at IS NOT NULL OR NEW.consented_at IS NULL OR NEW.verified_at IS NULL THEN
    UPDATE notification_private.deliveries SET status = 'cancelled', blocked_reason = 'endpoint_revoked', updated_at = statement_timestamp()
    WHERE endpoint_id = OLD.id AND status IN ('blocked','pending','processing');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_endpoints_cancel_delivery BEFORE UPDATE OR DELETE ON notification_private.channel_endpoints
  FOR EACH ROW EXECUTE FUNCTION notification_private.cancel_revoked_endpoint();
CREATE FUNCTION notification_private.cancel_disabled_channel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE notification_private.deliveries SET status = 'cancelled', blocked_reason = 'channel_not_configured', updated_at = statement_timestamp()
  WHERE channel = NEW.channel AND status IN ('blocked','pending','processing');
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_configuration_cancel_delivery AFTER UPDATE OF enabled ON notification_private.channel_configuration
  FOR EACH ROW WHEN (OLD.enabled AND NOT NEW.enabled) EXECUTE FUNCTION notification_private.cancel_disabled_channel();
REVOKE ALL ON FUNCTION notification_private.cancel_read_deliveries(), notification_private.cancel_opted_out_deliveries(), notification_private.cancel_revoked_endpoint(), notification_private.cancel_disabled_channel() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END; $$;
COMMIT;
