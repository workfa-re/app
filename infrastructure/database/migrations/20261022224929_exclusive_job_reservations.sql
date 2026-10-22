-- Exclusive application reservation. No job queue and no automatic promotion.
-- Historical applications, messages and accepted engagements remain connected.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.jobs, public.applications IN SHARE ROW EXCLUSIVE MODE;
CREATE SCHEMA IF NOT EXISTS activity_private;
REVOKE ALL ON SCHEMA activity_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA activity_private TO authenticated,service_role;

-- A distinct closure reason makes migrated history auditable and non-reopenable.
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_close_action_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_close_action_check CHECK (
  close_action IS NULL OR close_action IN ('provider_rejected','seeker_withdrew','engagement_completed','engagement_cancelled','job_assigned','waitlist_retired')
);
WITH retired AS (
 UPDATE public.applications SET status='auto_rejected', conversation_state='closed',
   rejection_reason='Die Job-Warteliste wurde beendet. Es erfolgte keine Zusage.',
   closed_by=NULL, closed_at=now(), closed_reason='Die Job-Warteliste wurde beendet. Deine Bewerbung bleibt im Archiv erhalten.',
   close_action='waitlist_retired', closed_from_status=status, was_primary_before_close=is_primary,
   closure_version=closure_version+1, is_primary=false, updated_at=now()
 WHERE status='waitlisted' AND conversation_state='open'
 RETURNING id,job_id,queue_position
)
INSERT INTO public.application_events(application_id,event_type,reason,metadata)
 SELECT id,'job_waitlist_retired','Job-Warteliste beendet; keine automatische Zusage.',
   jsonb_build_object('job_id',job_id,'historical_queue_position',queue_position,'migration','exclusive_job_reservations') FROM retired;

-- Historical closed queue rows stay readable; no new queue entries may be created.
ALTER TABLE public.applications ADD CONSTRAINT applications_no_open_waitlist CHECK (status <> 'waitlisted' OR conversation_state='closed');
ALTER TABLE public.applications ADD CONSTRAINT applications_active_reservation_is_primary CHECK (
 conversation_state <> 'open' OR status NOT IN ('submitted','negotiating','accepted') OR is_primary
);
CREATE FUNCTION activity_private.prevent_new_job_waitlist() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='waitlisted' AND (TG_OP='INSERT' OR NEW.conversation_state='open') THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Job-Wartelisten sind nicht mehr verfügbar.';
 END IF;
 IF TG_OP='UPDATE' AND NEW.status='waitlisted' AND OLD.status IS DISTINCT FROM NEW.status THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Job-Wartelisten sind nicht mehr verfügbar.';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION activity_private.prevent_new_job_waitlist() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER prevent_new_job_waitlist BEFORE INSERT OR UPDATE OF status,conversation_state ON public.applications
 FOR EACH ROW EXECUTE FUNCTION activity_private.prevent_new_job_waitlist();
DROP TRIGGER IF EXISTS applications_notify_provider_on_automatic_promotion ON public.applications;
DROP FUNCTION IF EXISTS public.notify_provider_on_automatic_promotion();

-- Keep the existing public job-summary SELECT scope so Realtime can deliver
-- open -> reserved updates to other seekers. Discovery filters strictly to open;
-- applications, participant data and private addresses keep their existing RLS.

-- _activity_close_application
CREATE OR REPLACE FUNCTION activity_private._activity_close_application(p_application_id uuid, p_actor_id uuid, p_action text, p_reason text, p_status public.application_status)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_app record;
  v_rebalance jsonb := NULL;
BEGIN
  IF auth.uid() IS NULL OR p_actor_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok',false,'error','Nicht berechtigt.');
  END IF;
  IF p_action IS NULL OR p_status IS NULL OR NOT ((p_action='provider_rejected' AND p_status='rejected') OR (p_action='seeker_withdrew' AND p_status='withdrawn') OR (p_action='engagement_cancelled' AND p_status='cancelled')) THEN
    RETURN jsonb_build_object('ok',false,'error','Ungültiger Abschluss.');
  END IF;
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.status,
    a.is_primary,
    a.conversation_state,
    a.closed_by,
    a.close_action,
    j.posted_by,
    j.title,
    j.status AS job_status,
    j.filled_by
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;

  IF (p_actor_id <> v_app.user_id AND p_actor_id <> v_app.posted_by) OR (p_action='provider_rejected' AND v_app.posted_by <> p_actor_id) OR (p_action='seeker_withdrew' AND v_app.user_id <> p_actor_id) THEN
    RETURN jsonb_build_object('ok',false,'error','Nicht berechtigt.');
  END IF;

  IF (p_action='engagement_cancelled' AND v_app.status NOT IN ('accepted','cancelled')) OR (p_action IN ('provider_rejected','seeker_withdrew') AND v_app.status='accepted') THEN
    RETURN jsonb_build_object('ok',false,'error','Ungültiger Abschluss für diesen Status.');
  END IF;

  IF v_app.conversation_state = 'closed'
     AND v_app.closed_by = p_actor_id
     AND v_app.close_action = p_action THEN
    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'job_id', v_app.job_id,
      'job_title', v_app.title,
      'seeker_id', v_app.user_id,
      'provider_id', v_app.posted_by
    );
  END IF;

  IF v_app.conversation_state = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieses Gespräch ist bereits geschlossen.');
  END IF;

  UPDATE public.applications
  SET status = p_status,
      rejection_reason = p_reason,
      conversation_state = 'closed',
      closed_by = p_actor_id,
      closed_at = now(),
      closed_reason = p_reason,
      close_action = p_action,
      closed_from_status = v_app.status,
      was_primary_before_close = v_app.is_primary,
      closure_version = closure_version + 1,
      is_primary = false,
      reopened_at = NULL,
      reopened_by = NULL,
      updated_at = now()
  WHERE id = p_application_id;

  UPDATE public.job_engagements
  SET status = 'cancelled',
      cancelled_at = now(),
      closed_by = p_actor_id,
      close_reason = p_reason,
      updated_at = now()
  WHERE application_id = p_application_id
    AND status = 'active';

  UPDATE public.job_appointments appointment
  SET status = 'cancelled',
      updated_at = now()
  FROM public.job_engagements engagement
  WHERE engagement.application_id = p_application_id
    AND appointment.engagement_id = engagement.id
    AND appointment.status = 'scheduled';

  UPDATE public.job_agreements
  SET status = 'cancelled',
      updated_at = now()
  WHERE application_id = p_application_id
    AND status = 'confirmed';

  IF v_app.filled_by = v_app.user_id THEN
    UPDATE public.jobs
    SET status = 'open',
        filled_by = NULL,
        filled_at = NULL,
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_app.job_id;
  END IF;

  INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
  VALUES (
    p_application_id,
    p_actor_id,
    p_action,
    p_reason,
    jsonb_build_object(
      'previous_status', v_app.status,
      'was_primary', v_app.is_primary,
      'job_id', v_app.job_id
    )
  );

  IF v_app.is_primary OR v_app.status = 'accepted' THEN
    v_rebalance := public._activity_rebalance_job(v_app.job_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_app.job_id,
    'job_title', v_app.title,
    'seeker_id', v_app.user_id,
    'provider_id', v_app.posted_by,
    'was_primary', v_app.is_primary,
    'status', p_status,
    'close_action', p_action,
    'rebalance', v_rebalance
  );
END;
$function$;
REVOKE ALL ON FUNCTION activity_private._activity_close_application(uuid,uuid,text,text,public.application_status) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private._activity_close_application(uuid,uuid,text,text,public.application_status) TO service_role;
CREATE OR REPLACE FUNCTION public._activity_close_application(p_application_id uuid, p_actor_id uuid, p_action text, p_reason text, p_status public.application_status) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private._activity_close_application(p_application_id,p_actor_id,p_action,p_reason,p_status);
$$;
REVOKE ALL ON FUNCTION public._activity_close_application(uuid,uuid,text,text,public.application_status) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._activity_close_application(uuid,uuid,text,text,public.application_status) TO service_role;

-- _activity_reopen_application
CREATE OR REPLACE FUNCTION activity_private._activity_reopen_application(p_application_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_app record;
  v_has_other_primary boolean;
  v_new_status public.application_status;
  v_new_primary boolean;
BEGIN
  IF auth.uid() IS NULL OR p_actor_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok',false,'error','Nicht berechtigt.');
  END IF;
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  SELECT
    a.*,
    j.posted_by,
    j.title AS job_title,
    j.status AS job_status,
    j.filled_by,
    j.expires_at AS job_expires_at
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF p_actor_id <> v_app.user_id AND p_actor_id <> v_app.posted_by THEN
    RETURN jsonb_build_object('ok',false,'error','Nicht berechtigt.');
  END IF;
  IF v_app.conversation_state = 'open' THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'application', to_jsonb(v_app));
  END IF;
  IF v_app.closed_by IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur die Person, die das Gespräch geschlossen hat, kann es wieder öffnen.');
  END IF;
  IF v_app.close_action NOT IN ('provider_rejected', 'seeker_withdrew', 'engagement_completed', 'engagement_cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Schließung kann nicht rückgängig gemacht werden.');
  END IF;
  IF v_app.filled_by IS NOT NULL AND v_app.filled_by <> v_app.user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Job ist inzwischen verbindlich anderweitig vergeben.');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.applications other
    WHERE other.job_id = v_app.job_id
      AND other.id <> p_application_id
      AND other.is_primary
      AND other.conversation_state = 'open'
      AND other.status IN ('submitted', 'negotiating', 'accepted')
  ) INTO v_has_other_primary;

  IF v_has_other_primary THEN
    RETURN jsonb_build_object('ok',false,'error','Der Job ist inzwischen für eine andere Person reserviert.');
  END IF;
  IF v_app.job_status='draft' OR (v_app.job_status='closed' AND v_app.close_action <> 'engagement_completed') THEN
    RETURN jsonb_build_object('ok',false,'error','Dieser Job ist nicht mehr geöffnet.');
  END IF;
  IF v_app.job_expires_at IS NOT NULL AND v_app.job_expires_at <= now() AND v_app.close_action <> 'engagement_completed' THEN
    RETURN jsonb_build_object('ok',false,'error','Dieses Angebot ist abgelaufen.');
  END IF;

  IF v_app.close_action = 'engagement_completed' THEN
    IF v_has_other_primary THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Der Platz ist inzwischen anderweitig belegt.');
    END IF;

    UPDATE public.job_engagements
    SET status = 'active',
        completed_at = NULL,
        cancelled_at = NULL,
        closed_by = NULL,
        close_reason = NULL,
        updated_at = now()
    WHERE application_id = p_application_id;

    v_new_status := 'accepted';
    v_new_primary := true;
  ELSIF v_app.filled_by = v_app.user_id THEN
    v_new_status := 'accepted';
    v_new_primary := true;
  ELSE
    v_new_status := 'negotiating';
    v_new_primary := true;
  END IF;

  UPDATE public.applications
  SET status = v_new_status,
      conversation_state = 'open',
      is_primary = v_new_primary,
      rejection_reason = NULL,
      reopened_at = now(),
      reopened_by = p_actor_id,
      closed_by = NULL,
      closed_at = NULL,
      closed_reason = NULL,
      close_action = NULL,
      closed_from_status = NULL,
      was_primary_before_close = false,
      updated_at = now()
  WHERE id = p_application_id;

  IF v_new_status = 'accepted' THEN
    UPDATE public.jobs
    SET status = 'filled',
        filled_by = v_app.user_id,
        filled_at = COALESCE(filled_at, now()),
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_app.job_id;
  ELSIF v_new_primary THEN
    UPDATE public.jobs
    SET status = 'reserved',
        filled_by = NULL,
        filled_at = NULL,
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_app.job_id;
  END IF;

  UPDATE public.conversation_reopen_requests
  SET status = 'accepted',
      resolved_at = now(),
      resolved_by = p_actor_id
  WHERE application_id = p_application_id
    AND closure_version = v_app.closure_version
    AND recipient_id = p_actor_id
    AND status = 'pending';

  INSERT INTO public.application_events (application_id, actor_id, event_type, metadata)
  VALUES (
    p_application_id,
    p_actor_id,
    'conversation_reopened',
    jsonb_build_object(
      'previous_action', v_app.close_action,
      'restored_status', v_new_status,
      'restored_as_primary', v_new_primary,
      'closure_version', v_app.closure_version
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', p_application_id,
    'job_id', v_app.job_id,
    'job_title', v_app.job_title,
    'seeker_id', v_app.user_id,
    'provider_id', v_app.posted_by,
    'status', v_new_status,
    'is_primary', v_new_primary
  );
END;
$function$;
REVOKE ALL ON FUNCTION activity_private._activity_reopen_application(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private._activity_reopen_application(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._activity_reopen_application(p_application_id uuid, p_actor_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private._activity_reopen_application(p_application_id,p_actor_id);
$$;
REVOKE ALL ON FUNCTION public._activity_reopen_application(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._activity_reopen_application(uuid,uuid) TO service_role;

-- complete_job_engagement
CREATE OR REPLACE FUNCTION activity_private.complete_job_engagement(p_application_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'Zusammenarbeit abgeschlossen.');
  v_app record;
  v_engagement public.job_engagements%ROWTYPE;
BEGIN
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Abschlussgrund darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.status,
    a.is_primary,
    a.conversation_state,
    j.posted_by,
    j.title,
    j.job_kind
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.posted_by <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Anbieter kann die Zusammenarbeit abschließen.');
  END IF;
  IF v_app.status = 'completed' AND v_app.conversation_state = 'closed' THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;
  IF v_app.status <> 'accepted' OR v_app.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Es gibt keine aktive Zusammenarbeit zum Abschließen.');
  END IF;

  UPDATE public.job_engagements
  SET status = 'completed',
      completed_at = now(),
      cancelled_at = NULL,
      closed_by = v_user_id,
      close_reason = v_reason,
      updated_at = now()
  WHERE application_id = p_application_id
    AND status = 'active'
  RETURNING * INTO v_engagement;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Zusammenarbeit wurde nicht gefunden.');
  END IF;

  UPDATE public.job_appointments
  SET status = CASE WHEN starts_at <= now() THEN 'completed' ELSE 'cancelled' END,
      updated_at = now()
  WHERE engagement_id = v_engagement.id
    AND status = 'scheduled';

  UPDATE public.job_agreements
  SET status = 'completed', updated_at = now()
  WHERE application_id = p_application_id;

  UPDATE public.applications
  SET status = 'completed',
      conversation_state = 'closed',
      closed_by = v_user_id,
      closed_at = now(),
      closed_reason = v_reason,
      close_action = 'engagement_completed',
      closed_from_status = v_app.status,
      was_primary_before_close = v_app.is_primary,
      closure_version = closure_version + 1,
      is_primary = false,
      updated_at = now()
  WHERE id = p_application_id;

  UPDATE public.jobs
  SET status = 'closed',
      completed_at = now(),
      updated_at = now()
  WHERE id = v_app.job_id;

  INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
  VALUES (
    p_application_id,
    v_user_id,
    'engagement_completed',
    v_reason,
    jsonb_build_object('engagement_id', v_engagement.id, 'job_kind', v_app.job_kind)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_app.user_id,
    'application_status',
    'Zusammenarbeit abgeschlossen',
    'Die Zusammenarbeit zu „' || v_app.title || '“ wurde als abgeschlossen markiert.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_app.job_id,
      'engagement_id', v_engagement.id
    )
  );

  RETURN jsonb_build_object('ok', true, 'engagement', to_jsonb(v_engagement));
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.complete_job_engagement(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.complete_job_engagement(uuid,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.complete_job_engagement(p_application_id uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.complete_job_engagement(p_application_id,p_reason);
$$;
REVOKE ALL ON FUNCTION public.complete_job_engagement(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job_engagement(uuid,text) TO authenticated,service_role;

-- confirm_job_engagement
CREATE OR REPLACE FUNCTION activity_private.confirm_job_engagement(p_application_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_timezone text DEFAULT 'Europe/Berlin'::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_timezone text := COALESCE(NULLIF(btrim(p_timezone), ''), 'Europe/Berlin');
  v_note text := NULLIF(btrim(p_note), '');
  v_app record;
  v_engagement public.job_engagements%ROWTYPE;
  v_appointment public.job_appointments%ROWTYPE;
  v_existing_appointment public.job_appointments%ROWTYPE;
  v_closed_count integer := 0;
BEGIN
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF p_starts_at IS NULL OR p_starts_at < now() - interval '1 minute' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Termin muss in der Zukunft liegen.');
  END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Das Ende muss nach dem Beginn liegen.');
  END IF;
  IF char_length(v_timezone) > 80 OR char_length(COALESCE(v_note, '')) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Termindaten sind zu lang.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_timezone) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unbekannte Zeitzone.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.status,
    a.is_primary,
    a.conversation_state,
    j.posted_by,
    j.title,
    j.status AS job_status,
    j.filled_by,
    j.job_kind
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.posted_by <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Anbieter kann einen Termin festlegen.');
  END IF;
  IF v_app.conversation_state <> 'open'
     OR NOT v_app.is_primary
     OR v_app.status NOT IN ('submitted', 'negotiating', 'accepted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur die aktive Bewerbung auf Platz 1 kann verbindlich vereinbart werden.');
  END IF;
  IF v_app.job_status = 'filled' AND v_app.filled_by IS DISTINCT FROM v_app.user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Job ist bereits anderweitig vergeben.');
  END IF;
  IF v_app.job_status NOT IN ('open', 'reviewing', 'reserved', 'filled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieser Job kann nicht mehr vereinbart werden.');
  END IF;

  INSERT INTO public.job_engagements (
    application_id,
    job_id,
    provider_id,
    seeker_id,
    engagement_type,
    status,
    started_at
  ) VALUES (
    p_application_id,
    v_app.job_id,
    v_app.posted_by,
    v_app.user_id,
    v_app.job_kind,
    'active',
    now()
  )
  ON CONFLICT (application_id) DO UPDATE
  SET job_id = EXCLUDED.job_id,
      provider_id = EXCLUDED.provider_id,
      seeker_id = EXCLUDED.seeker_id,
      engagement_type = EXCLUDED.engagement_type,
      status = 'active',
      completed_at = NULL,
      cancelled_at = NULL,
      closed_by = NULL,
      close_reason = NULL,
      updated_at = now()
  RETURNING * INTO v_engagement;

  IF v_app.job_kind = 'one_time' THEN
    SELECT * INTO v_existing_appointment
    FROM public.job_appointments
    WHERE engagement_id = v_engagement.id
      AND status = 'scheduled'
    ORDER BY starts_at, id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_existing_appointment.id IS NOT NULL THEN
    UPDATE public.job_appointments
    SET starts_at = p_starts_at,
        ends_at = p_ends_at,
        timezone = v_timezone,
        note = v_note,
        status = 'scheduled',
        created_by = v_user_id,
        updated_at = now()
    WHERE id = v_existing_appointment.id
    RETURNING * INTO v_appointment;
  ELSE
    INSERT INTO public.job_appointments (
      engagement_id,
      starts_at,
      ends_at,
      timezone,
      note,
      status,
      created_by
    ) VALUES (
      v_engagement.id,
      p_starts_at,
      p_ends_at,
      v_timezone,
      v_note,
      'scheduled',
      v_user_id
    )
    RETURNING * INTO v_appointment;
  END IF;

  INSERT INTO public.job_agreements (
    application_id,
    job_id,
    provider_id,
    seeker_id,
    starts_at,
    ends_at,
    timezone,
    note,
    status
  ) VALUES (
    p_application_id,
    v_app.job_id,
    v_app.posted_by,
    v_app.user_id,
    p_starts_at,
    p_ends_at,
    v_timezone,
    v_note,
    'confirmed'
  )
  ON CONFLICT (application_id) DO UPDATE
  SET starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      timezone = EXCLUDED.timezone,
      note = EXCLUDED.note,
      status = 'confirmed',
      updated_at = now();

  UPDATE public.applications
  SET status = 'accepted',
      is_primary = true,
      conversation_state = 'open',
      rejection_reason = NULL,
      updated_at = now()
  WHERE id = p_application_id;

  WITH closed AS (
    UPDATE public.applications other
    SET closed_from_status = other.status,
        status = 'auto_rejected',
        rejection_reason = 'Der Job wurde verbindlich vergeben.',
        conversation_state = 'closed',
        closed_by = NULL,
        closed_at = now(),
        closed_reason = 'Der Job wurde verbindlich vergeben.',
        close_action = 'job_assigned',
        was_primary_before_close = other.is_primary,
        closure_version = other.closure_version + 1,
        is_primary = false,
        updated_at = now()
    WHERE other.job_id = v_app.job_id
      AND other.id <> p_application_id
      AND other.conversation_state = 'open'
      AND other.status IN ('submitted', 'negotiating', 'waitlisted')
    RETURNING other.id, other.user_id, other.closed_from_status
  ), logged AS (
    INSERT INTO public.application_events (application_id, event_type, reason, metadata)
    SELECT
      closed.id,
      'job_assigned_elsewhere',
      'Der Job wurde verbindlich vergeben.',
      jsonb_build_object('selected_application_id', p_application_id, 'previous_status', closed.closed_from_status)
    FROM closed
    RETURNING application_id
  )
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    closed.user_id,
    'application_status',
    'Job verbindlich vergeben',
    'Der Job „' || v_app.title || '“ wurde verbindlich an eine andere Person vergeben.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || closed.id::text,
      'application_id', closed.id,
      'job_id', v_app.job_id
    )
  FROM closed;
  GET DIAGNOSTICS v_closed_count = ROW_COUNT;

  UPDATE public.jobs
  SET status = 'filled',
      filled_by = v_app.user_id,
      filled_at = COALESCE(filled_at, now()),
      completed_at = NULL,
      updated_at = now()
  WHERE id = v_app.job_id;

  INSERT INTO public.messages (application_id, sender_id, content, kind)
  VALUES (
    p_application_id,
    v_user_id,
    CASE
      WHEN v_app.job_kind = 'recurring' THEN 'Ein weiterer Termin wurde verbindlich vereinbart.'
      ELSE 'Der Termin wurde verbindlich vereinbart.'
    END,
    'system'
  );

  INSERT INTO public.application_events (application_id, actor_id, event_type, metadata)
  VALUES (
    p_application_id,
    v_user_id,
    'appointment_scheduled',
    jsonb_build_object(
      'engagement_id', v_engagement.id,
      'appointment_id', v_appointment.id,
      'starts_at', p_starts_at,
      'job_kind', v_app.job_kind,
      'closed_other_applications', v_closed_count
    )
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_app.user_id,
    'success',
    CASE WHEN v_app.job_kind = 'recurring' THEN 'Termin zur Zusammenarbeit gespeichert' ELSE 'Termin vereinbart' END,
    'Der Termin für „' || v_app.title || '“ wurde verbindlich gespeichert.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_app.job_id,
      'engagement_id', v_engagement.id,
      'appointment_id', v_appointment.id,
      'starts_at', p_starts_at
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'engagement', to_jsonb(v_engagement),
    'appointment', to_jsonb(v_appointment),
    'scheduled_for', v_appointment.starts_at,
    'agreed_at', v_appointment.updated_at,
    'closed_other_applications', v_closed_count
  );
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.confirm_job_engagement(uuid,timestamp with time zone,timestamp with time zone,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.confirm_job_engagement(uuid,timestamp with time zone,timestamp with time zone,text,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.confirm_job_engagement(p_application_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_timezone text DEFAULT 'Europe/Berlin'::text, p_note text DEFAULT NULL::text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.confirm_job_engagement(p_application_id,p_starts_at,p_ends_at,p_timezone,p_note);
$$;
REVOKE ALL ON FUNCTION public.confirm_job_engagement(uuid,timestamp with time zone,timestamp with time zone,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_job_engagement(uuid,timestamp with time zone,timestamp with time zone,text,text) TO authenticated,service_role;

-- promote_waitlisted_application
CREATE OR REPLACE FUNCTION activity_private.promote_waitlisted_application(p_application_id uuid,p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 RETURN jsonb_build_object('ok',false,'error','Job-Wartelisten sind nicht mehr verfügbar.');
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.promote_waitlisted_application(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.promote_waitlisted_application(uuid,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.promote_waitlisted_application(p_application_id uuid,p_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.promote_waitlisted_application(p_application_id,p_reason);
$$;
REVOKE ALL ON FUNCTION public.promote_waitlisted_application(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.promote_waitlisted_application(uuid,text) TO authenticated,service_role;

-- reject_application
CREATE OR REPLACE FUNCTION activity_private.reject_application(p_application_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := COALESCE(NULLIF(btrim(p_reason),''),'Vom Anbieter abgelehnt.');
  v_app record;
  v_result jsonb;
BEGIN
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Grund darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT a.status, a.conversation_state, a.closed_by, a.close_action, j.posted_by
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.posted_by <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Anbieter kann diese Bewerbung ablehnen.');
  END IF;
  IF ((v_app.status='rejected' AND v_app.close_action='provider_rejected') OR (v_app.status='cancelled' AND v_app.close_action='engagement_cancelled'))
     AND v_app.conversation_state = 'closed'
     AND v_app.closed_by = v_user_id
     THEN
    RETURN jsonb_build_object('ok',true,'unchanged',true,'status',v_app.status,'close_action',v_app.close_action);
  END IF;
  IF v_app.status NOT IN ('submitted', 'negotiating', 'waitlisted', 'accepted')
     OR v_app.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Bewerbung kann nicht abgelehnt werden.');
  END IF;

  IF v_app.status='accepted' AND NULLIF(btrim(p_reason),'') IS NULL THEN v_reason := 'Zusammenarbeit abgesagt.'; END IF;

  v_result := public._activity_close_application(
    p_application_id,
    v_user_id,
    CASE WHEN v_app.status='accepted' THEN 'engagement_cancelled' ELSE 'provider_rejected' END,
    v_reason,
    CASE WHEN v_app.status='accepted' THEN 'cancelled'::public.application_status ELSE 'rejected'::public.application_status END
  );
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RETURN v_result;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    (v_result->>'seeker_id')::uuid,
    'application_status',
    CASE WHEN v_app.status='accepted' THEN 'Zusammenarbeit abgesagt' ELSE 'Bewerbung abgelehnt' END,
    CASE WHEN v_app.status='accepted' THEN 'Die Zusammenarbeit wurde abgesagt. Dein bisheriger Verlauf bleibt erhalten.' ELSE 'Der Anbieter hat die Bewerbung beendet. Dein bisheriger Verlauf bleibt erhalten.' END,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', (v_result->>'job_id')::uuid
    )
  );

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.reject_application(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.reject_application(uuid,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reject_application(p_application_id uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.reject_application(p_application_id,p_reason);
$$;
REVOKE ALL ON FUNCTION public.reject_application(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reject_application(uuid,text) TO authenticated,service_role;

-- reopen_application
CREATE OR REPLACE FUNCTION activity_private.reopen_application(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_recipient_id uuid;
BEGIN
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;

  v_result := public._activity_reopen_application(p_application_id, v_user_id);
  IF NOT COALESCE((v_result->>'ok')::boolean, false)
     OR COALESCE((v_result->>'unchanged')::boolean, false) THEN
    RETURN v_result;
  END IF;

  v_recipient_id := CASE
    WHEN v_user_id = (v_result->>'provider_id')::uuid THEN (v_result->>'seeker_id')::uuid
    ELSE (v_result->>'provider_id')::uuid
  END;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_recipient_id,
    'application_status',
    'Gespräch wieder geöffnet',
    'Das Gespräch zu „' || COALESCE(v_result->>'job_title', 'deinem Job') || '“ ist wieder geöffnet.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', (v_result->>'job_id')::uuid
    )
  );

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.reopen_application(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.reopen_application(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reopen_application(p_application_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.reopen_application(p_application_id);
$$;
REVOKE ALL ON FUNCTION public.reopen_application(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_application(uuid) TO authenticated,service_role;

-- request_conversation_reopen
CREATE OR REPLACE FUNCTION activity_private.request_conversation_reopen(p_application_id uuid, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_message text := btrim(COALESCE(p_message, ''));
  v_app record;
  v_request public.conversation_reopen_requests%ROWTYPE;
BEGIN
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_message) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte beschreibe die Anfrage in mindestens 10 Zeichen.');
  END IF;
  IF char_length(v_message) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Anfrage darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.conversation_state,
    a.closed_by,
    a.close_action,
    a.closure_version,
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
  IF v_app.conversation_state <> 'closed' OR v_app.closed_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Für dieses Gespräch ist keine Öffnungsanfrage möglich.');
  END IF;
  IF v_user_id = v_app.closed_by THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Du kannst das Gespräch direkt wieder öffnen.');
  END IF;
  IF v_app.close_action NOT IN ('provider_rejected', 'seeker_withdrew', 'engagement_completed', 'engagement_cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese systemseitige Schließung kann nicht angefragt werden.');
  END IF;

  INSERT INTO public.conversation_reopen_requests (
    application_id,
    closure_version,
    requested_by,
    recipient_id,
    message
  ) VALUES (
    p_application_id,
    v_app.closure_version,
    v_user_id,
    v_app.closed_by,
    v_message
  )
  RETURNING * INTO v_request;

  INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
  VALUES (
    p_application_id,
    v_user_id,
    'conversation_reopen_requested',
    v_message,
    jsonb_build_object('request_id', v_request.id, 'closure_version', v_app.closure_version)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_app.closed_by,
    'message',
    'Anfrage zum geschlossenen Gespräch',
    'Du hast eine einmalige Öffnungsanfrage zu „' || v_app.title || '“ erhalten.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_app.job_id,
      'reopen_request_id', v_request.id
    )
  );

  RETURN jsonb_build_object('ok', true, 'request', to_jsonb(v_request));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Für diese Schließung wurde bereits eine Anfrage gesendet.');
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.request_conversation_reopen(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.request_conversation_reopen(uuid,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.request_conversation_reopen(p_application_id uuid, p_message text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.request_conversation_reopen(p_application_id,p_message);
$$;
REVOKE ALL ON FUNCTION public.request_conversation_reopen(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_conversation_reopen(uuid,text) TO authenticated,service_role;

-- respond_to_conversation_reopen_request
CREATE OR REPLACE FUNCTION activity_private.respond_to_conversation_reopen_request(p_request_id uuid, p_accept boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := NULLIF(btrim(p_reason), '');
  v_request public.conversation_reopen_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Same job-first order as claim, release, confirmation and reopening.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  JOIN public.conversation_reopen_requests lock_request ON lock_request.application_id=lock_app.id
  WHERE lock_request.id=p_request_id AND lock_request.recipient_id=auth.uid() FOR UPDATE OF lock_job;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(COALESCE(v_reason, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Antwort darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT * INTO v_request
  FROM public.conversation_reopen_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Anfrage nicht gefunden.');
  END IF;
  IF v_request.recipient_id <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Empfänger kann diese Anfrage beantworten.');
  END IF;
  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Anfrage wurde bereits beantwortet.');
  END IF;

  IF p_accept THEN
    v_result := public._activity_reopen_application(v_request.application_id, v_user_id);
    IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
      RETURN v_result;
    END IF;
  ELSE
    UPDATE public.conversation_reopen_requests
    SET status = 'declined',
        response_reason = v_reason,
        resolved_at = now(),
        resolved_by = v_user_id
    WHERE id = p_request_id;

    INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
    VALUES (
      v_request.application_id,
      v_user_id,
      'conversation_reopen_declined',
      v_reason,
      jsonb_build_object('request_id', p_request_id, 'closure_version', v_request.closure_version)
    );

    v_result := jsonb_build_object('ok', true, 'accepted', false);
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_request.requested_by,
    'application_status',
    CASE WHEN p_accept THEN 'Gespräch wieder geöffnet' ELSE 'Öffnungsanfrage beantwortet' END,
    CASE
      WHEN p_accept THEN 'Deine Anfrage wurde angenommen. Du kannst wieder schreiben.'
      ELSE 'Deine Anfrage wurde abgelehnt.' || CASE WHEN v_reason IS NULL THEN '' ELSE ' Grund: ' || v_reason END
    END,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || v_request.application_id::text,
      'application_id', v_request.application_id,
      'reopen_request_id', p_request_id
    )
  );

  RETURN v_result || jsonb_build_object('request_id', p_request_id, 'accepted', p_accept);
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.respond_to_conversation_reopen_request(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.respond_to_conversation_reopen_request(uuid,boolean,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.respond_to_conversation_reopen_request(p_request_id uuid, p_accept boolean, p_reason text DEFAULT NULL::text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.respond_to_conversation_reopen_request(p_request_id,p_accept,p_reason);
$$;
REVOKE ALL ON FUNCTION public.respond_to_conversation_reopen_request(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_conversation_reopen_request(uuid,boolean,text) TO authenticated,service_role;

-- submit_job_application
CREATE OR REPLACE FUNCTION activity_private.submit_job_application(p_job_id uuid, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_message_text text := btrim(COALESCE(p_message, ''));
  v_job public.jobs%ROWTYPE;
  v_queue_position integer;
  v_is_primary boolean;
  v_status public.application_status;
  v_application public.applications%ROWTYPE;
  v_message public.messages%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_message_text) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte schreibe eine kurze Bewerbungsnachricht.');
  END IF;
  IF char_length(v_message_text) > 1200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Bewerbungsnachricht darf höchstens 1.200 Zeichen lang sein.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.account_type::text = 'job_seeker'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur Jobsuchende können sich bewerben.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_relationships relationship
    WHERE relationship.child_id = v_user_id
      AND relationship.status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vor der Bewerbung fehlt die aktive Elternbestätigung.');
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job nicht gefunden.');
  END IF;
  IF v_job.posted_by = v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Du kannst dich nicht auf deinen eigenen Job bewerben.');
  END IF;
  IF v_job.status = 'reserved' THEN
    RETURN jsonb_build_object('ok',false,'error','Dieser Job ist bereits für eine Person reserviert. Schau nach anderen offenen Jobs.','code','job_reserved');
  END IF;
  IF v_job.status <> 'open' OR (v_job.expires_at IS NOT NULL AND v_job.expires_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieser Job nimmt derzeit keine Bewerbungen an.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.job_id = p_job_id AND a.user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Du hast dich bereits auf diesen Job beworben. Öffne den Vorgang unter Meine Jobs.');
  END IF;

  SELECT COALESCE(max(a.queue_position), 0) + 1
  INTO v_queue_position
  FROM public.applications a
  WHERE a.job_id = p_job_id;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.job_id = p_job_id
      AND a.is_primary
      AND a.conversation_state = 'open'
      AND a.status IN ('submitted', 'negotiating', 'accepted')
  ) INTO v_is_primary;

  IF NOT v_is_primary THEN
    RETURN jsonb_build_object('ok',false,'error','Dieser Job ist bereits reserviert.');
  END IF;

  v_status := 'negotiating'::public.application_status;

  INSERT INTO public.applications (
    job_id,
    user_id,
    message,
    status,
    queue_position,
    is_primary,
    conversation_state,
    last_activity_at,
    updated_at
  ) VALUES (
    p_job_id,
    v_user_id,
    v_message_text,
    v_status,
    v_queue_position,
    v_is_primary,
    'open',
    now(),
    now()
  )
  RETURNING * INTO v_application;

  INSERT INTO public.messages (application_id, sender_id, content, kind)
  VALUES (v_application.id, v_user_id, v_message_text, 'application')
  RETURNING * INTO v_message;

  IF v_is_primary THEN
    UPDATE public.jobs
    SET status = 'reserved',
        hiring_mode = 'first_come',
        updated_at = now()
    WHERE id = p_job_id;
  END IF;

  INSERT INTO public.application_events (application_id, actor_id, event_type, metadata)
  VALUES (
    v_application.id,
    v_user_id,
    'application_submitted',
    jsonb_build_object(
      'queue_position', v_queue_position,
      'is_primary', v_is_primary,
      'job_id', p_job_id
    )
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_job.posted_by,
    'application_new',
    'Neue Bewerbung',
    'Für „' || v_job.title || '“ ist eine Bewerbung eingegangen. Der Job ist bis zur Klärung reserviert.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || v_application.id::text,
      'application_id', v_application.id,
      'job_id', p_job_id,
      'queue_position', v_queue_position,
      'is_primary', v_is_primary
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'application', to_jsonb(v_application),
    'message', to_jsonb(v_message),
    'queue_position', v_queue_position,
    'is_primary', v_is_primary
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Du hast dich bereits auf diesen Job beworben.');
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.submit_job_application(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.submit_job_application(uuid,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.submit_job_application(p_job_id uuid, p_message text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.submit_job_application(p_job_id,p_message);
$$;
REVOKE ALL ON FUNCTION public.submit_job_application(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_job_application(uuid,text) TO authenticated,service_role;

-- withdraw_application
CREATE OR REPLACE FUNCTION activity_private.withdraw_application(p_application_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'Bewerbung zurückgezogen.');
  v_app record;
  v_result jsonb;

  v_body text;
BEGIN
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Grund darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT
    a.user_id,
    a.status,
    a.conversation_state,
    a.closed_by,
    a.close_action,
    COALESCE(NULLIF(btrim(p.full_name), ''), 'Eine Person') AS display_name
  INTO v_app
  FROM public.applications a
  JOIN public.profiles p ON p.id = a.user_id
  WHERE a.id = p_application_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.user_id <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Bewerber kann diese Bewerbung zurückziehen.');
  END IF;
  IF ((v_app.status='withdrawn' AND v_app.close_action='seeker_withdrew') OR (v_app.status='cancelled' AND v_app.close_action='engagement_cancelled'))
     AND v_app.conversation_state = 'closed'
     AND v_app.closed_by = v_user_id
     THEN
    RETURN jsonb_build_object('ok',true,'unchanged',true,'status',v_app.status,'close_action',v_app.close_action);
  END IF;
  IF v_app.status NOT IN ('submitted', 'negotiating', 'waitlisted', 'accepted')
     OR v_app.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Bewerbung kann nicht zurückgezogen werden.');
  END IF;

  IF v_app.status='accepted' AND NULLIF(btrim(p_reason),'') IS NULL THEN v_reason := 'Zusammenarbeit abgesagt.'; END IF;

  v_result := public._activity_close_application(
    p_application_id,
    v_user_id,
    CASE WHEN v_app.status='accepted' THEN 'engagement_cancelled' ELSE 'seeker_withdrew' END,
    v_reason,
    CASE WHEN v_app.status='accepted' THEN 'cancelled'::public.application_status ELSE 'withdrawn'::public.application_status END
  );
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RETURN v_result;
  END IF;

  v_body := split_part(v_app.display_name,' ',1) || CASE WHEN v_app.status='accepted' THEN ' hat die Zusammenarbeit zu „' ELSE ' hat die Bewerbung für „' END
    || COALESCE(v_result->>'job_title','deinem Job') || CASE WHEN v_app.status='accepted' THEN '“ abgesagt.' ELSE '“ zurückgezogen.' END;
  IF v_result->'rebalance'->>'action'='job_reopened' THEN
    v_body := v_body || ' Das Angebot ist wieder für neue Bewerbungen geöffnet.';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data, category)
  VALUES (
    (v_result->>'provider_id')::uuid,
    'application_status',
    CASE WHEN v_app.status='accepted' THEN 'Zusammenarbeit abgesagt' ELSE 'Bewerbung zurückgezogen' END,
    v_body,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', (v_result->>'job_id')::uuid,
      'closed_application_id', p_application_id
    ),
    'applications'
  );

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION activity_private.withdraw_application(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private.withdraw_application(uuid,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.withdraw_application(p_application_id uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private.withdraw_application(p_application_id,p_reason);
$$;
REVOKE ALL ON FUNCTION public.withdraw_application(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_application(uuid,text) TO authenticated,service_role;

-- Compatibility helper now only reconciles exclusive ownership. It never reads the retired queue.
CREATE FUNCTION activity_private._activity_rebalance_job(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_primary public.applications%ROWTYPE;
BEGIN
 SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Job nicht gefunden.'); END IF;
 IF v_job.status IN ('draft','closed') THEN RETURN jsonb_build_object('ok',true,'action','unchanged'); END IF;
 SELECT * INTO v_primary FROM public.applications WHERE job_id=p_job_id AND is_primary
   AND conversation_state='open' AND status IN ('submitted','negotiating','accepted') LIMIT 1 FOR UPDATE;
 IF FOUND THEN
   UPDATE public.jobs SET status=CASE WHEN v_primary.status='accepted' THEN 'filled'::public.job_status ELSE 'reserved'::public.job_status END,
     filled_by=CASE WHEN v_primary.status='accepted' THEN v_primary.user_id ELSE NULL END,
     filled_at=CASE WHEN v_primary.status='accepted' THEN COALESCE(filled_at,now()) ELSE NULL END,updated_at=now() WHERE id=p_job_id;
   RETURN jsonb_build_object('ok',true,'action','primary_kept','application_id',v_primary.id);
 END IF;
 UPDATE public.jobs SET status='open',filled_by=NULL,filled_at=NULL,completed_at=NULL,updated_at=now()
   WHERE id=p_job_id AND status IN ('reserved','reviewing','filled');
 RETURN jsonb_build_object('ok',true,'action','job_reopened');
END;
$$;
REVOKE ALL ON FUNCTION activity_private._activity_rebalance_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION activity_private._activity_rebalance_job(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._activity_rebalance_job(p_job_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT activity_private._activity_rebalance_job(p_job_id);
$$;
REVOKE ALL ON FUNCTION public._activity_rebalance_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._activity_rebalance_job(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._rebalance_job_after_application_exit(p_job_id uuid,p_exiting_user_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT activity_private._activity_rebalance_job(p_job_id); $$;
REVOKE ALL ON FUNCTION public._rebalance_job_after_application_exit(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._rebalance_job_after_application_exit(uuid,uuid) TO service_role;

-- Remove stale reserved flags only when no participant owns a live reservation.
UPDATE public.jobs j SET status='open',filled_by=NULL,filled_at=NULL,updated_at=now()
 WHERE j.status='reserved' AND NOT EXISTS(SELECT FROM public.applications a WHERE a.job_id=j.id AND a.is_primary
   AND a.conversation_state='open' AND a.status IN ('submitted','negotiating','accepted'));

-- Legacy clients may still request this projection; it no longer exposes queue data.
CREATE OR REPLACE FUNCTION public.get_waitlist_job_summaries(p_job_ids uuid[])
RETURNS TABLE(job_id uuid,waitlist_count bigint,next_position bigint,conversation_active boolean,my_waitlist_position bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT j.id,0::bigint,1::bigint,EXISTS(SELECT FROM public.applications a WHERE a.job_id=j.id AND a.is_primary AND a.conversation_state='open'),NULL::bigint
 FROM public.jobs j WHERE auth.uid() IS NOT NULL AND j.id=ANY(COALESCE(p_job_ids,ARRAY[]::uuid[]));
$$;
REVOKE ALL ON FUNCTION public.get_waitlist_job_summaries(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_waitlist_job_summaries(uuid[]) TO authenticated,service_role;

-- Retain appointment semantics while aligning the lock order.
CREATE OR REPLACE FUNCTION activity_private.manage_job_appointment(
  p_application_id uuid,
  p_action text,
  p_appointment_id uuid DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_app record;
  v_appointment public.job_appointments%ROWTYPE;
  v_request public.job_appointment_requests%ROWTYPE;
  v_next public.job_appointments%ROWTYPE;
  v_note text := NULLIF(btrim(p_note), '');
  v_start timestamptz := p_starts_at;
  v_end timestamptz := p_ends_at;
  v_target uuid := p_appointment_id;
  v_recipient uuid;
  v_message text;
  v_result jsonb;
BEGIN
  -- All lifecycle writers lock the job before application/request rows.
  PERFORM 1 FROM public.jobs lock_job JOIN public.applications lock_app ON lock_app.job_id=lock_job.id
  WHERE lock_app.id=p_application_id AND (lock_app.user_id=auth.uid() OR lock_job.posted_by=auth.uid())
  FOR UPDATE OF lock_job;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Nicht authentifiziert.');
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('propose','accept','decline','withdraw','update','cancel','add') THEN
    RETURN jsonb_build_object('ok',false,'error','Unbekannte Terminaktion.');
  END IF;
  IF p_action = 'add' AND p_appointment_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Ein neuer Termin darf keinen bestehenden Termin überschreiben.');
  END IF;
  SELECT a.status, a.conversation_state, a.is_primary, j.title, j.id AS job_id,
    j.status AS job_status, j.filled_by, e.id AS engagement_id, e.status AS engagement_status,
    e.provider_id, e.seeker_id, e.engagement_type
  INTO v_app FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  JOIN public.job_engagements e ON e.application_id = a.id
  WHERE a.id = p_application_id FOR UPDATE OF a,j,e;
  IF NOT FOUND OR (v_user <> v_app.provider_id AND v_user <> v_app.seeker_id) THEN
    RETURN jsonb_build_object('ok',false,'error','Dieser Termin ist nicht verfügbar.');
  END IF;
  IF v_app.status <> 'accepted' OR v_app.conversation_state <> 'open'
    OR NOT v_app.is_primary OR v_app.engagement_status <> 'active'
    OR v_app.job_status <> 'filled' OR v_app.filled_by IS DISTINCT FROM v_app.seeker_id THEN
    RETURN jsonb_build_object('ok',false,'error','Termine sind nur in einer laufenden Zusammenarbeit bearbeitbar.');
  END IF;
  IF p_action IN ('accept','decline','update','cancel','add') AND v_user <> v_app.provider_id THEN
    RETURN jsonb_build_object('ok',false,'error','Nur der Anbieter kann einen Termin verbindlich ändern.');
  END IF;
  IF p_action = 'propose' AND v_user <> v_app.seeker_id THEN
    RETURN jsonb_build_object('ok',false,'error','Als Anbieter kannst du den Termin direkt bearbeiten.');
  END IF;

  IF p_action IN ('accept','decline','withdraw') THEN
    SELECT * INTO v_request FROM public.job_appointment_requests
    WHERE id = p_request_id AND application_id = p_application_id FOR UPDATE;
    IF NOT FOUND OR v_request.status <> 'pending' THEN
      RETURN jsonb_build_object('ok',false,'error','Diese Terminanfrage ist nicht mehr offen.');
    END IF;
    IF p_action = 'withdraw' AND v_request.requested_by <> v_user THEN
      RETURN jsonb_build_object('ok',false,'error','Du kannst nur deine eigene Anfrage zurückziehen.');
    END IF;
    IF p_action = 'accept' THEN
      v_target := v_request.appointment_id;
      v_start := v_request.starts_at;
      v_end := v_request.ends_at;
      v_note := v_request.note;
    ELSE
      UPDATE public.job_appointment_requests SET status = CASE p_action WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END,
        responded_by = v_user, responded_at = now() WHERE id = v_request.id RETURNING * INTO v_request;
      v_message := CASE p_action WHEN 'decline' THEN 'Der Terminvorschlag wurde abgelehnt. Der bisherige Termin bleibt bestehen.' ELSE 'Der Terminvorschlag wurde zurückgezogen.' END;
    END IF;
  END IF;

  IF p_action IN ('propose','accept','update','add') THEN
    IF v_start IS NULL OR v_start < now() - interval '1 minute' THEN
      RETURN jsonb_build_object('ok',false,'error','Der Termin muss in der Zukunft liegen.');
    END IF;
    IF v_end IS NOT NULL AND v_end <= v_start THEN
      RETURN jsonb_build_object('ok',false,'error','Das Ende muss nach dem Beginn liegen.');
    END IF;
    IF char_length(COALESCE(v_note,'')) > 1000 THEN
      RETURN jsonb_build_object('ok',false,'error','Die Termininformation darf höchstens 1.000 Zeichen lang sein.');
    END IF;
  END IF;
  IF v_target IS NOT NULL AND p_action IN ('propose','accept','update','cancel') THEN
    SELECT * INTO v_appointment FROM public.job_appointments
    WHERE id = v_target AND engagement_id = v_app.engagement_id FOR UPDATE;
    IF NOT FOUND OR v_appointment.status <> 'scheduled' THEN
      RETURN jsonb_build_object('ok',false,'error','Dieser Termin kann nicht mehr geändert werden.');
    END IF;
    IF p_action = 'accept' AND v_appointment.updated_at IS DISTINCT FROM v_request.appointment_version THEN
      RETURN jsonb_build_object('ok',false,'error','Der Termin wurde inzwischen geändert. Bitte prüfe die aktuellen Angaben.');
    END IF;
  ELSIF p_action IN ('update','cancel') THEN
    RETURN jsonb_build_object('ok',false,'error','Bitte wähle den zu bearbeitenden Termin.');
  END IF;
  IF p_action IN ('propose','accept','add') AND v_target IS NULL AND v_app.engagement_type = 'one_time'
    AND EXISTS (SELECT FROM public.job_appointments WHERE engagement_id = v_app.engagement_id AND status = 'scheduled') THEN
    RETURN jsonb_build_object('ok',false,'error','Bitte bearbeite bei diesem einmaligen Job den bestehenden Termin.');
  END IF;

  IF p_action = 'propose' THEN
    IF EXISTS (SELECT FROM public.job_appointment_requests WHERE application_id = p_application_id AND status = 'pending') THEN
      RETURN jsonb_build_object('ok',false,'error','Es gibt bereits einen offenen Vorschlag. Du kannst ihn zuerst zurückziehen.');
    END IF;
    INSERT INTO public.job_appointment_requests(application_id,appointment_id,requested_by,starts_at,ends_at,note,appointment_version)
    VALUES(p_application_id,v_target,v_user,v_start,v_end,v_note,v_appointment.updated_at) RETURNING * INTO v_request;
    v_message := CASE WHEN v_target IS NULL THEN 'Ein weiterer Termin wurde angefragt.' ELSE 'Eine Terminänderung wurde angefragt. Der bisherige Termin bleibt bis zur Bestätigung bestehen.' END;
  ELSIF p_action IN ('accept','update','cancel','add') THEN
    IF v_target IS NULL THEN
      v_result := public.confirm_job_engagement(p_application_id,v_start,v_end,'Europe/Berlin',v_note);
      IF COALESCE((v_result->>'ok')::boolean,false) = false THEN RETURN v_result; END IF;
      SELECT * INTO v_appointment FROM public.job_appointments WHERE id = (v_result->'appointment'->>'id')::uuid;
      -- confirm_job_engagement already emits the scheduling system message.
    ELSE
      UPDATE public.job_appointments SET
        starts_at = CASE WHEN p_action = 'cancel' THEN starts_at ELSE v_start END,
        ends_at = CASE WHEN p_action = 'cancel' THEN ends_at ELSE v_end END,
        note = CASE WHEN p_action = 'cancel' THEN note ELSE v_note END,
        status = CASE WHEN p_action = 'cancel' THEN 'cancelled' ELSE 'scheduled' END,
        updated_at = now()
      WHERE id = v_target RETURNING * INTO v_appointment;
      v_message := CASE WHEN p_action = 'cancel' THEN 'Der Termin wurde abgesagt. Die Zusammenarbeit bleibt geöffnet.' ELSE 'Der Termin wurde aktualisiert.' END;
      SELECT * INTO v_next FROM public.job_appointments WHERE engagement_id = v_app.engagement_id AND status = 'scheduled'
        ORDER BY CASE WHEN starts_at >= now() THEN 0 ELSE 1 END,
          CASE WHEN starts_at >= now() THEN starts_at END ASC, starts_at DESC LIMIT 1;
      UPDATE public.job_agreements SET
        starts_at = COALESCE(v_next.starts_at,starts_at), ends_at = v_next.ends_at,
        note = COALESCE(v_next.note,note), status = CASE WHEN v_next.id IS NULL THEN 'cancelled' ELSE 'confirmed' END,
        updated_at = now() WHERE application_id = p_application_id;
    END IF;
    IF p_action = 'accept' THEN
      UPDATE public.job_appointment_requests SET status = 'accepted', responded_at = now(), responded_by = v_user
        WHERE id = v_request.id RETURNING * INTO v_request;
    ELSE
      UPDATE public.job_appointment_requests SET status = 'superseded', responded_at = now(), responded_by = v_user
        WHERE application_id = p_application_id AND status = 'pending'
          AND (appointment_id = v_target OR (appointment_id IS NULL AND p_action = 'add'));
    END IF;
  END IF;

  IF v_message IS NOT NULL THEN
    INSERT INTO public.messages(application_id,sender_id,content,kind) VALUES(p_application_id,v_user,v_message,'system');
  END IF;
  INSERT INTO public.application_events(application_id,actor_id,event_type,metadata)
    VALUES(p_application_id,v_user,'appointment_' || p_action,
      jsonb_build_object('appointment_id',v_appointment.id,'request_id',v_request.id,'starts_at',v_start));
  v_recipient := CASE WHEN v_user = v_app.provider_id THEN v_app.seeker_id ELSE v_app.provider_id END;
  -- New appointments are already notified by confirm_job_engagement.
  IF NOT (p_action IN ('accept','add') AND v_target IS NULL) THEN
    INSERT INTO public.notifications(user_id,type,title,body,data) VALUES(v_recipient,'info',
      CASE WHEN p_action = 'propose' THEN 'Neuer Terminvorschlag' ELSE 'Termin aktualisiert' END,
      COALESCE(v_message,'Die Terminangaben wurden aktualisiert.'),
      jsonb_build_object('route','/app-home/activities?conversation=' || p_application_id::text,
        'application_id',p_application_id,'job_id',v_app.job_id,'engagement_id',v_app.engagement_id,
        'appointment_id',v_appointment.id,'appointment_request_id',v_request.id));
  END IF;
  RETURN jsonb_build_object('ok',true,
    'request',CASE WHEN v_request.id IS NOT NULL THEN to_jsonb(v_request) ELSE NULL END,
    'appointment',CASE WHEN p_action IN ('accept','update','cancel','add') AND v_appointment.id IS NOT NULL THEN to_jsonb(v_appointment) ELSE NULL END);
END;
$$;

COMMIT;
