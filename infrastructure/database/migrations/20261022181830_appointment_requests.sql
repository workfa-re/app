-- Appointment editing and explicit proposals for an already accepted job.
-- Initial assignment remains in confirm_job_engagement; proposals never assign a job.
BEGIN;

CREATE SCHEMA IF NOT EXISTS activity_private;
REVOKE ALL ON SCHEMA activity_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA activity_private TO authenticated, service_role;

CREATE TABLE public.job_appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.job_appointments(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'Europe/Berlin',
  note text,
  appointment_version timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn','superseded')),
  responded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (char_length(COALESCE(note,'')) <= 1000),
  CHECK ((status = 'pending') = (responded_at IS NULL))
);
CREATE UNIQUE INDEX job_appointment_requests_one_pending
  ON public.job_appointment_requests(application_id) WHERE status = 'pending';
CREATE INDEX job_appointment_requests_timeline
  ON public.job_appointment_requests(application_id, created_at DESC);
CREATE INDEX job_appointment_requests_appointment ON public.job_appointment_requests(appointment_id);
CREATE INDEX job_appointment_requests_requester ON public.job_appointment_requests(requested_by);
CREATE INDEX job_appointment_requests_responder ON public.job_appointment_requests(responded_by);
ALTER TABLE public.job_appointment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Appointment participants can read requests" ON public.job_appointment_requests
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.job_engagements e
    WHERE e.application_id = job_appointment_requests.application_id
      AND (e.provider_id = (SELECT auth.uid()) OR e.seeker_id = (SELECT auth.uid()))
  ));
REVOKE ALL ON public.job_appointment_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.job_appointment_requests TO authenticated;
GRANT ALL ON public.job_appointment_requests TO service_role;

-- A proposal belongs to this active collaboration, never to a later reopening.
CREATE FUNCTION activity_private.close_appointment_requests() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.job_appointment_requests SET status = 'superseded', responded_at = now(), responded_by = auth.uid()
    WHERE application_id = NEW.id AND status = 'pending';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION activity_private.close_appointment_requests() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER close_appointment_requests AFTER UPDATE OF status,conversation_state ON public.applications
  FOR EACH ROW WHEN (NEW.status <> 'accepted' OR NEW.conversation_state <> 'open')
  EXECUTE FUNCTION activity_private.close_appointment_requests();

CREATE FUNCTION activity_private.manage_job_appointment(
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
REVOKE ALL ON FUNCTION activity_private.manage_job_appointment(uuid,text,uuid,timestamptz,timestamptz,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION activity_private.manage_job_appointment(uuid,text,uuid,timestamptz,timestamptz,text,uuid) TO authenticated,service_role;

CREATE FUNCTION public.manage_job_appointment(p_application_id uuid,p_action text,p_appointment_id uuid DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,p_ends_at timestamptz DEFAULT NULL,p_note text DEFAULT NULL,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT activity_private.manage_job_appointment(p_application_id,p_action,p_appointment_id,p_starts_at,p_ends_at,p_note,p_request_id);
$$;
REVOKE ALL ON FUNCTION public.manage_job_appointment(uuid,text,uuid,timestamptz,timestamptz,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_job_appointment(uuid,text,uuid,timestamptz,timestamptz,text,uuid) TO authenticated,service_role;

DO $$ BEGIN
  IF EXISTS(SELECT FROM pg_publication WHERE pubname='supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_appointment_requests;
  END IF;
END $$;
COMMIT;
