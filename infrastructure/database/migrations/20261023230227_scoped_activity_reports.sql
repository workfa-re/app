-- Explicit moderation targets, immutable server-side evidence, and private audit.
-- This migration does not send notifications or change conversation/job state.
CREATE SCHEMA IF NOT EXISTS activity_private;
REVOKE ALL ON SCHEMA activity_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA activity_private TO authenticated, service_role;

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('job', 'user', 'conversation', 'message', 'reopen_request'));

-- Existing duplicate rows remain intact. The per-target advisory lock below
-- serializes future inserts without requiring destructive historical cleanup.
CREATE INDEX IF NOT EXISTS idx_reports_pending_reporter_target
  ON public.reports(reporter_user_id, target_type, target_id)
  WHERE status IN ('open', 'reviewing');

-- Old report events already exist in the shared Realtime table. A restrictive
-- policy also protects them when another permissive participant policy applies.
DROP POLICY IF EXISTS application_events_hide_reports ON public.application_events;
CREATE POLICY application_events_hide_reports ON public.application_events
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (event_type <> 'activity_report_created');

REVOKE ALL ON TABLE public.reports FROM anon, authenticated;
GRANT ALL ON TABLE public.reports TO service_role;

CREATE OR REPLACE FUNCTION activity_private.report_activity_item_scoped(
  p_application_id uuid,
  p_scope text,
  p_reason_code text,
  p_details text DEFAULT NULL,
  p_reported_user_id uuid DEFAULT NULL,
  p_message_id uuid DEFAULT NULL,
  p_reopen_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_scope text := lower(btrim(COALESCE(p_scope, '')));
  v_reason_code text := lower(btrim(COALESCE(p_reason_code, '')));
  v_details text := NULLIF(btrim(p_details), '');
  v_app record;
  v_target_type text;
  v_target_id uuid;
  v_reported_user_id uuid;
  v_message record;
  v_request record;
  v_messages jsonb := '[]'::jsonb;
  v_requests jsonb := '[]'::jsonb;
  v_target_evidence jsonb;
  v_evidence jsonb;
  v_report_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF v_scope NOT IN ('person', 'conversation', 'message') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte wähle aus, was du melden möchtest.');
  END IF;
  IF v_reason_code NOT IN ('harassment', 'fraud', 'safety', 'inappropriate', 'spam', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte wähle einen gültigen Meldegrund.');
  END IF;
  IF char_length(COALESCE(v_details, '')) > 1500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Beschreibung darf höchstens 1.500 Zeichen lang sein.');
  END IF;
  IF (v_scope = 'message' AND num_nonnulls(p_message_id, p_reopen_request_id) <> 1)
     OR (v_scope <> 'message' AND num_nonnulls(p_message_id, p_reopen_request_id) <> 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte wähle genau den Inhalt aus, den du melden möchtest.');
  END IF;

  SELECT application.user_id, application.job_id, application.message AS application_message,
    application.created_at AS application_created_at, job.posted_by, job.title AS job_title
  INTO v_app
  FROM public.applications application
  JOIN public.jobs job ON job.id = application.job_id
  WHERE application.id = p_application_id;
  IF NOT FOUND OR (v_user_id IS DISTINCT FROM v_app.user_id AND v_user_id IS DISTINCT FROM v_app.posted_by) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht berechtigt.');
  END IF;
  v_reported_user_id := CASE WHEN v_user_id = v_app.user_id THEN v_app.posted_by ELSE v_app.user_id END;

  IF v_scope = 'message' AND p_reopen_request_id IS NOT NULL THEN
    SELECT request.id, request.requested_by, request.recipient_id, request.message,
      request.created_at, request.status, request.closure_version, request.response_reason,
      request.resolved_at, request.resolved_by
    INTO v_request FROM public.conversation_reopen_requests request
    WHERE request.id = p_reopen_request_id AND request.application_id = p_application_id;
    IF NOT FOUND OR v_request.requested_by <> v_reported_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Öffnungsanfrage nicht gefunden oder nicht meldbar.');
    END IF;
    v_target_type := 'reopen_request';
    v_target_id := p_reopen_request_id;
    v_target_evidence := to_jsonb(v_request);
  ELSIF v_scope = 'message' THEN
    SELECT message.id, message.sender_id, message.kind, message.content, message.created_at,
      message.edited_at, message.deleted_at
    INTO v_message FROM public.messages message
    WHERE message.id = p_message_id AND message.application_id = p_application_id;
    IF NOT FOUND OR v_message.kind NOT IN ('application', 'chat')
       OR v_message.sender_id IS DISTINCT FROM v_reported_user_id OR v_message.deleted_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Nachricht nicht gefunden oder nicht meldbar.');
    END IF;
    v_target_type := 'message';
    v_target_id := p_message_id;
    v_target_evidence := to_jsonb(v_message);
  ELSE
    v_target_type := CASE WHEN v_scope = 'conversation' THEN 'conversation' ELSE 'user' END;
    v_target_id := CASE WHEN v_scope = 'conversation' THEN p_application_id ELSE v_reported_user_id END;
  END IF;
  IF v_reported_user_id IS NULL OR v_reported_user_id = v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Person kann in diesem Gespräch nicht gemeldet werden.');
  END IF;
  IF p_reported_user_id IS NOT NULL AND p_reported_user_id <> v_reported_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Das gemeldete Element gehört nicht zu dieser Person.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'activity-report:' || v_user_id::text || ':' || v_target_type || ':' || v_target_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.reports report
      WHERE report.reporter_user_id = v_user_id AND report.target_type = v_target_type
        AND report.target_id = v_target_id AND report.status IN ('open', 'reviewing')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieses Element wurde bereits gemeldet und wird geprüft.');
  END IF;

  IF v_scope IN ('person', 'conversation') THEN
    -- Both collections use one statement snapshot. Conversation evidence has no
    -- window limit; person context is deliberately bounded and labelled as such.
    SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at, item.id) FROM (
        SELECT message.id, message.sender_id, message.kind, message.content,
          message.created_at, message.edited_at, message.deleted_at
        FROM public.messages message WHERE message.application_id = p_application_id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT CASE WHEN v_scope = 'person' THEN 20 ELSE NULL END
      ) item), '[]'::jsonb),
      COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at, item.id) FROM (
        SELECT request.id, request.requested_by, request.recipient_id, request.message,
          request.created_at, request.status, request.closure_version, request.response_reason,
          request.resolved_at, request.resolved_by
        FROM public.conversation_reopen_requests request WHERE request.application_id = p_application_id
        ORDER BY request.created_at DESC, request.id DESC
        LIMIT CASE WHEN v_scope = 'person' THEN 10 ELSE NULL END
      ) item), '[]'::jsonb)
    INTO v_messages, v_requests;
  END IF;

  v_evidence := jsonb_strip_nulls(jsonb_build_object(
    'version', 2, 'scope', v_scope, 'target_type', v_target_type,
    'application_id', p_application_id, 'job_id', v_app.job_id, 'job_title', v_app.job_title,
    'reporter_user_id', v_user_id, 'reported_user_id', v_reported_user_id,
    'application_message', v_app.application_message, 'application_created_at', v_app.application_created_at,
    'message', CASE WHEN v_target_type = 'message' THEN v_target_evidence ELSE NULL END,
    'reopen_request', CASE WHEN v_target_type = 'reopen_request' THEN v_target_evidence ELSE NULL END,
    'conversation', CASE WHEN v_scope IN ('person', 'conversation') THEN v_messages ELSE NULL END,
    'reopen_requests', CASE WHEN v_scope IN ('person', 'conversation') THEN v_requests ELSE NULL END,
    'context_complete', v_scope = 'conversation',
    'context_limits', CASE WHEN v_scope = 'person' THEN jsonb_build_object('messages', 20, 'reopen_requests', 10) ELSE NULL END
  ));
  INSERT INTO public.reports(reporter_user_id, target_type, target_id, reason_code, details,
    status, application_id, reported_user_id, message_id, reopen_request_id, evidence_snapshot, evidence_captured_at)
  VALUES(v_user_id, v_target_type, v_target_id, v_reason_code, v_details, 'open',
    p_application_id, v_reported_user_id, p_message_id, p_reopen_request_id, v_evidence, clock_timestamp())
  RETURNING id INTO v_report_id;

  -- The reports row is the private audit. Publishing a shared application event
  -- would disclose the reporter and target through participant API/Realtime.
  RETURN jsonb_build_object('ok', true, 'report_id', v_report_id);
END;
$$;
REVOKE ALL ON FUNCTION activity_private.report_activity_item_scoped(uuid,text,text,text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION activity_private.report_activity_item_scoped(uuid,text,text,text,uuid,uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.report_activity_item_scoped(
  p_application_id uuid, p_scope text, p_reason_code text, p_details text DEFAULT NULL,
  p_reported_user_id uuid DEFAULT NULL, p_message_id uuid DEFAULT NULL, p_reopen_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT activity_private.report_activity_item_scoped(p_application_id,p_scope,p_reason_code,p_details,p_reported_user_id,p_message_id,p_reopen_request_id);
$$;
REVOKE ALL ON FUNCTION public.report_activity_item_scoped(uuid,text,text,text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_activity_item_scoped(uuid,text,text,text,uuid,uuid,uuid) TO authenticated, service_role;

-- Keep every old client/target compatible without ambiguous RPC overloads.
CREATE OR REPLACE FUNCTION public.report_activity_item(
  p_application_id uuid, p_reason_code text, p_details text DEFAULT NULL,
  p_reported_user_id uuid DEFAULT NULL, p_message_id uuid DEFAULT NULL, p_reopen_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT activity_private.report_activity_item_scoped(p_application_id,
    CASE WHEN p_message_id IS NOT NULL OR p_reopen_request_id IS NOT NULL THEN 'message' ELSE 'person' END,
    p_reason_code,p_details,p_reported_user_id,p_message_id,p_reopen_request_id);
$$;
REVOKE ALL ON FUNCTION public.report_activity_item(uuid,text,text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_activity_item(uuid,text,text,uuid,uuid,uuid) TO authenticated, service_role;
