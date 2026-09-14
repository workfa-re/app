-- ONLY the isolated local Workfare demo database. Never production.
-- Source is schema-only; no source rows or credentials are copied.
-- Apply after reviewing the source fingerprint and granting explicit local execution.
-- This overlay intentionally has no migration-ledger entry during iteration.
BEGIN;
SET LOCAL row_security = on;
DO $$
BEGIN
  IF current_setting('workfare.demo_target', true) IS DISTINCT FROM 'isolated-local-demo' THEN
    RAISE EXCEPTION 'Set workfare.demo_target=isolated-local-demo explicitly on the local target connection';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('demo_executor','demo_scope_reader')) THEN
    RAISE EXCEPTION 'Demo roles already exist; review/rebuild the isolated target instead of applying twice';
  END IF;
END $$;
CREATE ROLE demo_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE demo_scope_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT demo_executor,demo_scope_reader TO postgres WITH SET TRUE;
CREATE SCHEMA demo_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA demo_private FROM PUBLIC;
GRANT USAGE ON SCHEMA public, auth, extensions, demo_private TO demo_executor;
GRANT CREATE ON SCHEMA public TO demo_executor;
GRANT USAGE ON SCHEMA auth, demo_private TO demo_scope_reader;
GRANT CREATE ON SCHEMA demo_private TO demo_scope_reader;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO demo_scope_reader,demo_executor;
GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(integer) TO demo_executor;
GRANT USAGE ON SCHEMA demo_private TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA demo_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE demo_private.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  rate_key text NOT NULL CHECK (rate_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT statement_timestamp() + interval '24 hours',
  seeded_at timestamptz,
  seed_result jsonb,
  revoked_at timestamptz,
  cleanup_requested_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX demo_visits_rate_created ON demo_private.visits(rate_key,created_at);
CREATE INDEX demo_visits_expiry ON demo_private.visits(expires_at);
CREATE TABLE demo_private.admission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_key text NOT NULL CHECK (rate_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX demo_admission_rate_created ON demo_private.admission_events(rate_key,created_at);
CREATE TABLE demo_private.personas (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES demo_private.visits(id) ON DELETE CASCADE,
  persona text NOT NULL CHECK (persona IN ('seeker','private-provider','company','guardian','peer-seeker')),
  UNIQUE(visit_id,persona)
);
ALTER TABLE demo_private.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_private.personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_private.admission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_reader_visits ON demo_private.visits FOR SELECT TO demo_scope_reader USING (true);
CREATE POLICY scope_reader_personas ON demo_private.personas FOR SELECT TO demo_scope_reader USING (true);
REVOKE ALL ON ALL TABLES IN SCHEMA demo_private FROM PUBLIC,anon,authenticated,demo_executor;
GRANT SELECT ON demo_private.visits,demo_private.personas TO demo_scope_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA demo_private TO service_role;

-- These two helpers read only private membership, never public business rows.
-- The seed context is trusted only under a verified service_role JWT.
CREATE FUNCTION demo_private.current_visit() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_context text;
BEGIN
  IF auth.role() = 'service_role' THEN
    v_context := current_setting('demo.seed_visit_id',true);
    IF v_context ~ '^[0-9a-fA-F-]{36}$' THEN v_id := v_context::uuid; END IF;
    RETURN (SELECT id FROM demo_private.visits
      WHERE id=v_id AND revoked_at IS NULL AND expires_at > statement_timestamp());
  END IF;
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN NULL; END IF;
  RETURN (SELECT v.id FROM demo_private.personas p JOIN demo_private.visits v ON v.id=p.visit_id
    WHERE p.user_id=auth.uid() AND v.seeded_at IS NOT NULL
      AND v.revoked_at IS NULL AND v.expires_at > statement_timestamp());
END $$;
ALTER FUNCTION demo_private.current_visit() OWNER TO demo_scope_reader;
CREATE FUNCTION demo_private.same_visit(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT FROM demo_private.personas p
    WHERE p.user_id=p_user_id AND p.visit_id=demo_private.current_visit()
  );
$$;
ALTER FUNCTION demo_private.same_visit(uuid) OWNER TO demo_scope_reader;
REVOKE CREATE ON SCHEMA demo_private FROM demo_scope_reader;
REVOKE ALL ON FUNCTION demo_private.current_visit(),demo_private.same_visit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demo_private.current_visit(),demo_private.same_visit(uuid)
  TO anon,authenticated,demo_executor,service_role;

-- Waitlist has no user/parent FK in the product schema, hence one demo-only
-- ownership column. Every other table keeps its original shape.
ALTER TABLE public.waitlist ADD COLUMN demo_visit_id uuid
  DEFAULT demo_private.current_visit() REFERENCES demo_private.visits(id);

-- Existing participant/owner policies and browser grants are retained.
-- The executor receives only a within-visit permissive path; it does NOT
-- inherit authenticated, avoiding recursion through consumer participant helpers.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.profiles AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(id) AND (guardian_id IS NULL OR demo_private.same_visit(guardian_id))) WITH CHECK (demo_private.same_visit(id) AND (guardian_id IS NULL OR demo_private.same_visit(guardian_id)));
CREATE POLICY demo_executor_access ON public.profiles AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.jobs AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(posted_by) AND (filled_by IS NULL OR demo_private.same_visit(filled_by))) WITH CHECK (demo_private.same_visit(posted_by) AND (filled_by IS NULL OR demo_private.same_visit(filled_by)));
CREATE POLICY demo_executor_access ON public.jobs AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.applications AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(user_id)
  AND EXISTS (SELECT 1 FROM public.jobs parent WHERE parent.id = applications.job_id)
  AND (closed_by IS NULL OR demo_private.same_visit(closed_by))
  AND (reopened_by IS NULL OR demo_private.same_visit(reopened_by))
  AND (promoted_by IS NULL OR demo_private.same_visit(promoted_by))) WITH CHECK (demo_private.same_visit(user_id)
  AND EXISTS (SELECT 1 FROM public.jobs parent WHERE parent.id = applications.job_id)
  AND (closed_by IS NULL OR demo_private.same_visit(closed_by))
  AND (reopened_by IS NULL OR demo_private.same_visit(reopened_by))
  AND (promoted_by IS NULL OR demo_private.same_visit(promoted_by)));
CREATE POLICY demo_executor_access ON public.applications AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.application_events AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = application_events.application_id)
  AND (actor_id IS NULL OR demo_private.same_visit(actor_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = application_events.application_id)
  AND (actor_id IS NULL OR demo_private.same_visit(actor_id)));
CREATE POLICY demo_executor_access ON public.application_events AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.messages AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = messages.application_id)
  AND (sender_id IS NULL OR demo_private.same_visit(sender_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = messages.application_id)
  AND (sender_id IS NULL OR demo_private.same_visit(sender_id)));
CREATE POLICY demo_executor_access ON public.messages AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.conversation_reopen_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.conversation_reopen_requests AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = conversation_reopen_requests.application_id)
  AND demo_private.same_visit(requested_by) AND demo_private.same_visit(recipient_id)
  AND (resolved_by IS NULL OR demo_private.same_visit(resolved_by))) WITH CHECK (EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = conversation_reopen_requests.application_id)
  AND demo_private.same_visit(requested_by) AND demo_private.same_visit(recipient_id)
  AND (resolved_by IS NULL OR demo_private.same_visit(resolved_by)));
CREATE POLICY demo_executor_access ON public.conversation_reopen_requests AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.job_engagements ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.job_engagements AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(provider_id) AND demo_private.same_visit(seeker_id)
  AND EXISTS (SELECT 1 FROM public.jobs parent WHERE parent.id = job_engagements.job_id)
  AND EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = job_engagements.application_id)
  AND (closed_by IS NULL OR demo_private.same_visit(closed_by))) WITH CHECK (demo_private.same_visit(provider_id) AND demo_private.same_visit(seeker_id)
  AND EXISTS (SELECT 1 FROM public.jobs parent WHERE parent.id = job_engagements.job_id)
  AND EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = job_engagements.application_id)
  AND (closed_by IS NULL OR demo_private.same_visit(closed_by)));
CREATE POLICY demo_executor_access ON public.job_engagements AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.job_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.job_agreements AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(provider_id) AND demo_private.same_visit(seeker_id)
  AND EXISTS (SELECT 1 FROM public.jobs parent WHERE parent.id = job_agreements.job_id)
  AND EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = job_agreements.application_id)) WITH CHECK (demo_private.same_visit(provider_id) AND demo_private.same_visit(seeker_id)
  AND EXISTS (SELECT 1 FROM public.jobs parent WHERE parent.id = job_agreements.job_id)
  AND EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = job_agreements.application_id));
CREATE POLICY demo_executor_access ON public.job_agreements AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.job_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.job_appointments AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (EXISTS (SELECT 1 FROM public.job_engagements parent WHERE parent.id = job_appointments.engagement_id)
  AND (created_by IS NULL OR demo_private.same_visit(created_by))
  AND (legacy_agreement_id IS NULL OR EXISTS (SELECT 1 FROM public.job_agreements parent WHERE parent.id = job_appointments.legacy_agreement_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.job_engagements parent WHERE parent.id = job_appointments.engagement_id)
  AND (created_by IS NULL OR demo_private.same_visit(created_by))
  AND (legacy_agreement_id IS NULL OR EXISTS (SELECT 1 FROM public.job_agreements parent WHERE parent.id = job_appointments.legacy_agreement_id)));
CREATE POLICY demo_executor_access ON public.job_appointments AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.job_private_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.job_private_details AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (EXISTS (SELECT 1 FROM public.jobs parent WHERE parent.id = job_private_details.job_id)) WITH CHECK (EXISTS (SELECT 1 FROM public.jobs parent WHERE parent.id = job_private_details.job_id));
CREATE POLICY demo_executor_access ON public.job_private_details AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.notifications AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(user_id)) WITH CHECK (demo_private.same_visit(user_id));
CREATE POLICY demo_executor_access ON public.notifications AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.notification_preferences AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(user_id)) WITH CHECK (demo_private.same_visit(user_id));
CREATE POLICY demo_executor_access ON public.notification_preferences AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.guardian_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.guardian_relationships AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(child_id) AND demo_private.same_visit(guardian_id)) WITH CHECK (demo_private.same_visit(child_id) AND demo_private.same_visit(guardian_id));
CREATE POLICY demo_executor_access ON public.guardian_relationships AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.guardian_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.guardian_invitations AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(child_id)
  AND (redeemed_by IS NULL OR demo_private.same_visit(redeemed_by))
  AND (basis_consent_link_id IS NULL OR EXISTS (SELECT 1 FROM public.guardian_consent_links parent WHERE parent.id = guardian_invitations.basis_consent_link_id))) WITH CHECK (demo_private.same_visit(child_id)
  AND (redeemed_by IS NULL OR demo_private.same_visit(redeemed_by))
  AND (basis_consent_link_id IS NULL OR EXISTS (SELECT 1 FROM public.guardian_consent_links parent WHERE parent.id = guardian_invitations.basis_consent_link_id)));
CREATE POLICY demo_executor_access ON public.guardian_invitations AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.guardian_consent_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.guardian_consent_links AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(child_id)) WITH CHECK (demo_private.same_visit(child_id));
CREATE POLICY demo_executor_access ON public.guardian_consent_links AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.guardian_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.guardian_consents AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(child_id)
  AND (linked_guardian_id IS NULL OR demo_private.same_visit(linked_guardian_id))
  AND (link_id IS NULL OR EXISTS (SELECT 1 FROM public.guardian_consent_links parent WHERE parent.id = guardian_consents.link_id))) WITH CHECK (demo_private.same_visit(child_id)
  AND (linked_guardian_id IS NULL OR demo_private.same_visit(linked_guardian_id))
  AND (link_id IS NULL OR EXISTS (SELECT 1 FROM public.guardian_consent_links parent WHERE parent.id = guardian_consents.link_id)));
CREATE POLICY demo_executor_access ON public.guardian_consents AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.reports AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(reporter_user_id)
  AND (reported_user_id IS NULL OR demo_private.same_visit(reported_user_id))
  AND (application_id IS NULL OR EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = reports.application_id))
  AND (message_id IS NULL OR EXISTS (SELECT 1 FROM public.messages parent WHERE parent.id = reports.message_id))
  AND (reopen_request_id IS NULL OR EXISTS (SELECT 1 FROM public.conversation_reopen_requests parent WHERE parent.id = reports.reopen_request_id))) WITH CHECK (demo_private.same_visit(reporter_user_id)
  AND (reported_user_id IS NULL OR demo_private.same_visit(reported_user_id))
  AND (application_id IS NULL OR EXISTS (SELECT 1 FROM public.applications parent WHERE parent.id = reports.application_id))
  AND (message_id IS NULL OR EXISTS (SELECT 1 FROM public.messages parent WHERE parent.id = reports.message_id))
  AND (reopen_request_id IS NULL OR EXISTS (SELECT 1 FROM public.conversation_reopen_requests parent WHERE parent.id = reports.reopen_request_id)));
CREATE POLICY demo_executor_access ON public.reports AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.security_events AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.same_visit(user_id)) WITH CHECK (demo_private.same_visit(user_id));
CREATE POLICY demo_executor_access ON public.security_events AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.user_system_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.user_system_roles AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (false) WITH CHECK (false);
CREATE POLICY demo_executor_access ON public.user_system_roles AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.moderation_actions AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (false) WITH CHECK (false);
CREATE POLICY demo_executor_access ON public.moderation_actions AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.system_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.system_roles AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_private.current_visit() IS NOT NULL) WITH CHECK (demo_private.current_visit() IS NOT NULL);
CREATE POLICY demo_executor_access ON public.system_roles AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.regions_live ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.regions_live AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (true) WITH CHECK (true);
CREATE POLICY demo_executor_access ON public.regions_live AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_visit_boundary ON public.waitlist AS RESTRICTIVE FOR ALL
  TO anon,authenticated,demo_executor
  USING (demo_visit_id = demo_private.current_visit()) WITH CHECK (demo_visit_id = demo_private.current_visit());
CREATE POLICY demo_executor_access ON public.waitlist AS PERMISSIVE FOR ALL
  TO demo_executor USING (true) WITH CHECK (true);
GRANT SELECT ON public.profiles,public.jobs,public.applications,public.application_events,public.messages,public.conversation_reopen_requests,public.job_engagements,public.job_agreements,public.job_appointments,public.job_private_details,public.notifications,public.notification_preferences,public.guardian_relationships,public.guardian_invitations,public.guardian_consent_links,public.guardian_consents,public.reports,public.security_events,public.user_system_roles,public.moderation_actions,public.system_roles,public.regions_live,public.waitlist TO demo_executor;
GRANT INSERT, UPDATE ON public.application_events,public.applications,public.conversation_reopen_requests,public.guardian_invitations,public.guardian_relationships,public.job_agreements,public.job_appointments,public.job_engagements,public.job_private_details,public.jobs,public.messages,public.notifications,public.profiles,public.reports,public.waitlist TO demo_executor;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO demo_executor;
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.jobs FROM anon;
REVOKE ALL ON public.applications FROM anon;
REVOKE ALL ON public.application_events FROM anon;
REVOKE ALL ON public.messages FROM anon;
REVOKE ALL ON public.conversation_reopen_requests FROM anon;
REVOKE ALL ON public.job_engagements FROM anon;
REVOKE ALL ON public.job_agreements FROM anon;
REVOKE ALL ON public.job_appointments FROM anon;
REVOKE ALL ON public.job_private_details FROM anon;
REVOKE ALL ON public.notifications FROM anon;
REVOKE ALL ON public.notification_preferences FROM anon;
REVOKE ALL ON public.guardian_relationships FROM anon;
REVOKE ALL ON public.guardian_invitations FROM anon;
REVOKE ALL ON public.guardian_consent_links FROM anon;
REVOKE ALL ON public.guardian_consents FROM anon;
REVOKE ALL ON public.reports FROM anon;
REVOKE ALL ON public.security_events FROM anon;
REVOKE ALL ON public.user_system_roles FROM anon;
REVOKE ALL ON public.moderation_actions FROM anon;
REVOKE ALL ON public.system_roles FROM anon;
REVOKE ALL ON public.waitlist FROM anon;

-- Every original business SECURITY DEFINER function now obeys the scope policies.
-- Only Auth-trigger entrypoints keep their original owner; they use NEW.id only,
-- are not callable as ordinary functions, and are revoked from browser roles.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND p.proname NOT IN ('handle_new_user','sync_profile_from_auth_user','sync_user_email')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO demo_executor',fn.signature);
    EXECUTE format('ALTER FUNCTION %s SET row_security = on',fn.signature);
  END LOOP;
  -- Preserve the exact authenticated allowlist from the source; anon gets no
  -- business RPC. The scalar distance helper remains available.
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname <> 'calculate_distance'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',fn.signature);
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM demo_executor;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO demo_executor;
REVOKE ALL ON FUNCTION public.handle_new_user(),public.sync_profile_from_auth_user(),public.sync_user_email()
  FROM PUBLIC,anon,authenticated,demo_executor;

-- No consumer can acquire internal system roles, even if accidentally seeded.
-- Source service_role remains privileged, used only by trusted demo bootstrap.

-- Private typing channels use the same real application participant rules.
DROP POLICY IF EXISTS activity_typing_broadcast_read ON realtime.messages;
DROP POLICY IF EXISTS activity_typing_broadcast_send ON realtime.messages;
CREATE POLICY activity_typing_broadcast_read ON realtime.messages FOR SELECT TO authenticated
  USING (extension='broadcast' AND demo_private.current_visit() IS NOT NULL AND EXISTS (
    SELECT FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
    WHERE realtime.topic()='activity:'||a.id::text AND (a.user_id=auth.uid() OR j.posted_by=auth.uid())
  ));
CREATE POLICY activity_typing_broadcast_send ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (extension='broadcast' AND demo_private.current_visit() IS NOT NULL AND EXISTS (
    SELECT FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
    WHERE realtime.topic()='activity:'||a.id::text AND a.conversation_state='open'
      AND a.status IN ('submitted','negotiating','accepted')
      AND (a.user_id=auth.uid() OR j.posted_by=auth.uid())
  ));
CREATE POLICY demo_typing_expiry ON realtime.messages AS RESTRICTIVE FOR ALL TO authenticated
  USING (demo_private.current_visit() IS NOT NULL) WITH CHECK (demo_private.current_visit() IS NOT NULL);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','applications','messages','notifications','application_events',
    'conversation_reopen_requests','job_agreements','job_engagements','job_appointments'] LOOP
    IF NOT EXISTS(SELECT FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
    END IF;
  END LOOP;
END $$;

REVOKE demo_executor,demo_scope_reader FROM postgres;

-- Runtime assertions against accidental privilege/ownership regression.
DO $$
BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('demo_executor','demo_scope_reader') AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Unsafe demo role attributes';
  END IF;
  IF pg_has_role('authenticated','demo_executor','MEMBER') OR pg_has_role('anon','demo_executor','MEMBER')
     OR pg_has_role('demo_executor','authenticated','MEMBER') THEN
    RAISE EXCEPTION 'Unexpected demo role inheritance';
  END IF;
  IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relowner='demo_executor'::regrole AND c.relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Executor must not own public data relations';
  END IF;
END $$;
COMMIT;
