BEGIN;

-- This forward update only changes an already-installed isolated demo service.
-- Production databases have no demo_private cleanup API and remain untouched.
DO $install$
DECLARE v_owner name;
BEGIN
 IF to_regprocedure('demo_private.cleanup_expired_sessions(integer)') IS NULL THEN RETURN; END IF;
 SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc
   WHERE oid='demo_private.cleanup_expired_sessions(integer)'::regprocedure;
 EXECUTE $definition$
-- Keep local financial history and external sandbox references until an explicit
-- reconciliation/retention policy removes them. An in-flight sandbox claim is
-- retained too: Stripe may already have created its object before DB attachment.
CREATE OR REPLACE FUNCTION demo_private.visit_has_payment_records(p_visit_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_users uuid[]; v_found boolean;
BEGIN
 SELECT COALESCE(array_agg(DISTINCT id),ARRAY[]::uuid[]) INTO v_users FROM (
   SELECT user_id AS id FROM demo_private.personas WHERE visit_id=p_visit_id
   UNION ALL
   SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data->>'demo_session_id'=p_visit_id::text
     AND lower(u.email)='demo+'||p_visit_id::text||'.'||(u.raw_app_meta_data->>'demo_identity')||'@example.test'
 ) identities;
 IF to_regclass('payment_private.orders') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT FROM payment_private.orders WHERE provider_id=ANY($1) OR recipient_id=ANY($1))'
     INTO v_found USING v_users;
   IF v_found THEN RETURN true; END IF;
 END IF;
 IF to_regclass('payment_private.customers') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT FROM payment_private.customers WHERE user_id=ANY($1) AND mode=''sandbox'')'
     INTO v_found USING v_users;
   IF v_found THEN RETURN true; END IF;
 END IF;
 IF to_regclass('payment_private.recipients') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT FROM payment_private.recipients WHERE user_id=ANY($1) AND mode=''sandbox'')'
     INTO v_found USING v_users;
   IF v_found THEN RETURN true; END IF;
 END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION demo_private.visit_has_payment_records(uuid) FROM PUBLIC,anon,authenticated,service_role;

$definition$;
 -- The helper is callable only by its owner. Preserve the installed cleanup
 -- owner's authority when a separate migration role applies this forward fix.
 EXECUTE format('ALTER FUNCTION demo_private.visit_has_payment_records(uuid) OWNER TO %I',v_owner);
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION demo_private.cleanup_expired_sessions(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_visit record; v_ids uuid[]; v_users uuid[]; v_jobs uuid[]; v_apps uuid[]; v_engagements uuid[];
 v_deleted_ids uuid[]:=ARRAY[]::uuid[]; v_deleted_users uuid[]:=ARRAY[]::uuid[]; v_deferred integer:=0;
BEGIN
 PERFORM demo_private.require_service();
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'Invalid cleanup batch size'; END IF;
 -- Filter before LIMIT so retained financial visits cannot starve other cleanup.
 FOR v_visit IN SELECT v.id FROM demo_private.visits v
   WHERE (v.expires_at<=statement_timestamp() OR v.revoked_at IS NOT NULL)
     AND NOT demo_private.visit_has_payment_records(v.id)
   ORDER BY v.expires_at,v.id LIMIT p_limit FOR UPDATE SKIP LOCKED
 LOOP
  BEGIN
   v_ids:=ARRAY[v_visit.id];
   SELECT COALESCE(array_agg(user_id),ARRAY[]::uuid[]) INTO v_users FROM demo_private.personas WHERE visit_id=ANY(v_ids);
   -- A failed seed can leave confirmed Auth users before persona binding. Include
   -- only immutable marker+email matches for one of these expired visits.
   SELECT COALESCE(array_agg(DISTINCT id),ARRAY[]::uuid[]) INTO v_users FROM (
     SELECT unnest(v_users) AS id
     UNION ALL
     SELECT u.id FROM auth.users u JOIN demo_private.visits v
       ON u.raw_app_meta_data->>'demo_session_id'=v.id::text
     WHERE v.id=ANY(v_ids) AND lower(u.email)='demo+'||v.id::text||'.'||(u.raw_app_meta_data->>'demo_identity')||'@example.test'
   ) identities;
   -- Serialize against profile-bound payment claims. Busy visits are deferred;
   -- an order appearing concurrently is protected again by its restrictive FKs.
   PERFORM 1 FROM public.profiles WHERE id=ANY(v_users) ORDER BY id FOR UPDATE NOWAIT;
   IF demo_private.visit_has_payment_records(v_visit.id) THEN CONTINUE; END IF;
   UPDATE demo_private.visits SET revoked_at=COALESCE(revoked_at,statement_timestamp()),cleanup_requested_at=statement_timestamp()
     WHERE id=v_visit.id;
   SELECT COALESCE(array_agg(id),ARRAY[]::uuid[]) INTO v_jobs FROM public.jobs WHERE posted_by=ANY(v_users);
   SELECT COALESCE(array_agg(id),ARRAY[]::uuid[]) INTO v_apps FROM public.applications WHERE job_id=ANY(v_jobs) OR user_id=ANY(v_users);
   IF EXISTS(SELECT FROM public.jobs WHERE filled_by=ANY(v_users) AND NOT(posted_by=ANY(v_users)))
     OR EXISTS(SELECT FROM public.applications WHERE id=ANY(v_apps) AND NOT(job_id=ANY(v_jobs))) THEN
     RAISE EXCEPTION 'Unexpected cross-visit references: quarantine instead of cross-visit deletion';
   END IF;
   SELECT COALESCE(array_agg(id),ARRAY[]::uuid[]) INTO v_engagements FROM public.job_engagements WHERE application_id=ANY(v_apps) OR job_id=ANY(v_jobs);
   -- Avoid waiting on an appointment/order transaction that already owns part of
   -- this graph while we own its profiles. Its next cleanup pass can retry safely.
   PERFORM 1 FROM public.applications WHERE id=ANY(v_apps) ORDER BY id FOR UPDATE NOWAIT;
   PERFORM 1 FROM public.jobs WHERE id=ANY(v_jobs) ORDER BY id FOR UPDATE NOWAIT;
   PERFORM 1 FROM public.job_engagements WHERE id=ANY(v_engagements) ORDER BY id FOR UPDATE NOWAIT;
   PERFORM 1 FROM public.job_appointments WHERE engagement_id=ANY(v_engagements) ORDER BY id FOR UPDATE NOWAIT;
   DELETE FROM public.reports WHERE reporter_user_id=ANY(v_users) OR application_id=ANY(v_apps);
   DELETE FROM public.moderation_actions WHERE moderator_user_id=ANY(v_users);
   DELETE FROM public.job_appointments WHERE engagement_id=ANY(v_engagements);
   DELETE FROM public.job_agreements WHERE application_id=ANY(v_apps) OR job_id=ANY(v_jobs);
   DELETE FROM public.job_engagements WHERE id=ANY(v_engagements);
   DELETE FROM public.conversation_reopen_requests WHERE application_id=ANY(v_apps);
   DELETE FROM public.application_events WHERE application_id=ANY(v_apps);
   DELETE FROM public.messages WHERE application_id=ANY(v_apps);
   DELETE FROM public.notifications WHERE user_id=ANY(v_users);
   DELETE FROM public.notification_preferences WHERE user_id=ANY(v_users);
   DELETE FROM public.applications WHERE id=ANY(v_apps);
   DELETE FROM public.job_private_details WHERE job_id=ANY(v_jobs);
   DELETE FROM public.jobs WHERE id=ANY(v_jobs);
   DELETE FROM public.guardian_consents WHERE child_id=ANY(v_users);
   DELETE FROM public.guardian_invitations WHERE child_id=ANY(v_users);
   DELETE FROM public.guardian_consent_links WHERE child_id=ANY(v_users);
   DELETE FROM public.guardian_relationships WHERE child_id=ANY(v_users) OR guardian_id=ANY(v_users);
   DELETE FROM public.user_system_roles WHERE user_id=ANY(v_users);
   DELETE FROM public.security_events WHERE user_id=ANY(v_users);
   DELETE FROM public.waitlist WHERE demo_visit_id=ANY(v_ids);
   -- profiles has no auth.users FK in the exported baseline; explicitly remove it.
   DELETE FROM public.profiles WHERE id=ANY(v_users);
   -- These Auth tables do not all have a user FK in the local baseline.
   DELETE FROM auth.flow_state WHERE user_id=ANY(v_users) OR linking_target_id=ANY(v_users);
   DELETE FROM auth.refresh_tokens WHERE user_id=ANY(v_users::text[]);
   DELETE FROM auth.audit_log_entries WHERE payload->>'actor_id'=ANY(v_users::text[])
     OR payload->'traits'->>'user_id'=ANY(v_users::text[]);
   DELETE FROM auth.sessions WHERE user_id=ANY(v_users);
   DELETE FROM auth.users WHERE id=ANY(v_users);
   DELETE FROM demo_private.personas WHERE visit_id=ANY(v_ids);
   DELETE FROM demo_private.visits WHERE id=ANY(v_ids);
   v_deleted_ids:=v_deleted_ids||v_ids;
   v_deleted_users:=v_deleted_users||v_users;
  EXCEPTION WHEN foreign_key_violation OR lock_not_available THEN
   -- Roll back only this visit. Never cascade away retained payment records,
   -- and never block unrelated expired visits because one graph is still busy.
   v_deferred:=v_deferred+1;
  END;
 END LOOP;
 DELETE FROM demo_private.admission_events WHERE created_at<statement_timestamp()-interval '1 hour';
 RETURN jsonb_build_object('session_ids',to_jsonb(v_deleted_ids),'user_ids',to_jsonb(v_deleted_users),
   'deleted_sessions',cardinality(v_deleted_ids),'deleted_users',cardinality(v_deleted_users),
   'requires_auth_cleanup',false,'deferred_sessions',v_deferred);
END $$;
$definition$;
END $install$;

COMMIT;
