BEGIN;

-- Additive, isolated test foundation. No money movement or bank credentials.
CREATE TABLE payment_private.recipient_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  application_gate_enabled boolean NOT NULL DEFAULT false,
  sandbox_adult_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO payment_private.recipient_configuration DEFAULT VALUES;
CREATE TABLE payment_private.recipient_cohort (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_private.recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK(mode IN('local_simulation','sandbox')),
  account_ref text,
  claim_operation uuid NOT NULL,
  claim_expires_at timestamptz NOT NULL DEFAULT(now()+interval '2 minutes'),
  generation bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'onboarding' CHECK(status IN('onboarding','pending','ready','restricted')),
  requirement_count integer NOT NULL DEFAULT 0 CHECK(requirement_count BETWEEN 0 AND 10000),
  has_payout_method boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  transfers_active boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  livemode boolean NOT NULL DEFAULT false CHECK(NOT livemode),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,mode),UNIQUE(mode,account_ref),
  CHECK(account_ref IS NULL OR (mode='sandbox' AND account_ref ~ '^acct_[a-zA-Z0-9]{1,140}$')
    OR (mode='local_simulation' AND account_ref ~ '^local_recipient_[a-zA-Z0-9_-]{1,100}$')),
  CHECK(status<>'ready' OR (account_ref IS NOT NULL AND requirement_count=0 AND has_payout_method AND details_submitted AND transfers_active AND payouts_enabled AND verified_at IS NOT NULL))
);
CREATE TABLE payment_private.recipient_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES payment_private.recipients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  generation bigint NOT NULL,
  component text NOT NULL CHECK(component IN('onboarding','management','balances','payouts_list')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','complete','canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT(now()+interval '30 minutes'),
  UNIQUE(user_id,operation_id),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '1 hour')
);
CREATE INDEX payment_recipient_sessions_recipient_idx ON payment_private.recipient_sessions(recipient_id);
CREATE TABLE payment_private.recipient_events (
  event_id text PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 200),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES payment_private.recipients(id) ON DELETE CASCADE,
  generation bigint NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_recipient_events_recipient_idx ON payment_private.recipient_events(recipient_id);
CREATE INDEX payment_recipient_events_user_idx ON payment_private.recipient_events(user_id);
ALTER TABLE payment_private.recipient_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.recipient_cohort ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.recipient_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.recipient_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.recipient_configuration,payment_private.recipient_cohort,payment_private.recipients,payment_private.recipient_sessions,payment_private.recipient_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION payment_private.recipient_synthetic(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE valid boolean;
BEGIN
  IF to_regclass('demo_private.visits') IS NULL OR to_regclass('demo_private.personas') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT EXISTS(SELECT FROM demo_private.personas WHERE user_id=$1 AND persona IN (''seeker'',''peer-seeker''))' INTO valid USING p_user_id;
  RETURN COALESCE(valid,false);
END; $$;

CREATE FUNCTION payment_private.assert_recipient(p_user_id uuid,p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN('local_simulation','sandbox') OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode) THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND OR p.account_type<>'job_seeker' THEN RAISE EXCEPTION 'RECIPIENT_SEEKER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_mode='local_simulation' THEN
    IF NOT payment_private.recipient_synthetic(p_user_id) OR NOT EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p_user_id) THEN
      RAISE EXCEPTION 'RECIPIENT_LOCAL_DEMO_REQUIRED' USING ERRCODE='42501';
    END IF;
  ELSIF NOT EXISTS(SELECT FROM payment_private.recipient_configuration WHERE sandbox_adult_enabled)
    OR p.birthdate IS NULL OR p.birthdate>(current_date-interval '18 years')::date THEN
    RAISE EXCEPTION 'RECIPIENT_MODEL_NOT_APPROVED' USING ERRCODE='42501';
  END IF;
END; $$;

CREATE FUNCTION payment_private.recipient_ready(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT FROM payment_private.recipients r JOIN payment_private.configuration c ON c.mode=r.mode
    JOIN public.profiles p ON p.id=r.user_id
    CROSS JOIN payment_private.recipient_configuration rc
    WHERE r.user_id=p_user_id AND p.account_type='job_seeker' AND r.status='ready' AND r.account_ref IS NOT NULL
      AND r.requirement_count=0 AND r.has_payout_method AND r.details_submitted AND r.transfers_active AND r.payouts_enabled AND r.verified_at IS NOT NULL
      AND ((r.mode='local_simulation' AND payment_private.recipient_synthetic(r.user_id) AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=r.user_id))
        OR (r.mode='sandbox' AND rc.sandbox_adult_enabled AND p.birthdate<=(current_date-interval '18 years')::date AND r.verified_at>now()-interval '24 hours')));
$$;

CREATE FUNCTION payment_private.recipient_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; c payment_private.configuration%ROWTYPE; rc payment_private.recipient_configuration%ROWTYPE;
  r payment_private.recipients%ROWTYPE; eligible text; can_start boolean; active boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
  SELECT * INTO c FROM payment_private.configuration;
  SELECT * INTO rc FROM payment_private.recipient_configuration;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=auth.uid() AND mode=c.mode;
  eligible:=CASE WHEN p.account_type IS DISTINCT FROM 'job_seeker' THEN 'ineligible'
    WHEN c.mode='local_simulation' AND payment_private.recipient_synthetic(p.id) THEN 'local_demo'
    WHEN p.birthdate IS NULL OR p.birthdate>(current_date-interval '18 years')::date THEN 'minor_review_required'
    ELSE 'adult' END;
  can_start:=CASE c.mode WHEN 'local_simulation' THEN eligible='local_demo' AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p.id)
    WHEN 'sandbox' THEN eligible='adult' AND rc.sandbox_adult_enabled ELSE false END;
  active:=payment_private.recipient_ready(auth.uid());
  RETURN jsonb_build_object('kind',CASE c.mode WHEN 'local_simulation' THEN 'local' WHEN 'sandbox' THEN 'sandbox' ELSE 'disabled' END,
    'featureEnabled',c.mode<>'disabled' AND rc.application_gate_enabled AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p.id),
    'status',CASE WHEN r.id IS NULL THEN 'not_started' WHEN r.status='ready' AND NOT active THEN 'pending' ELSE r.status END,
    'canStart',can_start,'eligibility',eligible,'requirementCount',COALESCE(r.requirement_count,0),
    'hasPayoutMethod',COALESCE(r.has_payout_method,false),'detailsSubmitted',COALESCE(r.details_submitted,false),
    'transfersActive',COALESCE(r.transfers_active,false),'payoutsEnabled',COALESCE(r.payouts_enabled,false),'checkedAt',r.verified_at);
END; $$;

CREATE FUNCTION payment_private.recipient_enroll_local(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode='local_simulation') OR NOT payment_private.recipient_synthetic(p_user_id)
    OR NOT EXISTS(SELECT FROM public.profiles WHERE id=p_user_id AND account_type='job_seeker') THEN
    RAISE EXCEPTION 'RECIPIENT_LOCAL_DEMO_REQUIRED' USING ERRCODE='42501';
  END IF;
  INSERT INTO payment_private.recipient_cohort(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
END; $$;

CREATE FUNCTION payment_private.recipient_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',r.id,'userId',r.user_id,'mode',r.mode,'accountRef',r.account_ref,'generation',r.generation)
  FROM payment_private.recipients r WHERE r.id=p_id;
$$;
CREATE FUNCTION payment_private.recipient_claim(p_user_id uuid,p_mode text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; claimed boolean;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,p_mode);
  INSERT INTO payment_private.recipients(user_id,mode,claim_operation) VALUES(p_user_id,p_mode,p_operation_id) ON CONFLICT(user_id,mode) DO NOTHING;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
  claimed:=r.account_ref IS NULL AND (r.claim_operation=p_operation_id OR r.claim_expires_at<=now());
  IF claimed THEN UPDATE payment_private.recipients SET claim_operation=p_operation_id,claim_expires_at=now()+interval '2 minutes' WHERE id=r.id; END IF;
  RETURN jsonb_build_object('claimed',claimed,'accountRef',r.account_ref);
END; $$;
CREATE FUNCTION payment_private.recipient_save_account(p_user_id uuid,p_mode text,p_operation_id uuid,p_account_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,p_mode);
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
  IF NOT FOUND OR r.claim_operation<>p_operation_id OR p_account_ref IS NULL OR (r.account_ref IS NOT NULL AND r.account_ref<>p_account_ref) THEN
    RAISE EXCEPTION 'RECIPIENT_ACCOUNT_CLAIM_MISMATCH' USING ERRCODE='22023';
  END IF;
  UPDATE payment_private.recipients SET account_ref=p_account_ref,updated_at=now() WHERE id=r.id;
END; $$;
CREATE FUNCTION payment_private.recipient_get_account(p_user_id uuid,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,p_mode);
  RETURN(SELECT payment_private.recipient_json(id) FROM payment_private.recipients WHERE user_id=p_user_id AND mode=p_mode);
END; $$;

CREATE FUNCTION payment_private.recipient_session_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',s.id,'userId',s.user_id,'mode','local_simulation','component',s.component,
    'status',CASE WHEN s.status='pending' AND s.expires_at<=now() THEN 'expired' ELSE s.status END,'expiresAt',s.expires_at)
  FROM payment_private.recipient_sessions s WHERE s.id=p_id;
$$;
CREATE FUNCTION payment_private.recipient_create_local_session(p_user_id uuid,p_operation_id uuid,p_component text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; s payment_private.recipient_sessions%ROWTYPE;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,'local_simulation');
  IF p_component IS NULL OR p_component NOT IN('onboarding','management','balances','payouts_list') THEN RAISE EXCEPTION 'RECIPIENT_INVALID_COMPONENT' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode='local_simulation' FOR UPDATE;
  IF NOT FOUND OR r.account_ref IS NULL THEN RAISE EXCEPTION 'RECIPIENT_ACCOUNT_REQUIRED' USING ERRCODE='22023'; END IF;
  IF p_component IN('balances','payouts_list') AND NOT payment_private.recipient_ready(p_user_id) THEN RAISE EXCEPTION 'RECIPIENT_SETUP_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM payment_private.recipient_sessions WHERE user_id=p_user_id AND operation_id=p_operation_id;
  IF FOUND THEN
    IF s.component<>p_component THEN RAISE EXCEPTION 'RECIPIENT_OPERATION_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN payment_private.recipient_session_json(s.id);
  END IF;
  UPDATE payment_private.recipient_sessions SET status='canceled' WHERE recipient_id=r.id AND status='pending';
  UPDATE payment_private.recipients SET generation=generation+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  INSERT INTO payment_private.recipient_sessions(recipient_id,user_id,operation_id,generation,component)
    VALUES(r.id,p_user_id,p_operation_id,r.generation,p_component) RETURNING * INTO s;
  RETURN payment_private.recipient_session_json(s.id);
END; $$;
CREATE FUNCTION payment_private.recipient_finish_local_session(p_user_id uuid,p_session_id uuid,p_outcome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s payment_private.recipient_sessions%ROWTYPE; r payment_private.recipients%ROWTYPE;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,'local_simulation');
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode='local_simulation' FOR UPDATE;
  SELECT * INTO s FROM payment_private.recipient_sessions WHERE id=p_session_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR p_outcome IS NULL OR p_outcome NOT IN('complete','cancel') THEN RAISE EXCEPTION 'RECIPIENT_SESSION_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF (s.status='complete' AND p_outcome='complete') OR (s.status='canceled' AND p_outcome='cancel') THEN RETURN; END IF;
  IF s.status<>'pending' OR s.expires_at<=now() OR s.generation<>r.generation OR s.recipient_id<>r.id THEN
    RAISE EXCEPTION 'RECIPIENT_SESSION_STALE' USING ERRCODE='22023';
  END IF;
  UPDATE payment_private.recipient_sessions SET status=CASE p_outcome WHEN 'complete' THEN 'complete' ELSE 'canceled' END WHERE id=s.id;
  IF p_outcome='complete' AND s.component IN('onboarding','management') THEN
    UPDATE payment_private.recipients SET status='ready',requirement_count=0,has_payout_method=true,details_submitted=true,
      transfers_active=true,payouts_enabled=true,verified_at=now(),updated_at=now() WHERE id=r.id;
  END IF;
END; $$;

CREATE FUNCTION payment_private.recipient_begin_sync(p_user_id uuid,p_event_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; e payment_private.recipient_events%ROWTYPE;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,'sandbox');
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode='sandbox' FOR UPDATE;
  IF NOT FOUND OR r.account_ref IS NULL THEN RAISE EXCEPTION 'RECIPIENT_ACCOUNT_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM payment_private.recipient_events WHERE event_id=p_event_id FOR UPDATE;
  IF FOUND THEN
    IF e.user_id<>p_user_id OR e.recipient_id<>r.id THEN RAISE EXCEPTION 'RECIPIENT_EVENT_CONFLICT' USING ERRCODE='22023'; END IF;
    IF e.processed_at IS NOT NULL THEN RETURN jsonb_build_object('duplicate',true,'generation',e.generation,'accountRef',r.account_ref); END IF;
  END IF;
  -- Revoke the last readiness claim while fresh verification is in flight. A
  -- network failure must require another successful read before reservation.
  UPDATE payment_private.recipients SET generation=generation+1,status='pending' WHERE id=r.id RETURNING * INTO r;
  INSERT INTO payment_private.recipient_events(event_id,user_id,recipient_id,generation) VALUES(p_event_id,p_user_id,r.id,r.generation)
    ON CONFLICT(event_id) DO UPDATE SET generation=EXCLUDED.generation;
  RETURN jsonb_build_object('duplicate',false,'generation',r.generation,'accountRef',r.account_ref);
END; $$;
CREATE FUNCTION payment_private.recipient_apply_sync(p_user_id uuid,p_event_id text,p_generation bigint,p_account_ref text,p_state jsonb,p_livemode boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; e payment_private.recipient_events%ROWTYPE;
  state text; n integer; method boolean; submitted boolean; transfers boolean; payouts boolean;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,'sandbox');
  IF p_livemode IS DISTINCT FROM false THEN RAISE EXCEPTION 'RECIPIENT_LIVE_FORBIDDEN' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode='sandbox' FOR UPDATE;
  SELECT * INTO e FROM payment_private.recipient_events WHERE event_id=p_event_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR r.id IS NULL OR e.recipient_id<>r.id OR r.account_ref IS DISTINCT FROM p_account_ref THEN
    RAISE EXCEPTION 'RECIPIENT_EVENT_CONFLICT' USING ERRCODE='22023';
  END IF;
  IF e.processed_at IS NOT NULL THEN RETURN jsonb_build_object('applied',false); END IF;
  IF e.generation<>p_generation OR r.generation<>p_generation THEN RETURN jsonb_build_object('applied',false); END IF;
  IF p_state IS NULL OR jsonb_typeof(p_state)<>'object' OR (p_state-ARRAY['status','requirementCount','hasPayoutMethod','detailsSubmitted','transfersActive','payoutsEnabled'])<>'{}'::jsonb
    OR NOT(p_state ?& ARRAY['status','requirementCount','hasPayoutMethod','detailsSubmitted','transfersActive','payoutsEnabled'])
    OR jsonb_typeof(p_state->'requirementCount')<>'number'
    OR jsonb_typeof(p_state->'hasPayoutMethod')<>'boolean' OR jsonb_typeof(p_state->'detailsSubmitted')<>'boolean'
    OR jsonb_typeof(p_state->'transfersActive')<>'boolean' OR jsonb_typeof(p_state->'payoutsEnabled')<>'boolean' THEN
    RAISE EXCEPTION 'RECIPIENT_INVALID_STATE' USING ERRCODE='22023';
  END IF;
  state:=p_state->>'status';n:=(p_state->>'requirementCount')::integer;method:=(p_state->>'hasPayoutMethod')::boolean;
  submitted:=(p_state->>'detailsSubmitted')::boolean;transfers:=(p_state->>'transfersActive')::boolean;payouts:=(p_state->>'payoutsEnabled')::boolean;
  IF state NOT IN('onboarding','pending','ready','restricted') OR n<0 OR n>10000
    OR (state='ready' AND (n<>0 OR NOT method OR NOT submitted OR NOT transfers OR NOT payouts)) THEN
    RAISE EXCEPTION 'RECIPIENT_INVALID_STATE' USING ERRCODE='22023';
  END IF;
  UPDATE payment_private.recipients SET status=state,requirement_count=n,has_payout_method=method,details_submitted=submitted,
    transfers_active=transfers,payouts_enabled=payouts,verified_at=now(),updated_at=now() WHERE id=r.id;
  UPDATE payment_private.recipient_events SET processed_at=now() WHERE event_id=p_event_id;
  RETURN jsonb_build_object('applied',true);
END; $$;
CREATE FUNCTION payment_private.recipient_find_account(p_account_ref text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT payment_private.recipient_json(id) FROM payment_private.recipients WHERE mode='sandbox' AND account_ref=p_account_ref;
$$;

-- Lock the same profile/recipient rows used by synchronization before reserving.
-- Existing conversations, completion, rejection and withdrawal stay accessible.
CREATE FUNCTION payment_private.guard_recipient_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE required boolean;
BEGIN
  IF NEW.status NOT IN('submitted','negotiating','accepted') OR COALESCE(NEW.conversation_state,'open')<>'open' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.user_id=OLD.user_id AND OLD.status IN('submitted','negotiating','accepted') AND COALESCE(OLD.conversation_state,'open')='open' THEN RETURN NEW; END IF;
  SELECT c.mode<>'disabled' AND rc.application_gate_enabled AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=NEW.user_id)
    INTO required FROM payment_private.configuration c CROSS JOIN payment_private.recipient_configuration rc;
  IF NOT COALESCE(required,false) THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.profiles WHERE id=NEW.user_id FOR UPDATE;
  PERFORM 1 FROM payment_private.recipients r JOIN payment_private.configuration c ON c.mode=r.mode WHERE r.user_id=NEW.user_id FOR UPDATE OF r;
  IF NOT payment_private.recipient_ready(NEW.user_id) THEN RAISE EXCEPTION 'RECIPIENT_SETUP_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER require_recipient_before_reservation BEFORE INSERT OR UPDATE OF user_id,status,conversation_state ON public.applications
FOR EACH ROW EXECUTE FUNCTION payment_private.guard_recipient_application();

-- Public RPC wrappers are invokers; privileged implementations stay private.
CREATE FUNCTION public.get_recipient_settings_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_snapshot(); $$;
REVOKE ALL ON FUNCTION public.get_recipient_settings_snapshot() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_recipient_settings_snapshot(),payment_private.recipient_snapshot() TO authenticated;

CREATE FUNCTION public.pay_recipient_enroll_local(p_user_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_enroll_local(p_user_id); $$;
CREATE FUNCTION public.pay_recipient_claim(p_user_id uuid,p_mode text,p_operation_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_claim(p_user_id,p_mode,p_operation_id); $$;
CREATE FUNCTION public.pay_recipient_save_account(p_user_id uuid,p_mode text,p_operation_id uuid,p_account_ref text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_save_account(p_user_id,p_mode,p_operation_id,p_account_ref); $$;
CREATE FUNCTION public.pay_recipient_get_account(p_user_id uuid,p_mode text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_get_account(p_user_id,p_mode); $$;
CREATE FUNCTION public.pay_recipient_create_local_session(p_user_id uuid,p_operation_id uuid,p_component text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_create_local_session(p_user_id,p_operation_id,p_component); $$;
CREATE FUNCTION public.pay_recipient_finish_local_session(p_user_id uuid,p_session_id uuid,p_outcome text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_finish_local_session(p_user_id,p_session_id,p_outcome); $$;
CREATE FUNCTION public.pay_recipient_begin_sync(p_user_id uuid,p_event_id text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_begin_sync(p_user_id,p_event_id); $$;
CREATE FUNCTION public.pay_recipient_apply_sync(p_user_id uuid,p_event_id text,p_generation bigint,p_account_ref text,p_state jsonb,p_livemode boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_apply_sync(p_user_id,p_event_id,p_generation,p_account_ref,p_state,p_livemode); $$;
CREATE FUNCTION public.pay_recipient_find_account(p_account_ref text) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_find_account(p_account_ref); $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'pay_recipient_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='payment_private'::regnamespace AND p.proname LIKE 'recipient_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
    IF f.signature::text NOT LIKE '%recipient_snapshot()' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END IF;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION payment_private.recipient_snapshot() TO authenticated;
REVOKE ALL ON FUNCTION payment_private.assert_recipient(uuid,text),payment_private.guard_recipient_application() FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
