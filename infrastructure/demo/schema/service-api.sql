-- Isolated local demo only. Requires isolation.sql. Never execute on production.
BEGIN;
DO $$ BEGIN
 IF current_setting('workfare.demo_target',true) IS DISTINCT FROM 'isolated-local-demo' THEN
   RAISE EXCEPTION 'Local demo target confirmation missing';
 END IF;
END $$;

CREATE FUNCTION demo_private.require_service() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'Demo service authorization required' USING ERRCODE='42501';
 END IF;
END $$;

CREATE FUNCTION demo_private.create_session(p_token_hash text,p_rate_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_visit demo_private.visits%ROWTYPE;
BEGIN
 PERFORM demo_private.require_service();
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_rate_key IS NULL OR p_rate_key !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Expected SHA-256 token and rate hashes' USING ERRCODE='22023';
 END IF;
 -- Serialize admission, including the global cap, across concurrent requests.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workfare.demo.admission',0));
 SELECT * INTO v_visit FROM demo_private.visits WHERE token_hash=p_token_hash;
 IF FOUND THEN
   IF v_visit.revoked_at IS NOT NULL OR v_visit.expires_at <= statement_timestamp() THEN
     RAISE EXCEPTION 'Demo session expired' USING ERRCODE='22023';
   END IF;
   RETURN jsonb_build_object('id',v_visit.id,'expires_at',v_visit.expires_at);
 END IF;
 IF (SELECT count(*) FROM demo_private.admission_events WHERE rate_key=p_rate_key
       AND created_at > statement_timestamp()-interval '1 hour') >= 5 THEN
   RAISE EXCEPTION 'Demo session rate limit reached' USING ERRCODE='P0001';
 END IF;
 IF (SELECT count(*) FROM demo_private.visits WHERE revoked_at IS NULL
       AND expires_at > statement_timestamp()) >= 100 THEN
   RAISE EXCEPTION 'Demo capacity reached' USING ERRCODE='P0001';
 END IF;
 INSERT INTO demo_private.visits(token_hash,rate_key) VALUES(p_token_hash,p_rate_key) RETURNING * INTO v_visit;
 INSERT INTO demo_private.admission_events(rate_key) VALUES(p_rate_key);
 RETURN jsonb_build_object('id',v_visit.id,'expires_at',v_visit.expires_at);
END $$;

CREATE FUNCTION demo_private.get_session(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_visit demo_private.visits%ROWTYPE; v_identities jsonb;
BEGIN
 PERFORM demo_private.require_service();
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO v_visit FROM demo_private.visits
 WHERE token_hash=p_token_hash AND revoked_at IS NULL AND expires_at > statement_timestamp();
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_object_agg(persona,user_id) INTO v_identities
 FROM demo_private.personas WHERE visit_id=v_visit.id;
 RETURN jsonb_build_object('id',v_visit.id,'expires_at',v_visit.expires_at,
   'identities',COALESCE(v_identities,'{}'::jsonb),'seeded',v_visit.seeded_at IS NOT NULL);
END $$;

CREATE FUNCTION demo_private.bind_identities(p_session_id uuid,p_identities jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pair record; v_user_id uuid; v_existing record; v_expected_email text;
BEGIN
 PERFORM demo_private.require_service();
 PERFORM FROM demo_private.visits WHERE id=p_session_id AND revoked_at IS NULL
   AND expires_at > statement_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active demo session required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_identities) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Identity mapping must be an object' USING ERRCODE='22023';
 END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_identities)) <> 5 OR NOT
   p_identities ?& ARRAY['seeker','private-provider','company','guardian','peer-seeker'] THEN
   RAISE EXCEPTION 'Exactly the five demo persona aliases are required' USING ERRCODE='22023';
 END IF;
 IF (SELECT count(DISTINCT value) FROM jsonb_each_text(p_identities)) <> 5 THEN
   RAISE EXCEPTION 'Demo personas must have distinct identities' USING ERRCODE='22023';
 END IF;
 FOR v_pair IN SELECT key,value FROM jsonb_each_text(p_identities) LOOP
   v_user_id := v_pair.value::uuid;
   v_expected_email := 'demo+'||p_session_id::text||'.'||v_pair.key||'@example.test';
   PERFORM FROM auth.users WHERE id=v_user_id AND lower(email)=v_expected_email
     AND email_confirmed_at IS NOT NULL AND phone IS NULL FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Unconfirmed or mismatched demo identity for %',v_pair.key USING ERRCODE='22023'; END IF;
   SELECT * INTO v_existing FROM demo_private.personas WHERE user_id=v_user_id;
   IF FOUND AND (v_existing.visit_id<>p_session_id OR v_existing.persona<>v_pair.key) THEN
     RAISE EXCEPTION 'Identity already belongs to another demo persona' USING ERRCODE='22023';
   END IF;
   SELECT * INTO v_existing FROM demo_private.personas WHERE visit_id=p_session_id AND persona=v_pair.key;
   IF FOUND AND v_existing.user_id<>v_user_id THEN
     RAISE EXCEPTION 'Bound demo persona cannot be replaced' USING ERRCODE='22023';
   END IF;
   INSERT INTO demo_private.personas(user_id,visit_id,persona) VALUES(v_user_id,p_session_id,v_pair.key)
     ON CONFLICT(user_id) DO NOTHING;
 END LOOP;
 RETURN jsonb_build_object('id',p_session_id,'identities',p_identities);
END $$;

CREATE FUNCTION demo_private.expire_session(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_users jsonb;
BEGIN
 PERFORM demo_private.require_service();
 UPDATE demo_private.visits SET revoked_at=COALESCE(revoked_at,statement_timestamp()) WHERE id=p_session_id;
 SELECT COALESCE(jsonb_agg(user_id),'[]'::jsonb) INTO v_users FROM demo_private.personas WHERE visit_id=p_session_id;
 RETURN jsonb_build_object('id',p_session_id,'revoked',true,'user_ids',v_users);
END $$;

-- Delete only expired/revoked visit graphs, then Auth sessions/users and private bindings.
-- A short-lived rate-hash log survives at most one hour so cleanup cannot reset admission limits.
CREATE FUNCTION demo_private.cleanup_expired_sessions(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ids uuid[]; v_users uuid[]; v_jobs uuid[]; v_apps uuid[]; v_engagements uuid[];
BEGIN
 PERFORM demo_private.require_service();
 IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'Invalid cleanup batch size'; END IF;
 SELECT array_agg(id) INTO v_ids FROM (
   SELECT v.id FROM demo_private.visits v
   WHERE v.expires_at<=statement_timestamp() OR v.revoked_at IS NOT NULL
   ORDER BY v.expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED
 ) expired;
 IF v_ids IS NULL THEN
   DELETE FROM demo_private.admission_events WHERE created_at<statement_timestamp()-interval '1 hour';
   RETURN jsonb_build_object('session_ids','[]'::jsonb,'user_ids','[]'::jsonb,'deleted_sessions',0,'deleted_users',0);
 END IF;
 UPDATE demo_private.visits SET revoked_at=COALESCE(revoked_at,statement_timestamp()),cleanup_requested_at=statement_timestamp()
   WHERE id=ANY(v_ids);
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
 SELECT COALESCE(array_agg(id),ARRAY[]::uuid[]) INTO v_jobs FROM public.jobs WHERE posted_by=ANY(v_users);
 SELECT COALESCE(array_agg(id),ARRAY[]::uuid[]) INTO v_apps FROM public.applications WHERE job_id=ANY(v_jobs) OR user_id=ANY(v_users);
 IF EXISTS(SELECT FROM public.jobs WHERE filled_by=ANY(v_users) AND NOT(posted_by=ANY(v_users)))
   OR EXISTS(SELECT FROM public.applications WHERE id=ANY(v_apps) AND NOT(job_id=ANY(v_jobs))) THEN
   RAISE EXCEPTION 'Unexpected cross-visit references: quarantine instead of cross-visit deletion';
 END IF;
 SELECT COALESCE(array_agg(id),ARRAY[]::uuid[]) INTO v_engagements FROM public.job_engagements WHERE application_id=ANY(v_apps) OR job_id=ANY(v_jobs);
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
 DELETE FROM demo_private.admission_events WHERE created_at<statement_timestamp()-interval '1 hour';
 RETURN jsonb_build_object('session_ids',to_jsonb(v_ids),'user_ids',to_jsonb(v_users),
   'deleted_sessions',cardinality(v_ids),'deleted_users',cardinality(v_users),'requires_auth_cleanup',false);
END $$;

CREATE FUNCTION public.demo_create_session(p_token_hash text,p_rate_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$SELECT demo_private.create_session(p_token_hash,p_rate_key)$$;
CREATE FUNCTION public.demo_get_session(p_token_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$SELECT demo_private.get_session(p_token_hash)$$;
CREATE FUNCTION public.demo_bind_identities(p_session_id uuid,p_identities jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$SELECT demo_private.bind_identities(p_session_id,p_identities)$$;
CREATE FUNCTION public.demo_expire_session(p_session_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$SELECT demo_private.expire_session(p_session_id)$$;
CREATE FUNCTION public.demo_cleanup_expired_sessions(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$SELECT demo_private.cleanup_expired_sessions(p_limit)$$;
REVOKE ALL ON FUNCTION public.demo_create_session(text,text),public.demo_get_session(text),
  public.demo_bind_identities(uuid,jsonb),public.demo_expire_session(uuid),public.demo_cleanup_expired_sessions(integer)
  FROM PUBLIC,anon,authenticated,demo_executor;
GRANT EXECUTE ON FUNCTION public.demo_create_session(text,text),public.demo_get_session(text),
  public.demo_bind_identities(uuid,jsonb),public.demo_expire_session(uuid),public.demo_cleanup_expired_sessions(integer)
  TO service_role;
REVOKE ALL ON FUNCTION demo_private.require_service(),demo_private.create_session(text,text),demo_private.get_session(text),
  demo_private.bind_identities(uuid,jsonb),demo_private.expire_session(uuid),demo_private.cleanup_expired_sessions(integer)
  FROM PUBLIC,anon,authenticated,demo_executor;
GRANT EXECUTE ON FUNCTION demo_private.require_service(),demo_private.create_session(text,text),demo_private.get_session(text),
  demo_private.bind_identities(uuid,jsonb),demo_private.expire_session(uuid),demo_private.cleanup_expired_sessions(integer)
  TO service_role;
COMMIT;
