BEGIN;

-- Test-only payment readiness. No balances, charges, payouts or live objects.
CREATE SCHEMA payment_private;
REVOKE ALL ON SCHEMA payment_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA payment_private TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE payment_private.configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled','local_simulation','sandbox')),
  publication_gate_enabled boolean NOT NULL DEFAULT false,
  CHECK (NOT publication_gate_enabled OR mode <> 'disabled')
);
INSERT INTO payment_private.configuration DEFAULT VALUES;

CREATE TABLE payment_private.rollout_cohort (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_private.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('local_simulation','sandbox')),
  customer_ref text,
  claim_operation uuid NOT NULL,
  claim_expires_at timestamptz NOT NULL DEFAULT (now()+interval '2 minutes'),
  generation bigint NOT NULL DEFAULT 0,
  method_ref text,
  method_kind text CHECK (method_kind IN ('simulated','card')),
  brand text CHECK (brand ~ '^[a-zA-Z0-9_-]{1,32}$'),
  last4 text CHECK (last4 ~ '^[0-9]{4}$'),
  expiry_month smallint CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year smallint CHECK (expiry_year BETWEEN 2026 AND 2100),
  consent_version text,
  consent_at timestamptz,
  livemode boolean NOT NULL DEFAULT false CHECK (NOT livemode),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,mode), UNIQUE(mode,customer_ref), UNIQUE(mode,method_ref),
  CHECK (customer_ref IS NULL OR length(customer_ref) BETWEEN 5 AND 150),
  CHECK (customer_ref IS NULL OR (mode='sandbox' AND customer_ref ~ '^cus_[a-zA-Z0-9]+$') OR (mode='local_simulation' AND customer_ref ~ '^local_[a-zA-Z0-9_-]+$')),
  CHECK ((method_ref IS NULL AND method_kind IS NULL AND brand IS NULL AND last4 IS NULL AND expiry_month IS NULL AND expiry_year IS NULL AND consent_version IS NULL AND consent_at IS NULL)
    OR (customer_ref IS NOT NULL AND method_ref IS NOT NULL AND method_kind IS NOT NULL AND brand IS NOT NULL AND consent_version IS NOT NULL AND consent_at IS NOT NULL
      AND ((mode='local_simulation' AND brand='simulation' AND last4 IS NULL AND expiry_month IS NULL AND expiry_year IS NULL)
        OR (mode='sandbox' AND last4 IS NOT NULL AND expiry_month IS NOT NULL AND expiry_year IS NOT NULL)))),
  CHECK (method_kind IS NULL OR (mode='sandbox' AND method_kind='card' AND method_ref ~ '^pm_[a-zA-Z0-9]+$') OR (mode='local_simulation' AND method_kind='simulated' AND method_ref ~ '^local_[a-zA-Z0-9_-]+$'))
);

CREATE TABLE payment_private.setup_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES payment_private.customers(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('local_simulation','sandbox')),
  operation_id uuid NOT NULL,
  customer_generation bigint NOT NULL,
  external_session_ref text,
  return_path text NOT NULL CHECK (length(return_path)<=200 AND (return_path='/app-home/settings/payments' OR return_path ~ '^/app-home/offers/(new|edit/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})(\?resume=payment)?$')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','canceled','expired')),
  consent_version text NOT NULL CHECK (consent_version ~ '^[a-zA-Z0-9_.-]{1,80}$'),
  consent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes'),
  completed_at timestamptz,
  livemode boolean NOT NULL DEFAULT false CHECK (NOT livemode),
  UNIQUE(user_id,mode,operation_id), UNIQUE(mode,external_session_ref),
  CHECK (expires_at > created_at AND expires_at <= created_at+interval '25 hours'),
  CHECK (external_session_ref IS NULL OR (mode='sandbox' AND external_session_ref ~ '^cs_test_[a-zA-Z0-9]+$') OR (mode='local_simulation' AND external_session_ref ~ '^local_[a-zA-Z0-9_-]+$'))
);
CREATE INDEX payment_setup_customer_idx ON payment_private.setup_sessions(customer_id);
CREATE INDEX payment_setup_pending_owner_idx ON payment_private.setup_sessions(user_id,mode) WHERE status='pending';

CREATE TABLE payment_private.processed_events (
  mode text NOT NULL CHECK (mode IN ('local_simulation','sandbox')),
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('setup','remove')),
  setup_id uuid REFERENCES payment_private.setup_sessions(id) ON DELETE CASCADE,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(mode,event_id)
);
CREATE INDEX payment_events_owner_idx ON payment_private.processed_events(user_id);
CREATE INDEX payment_events_setup_idx ON payment_private.processed_events(setup_id);

CREATE TABLE payment_private.pending_detaches (
  mode text NOT NULL CHECK (mode='sandbox'),
  method_ref text NOT NULL CHECK (method_ref ~ '^pm_[a-zA-Z0-9]+$'),
  customer_id uuid NOT NULL REFERENCES payment_private.customers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  PRIMARY KEY(mode,method_ref)
);
CREATE INDEX payment_pending_detaches_customer_idx ON payment_private.pending_detaches(customer_id);

ALTER TABLE payment_private.configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.rollout_cohort ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.setup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.processed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.pending_detaches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA payment_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION payment_private.assert_mode(p_mode text, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('local_simulation','sandbox') OR NOT EXISTS(SELECT FROM payment_private.configuration c WHERE c.mode=p_mode) THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT FROM public.profiles p WHERE p.id=p_user_id AND p.account_type='job_provider') THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_REQUIRED' USING ERRCODE='42501';
  END IF;
END; $$;

CREATE FUNCTION payment_private.customer_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',c.id,'userId',c.user_id,'mode',c.mode,'stripeCustomerId',c.customer_ref,
    'pendingDetachMethodId',(SELECT d.method_ref FROM payment_private.pending_detaches d WHERE d.customer_id=c.id AND d.detached_at IS NULL ORDER BY d.created_at,d.method_ref LIMIT 1),
    'method',CASE WHEN c.method_ref IS NULL THEN NULL ELSE jsonb_build_object('id',c.method_ref,'kind',c.method_kind,'brand',c.brand,'last4',c.last4,'expiryMonth',c.expiry_month,'expiryYear',c.expiry_year) END)
  FROM payment_private.customers c WHERE c.id=p_id;
$$;
CREATE FUNCTION payment_private.setup_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',s.id,'userId',s.user_id,'mode',s.mode,'customerId',s.customer_id,'externalSessionId',s.external_session_ref,
    'returnTo',s.return_path,'status',CASE WHEN s.status='pending' AND s.expires_at<=now() THEN 'expired' ELSE s.status END,
    'consentVersion',s.consent_version,'createdAt',s.created_at,'expiresAt',s.expires_at)
  FROM payment_private.setup_sessions s WHERE s.id=p_id;
$$;

CREATE FUNCTION payment_private.buyer_ready(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT FROM payment_private.customers c JOIN payment_private.configuration config ON config.mode=c.mode
    WHERE c.user_id=p_user_id AND c.customer_ref IS NOT NULL AND c.method_ref IS NOT NULL AND c.consent_at IS NOT NULL
      AND ((c.mode='local_simulation' AND c.method_kind='simulated') OR (make_date(c.expiry_year,c.expiry_month,1)+interval '1 month' > now())));
$$;

CREATE FUNCTION payment_private.own_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE config payment_private.configuration%ROWTYPE; c payment_private.customers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO config FROM payment_private.configuration;
  SELECT * INTO c FROM payment_private.customers WHERE user_id=auth.uid() AND mode=config.mode;
  RETURN jsonb_build_object('kind',CASE config.mode WHEN 'local_simulation' THEN 'local' WHEN 'sandbox' THEN 'sandbox' ELSE 'disabled' END,
    'featureEnabled',config.publication_gate_enabled AND config.mode<>'disabled' AND EXISTS(SELECT FROM payment_private.rollout_cohort r WHERE r.user_id=auth.uid()),'buyerReady',payment_private.buyer_ready(auth.uid()),
    'method',CASE WHEN c.method_ref IS NULL THEN NULL ELSE jsonb_build_object('brand',c.brand,'last4',c.last4,'expiryMonth',c.expiry_month,'expiryYear',c.expiry_year) END,
    'pendingRemoval',EXISTS(SELECT FROM payment_private.pending_detaches d WHERE d.customer_id=c.id AND d.detached_at IS NULL),
    'recipientStatus','not_started');
END; $$;

CREATE FUNCTION payment_private.enroll_local_preview(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE synthetic_provider boolean;
BEGIN
  PERFORM payment_private.assert_mode('local_simulation',p_user_id);
  IF to_regclass('demo_private.visits') IS NULL OR to_regclass('demo_private.personas') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_LOCAL_DEMO_REQUIRED' USING ERRCODE='42501';
  END IF;
  EXECUTE 'SELECT EXISTS(SELECT FROM demo_private.personas WHERE user_id=$1 AND persona IN (''private-provider'',''company''))' INTO synthetic_provider USING p_user_id;
  IF NOT synthetic_provider THEN RAISE EXCEPTION 'PAYMENT_LOCAL_DEMO_REQUIRED' USING ERRCODE='42501'; END IF;
  INSERT INTO payment_private.rollout_cohort(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
END; $$;

CREATE FUNCTION payment_private.claim_customer(p_user_id uuid,p_mode text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c payment_private.customers%ROWTYPE; claimed boolean;
BEGIN
  PERFORM payment_private.assert_mode(p_mode,p_user_id);
  INSERT INTO payment_private.customers(user_id,mode,claim_operation) VALUES(p_user_id,p_mode,p_operation_id) ON CONFLICT(user_id,mode) DO NOTHING;
  SELECT * INTO c FROM payment_private.customers WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
  claimed:=c.customer_ref IS NULL AND (c.claim_operation=p_operation_id OR c.claim_expires_at<=now());
  IF claimed THEN UPDATE payment_private.customers SET claim_operation=p_operation_id,claim_expires_at=now()+interval '2 minutes' WHERE id=c.id; END IF;
  RETURN jsonb_build_object('claimed',claimed,'customerRef',c.customer_ref);
END; $$;
CREATE FUNCTION payment_private.save_customer(p_user_id uuid,p_mode text,p_operation_id uuid,p_customer_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c payment_private.customers%ROWTYPE;
BEGIN
  PERFORM payment_private.assert_mode(p_mode,p_user_id);
  SELECT * INTO c FROM payment_private.customers WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
  IF NOT FOUND OR c.claim_operation<>p_operation_id OR (c.customer_ref IS NOT NULL AND c.customer_ref<>p_customer_ref) OR p_customer_ref IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_CUSTOMER_CLAIM_MISMATCH' USING ERRCODE='22023';
  END IF;
  UPDATE payment_private.customers SET customer_ref=p_customer_ref,updated_at=now() WHERE id=c.id;
END; $$;
CREATE FUNCTION payment_private.get_customer(p_user_id uuid,p_mode text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT payment_private.customer_json(c.id) FROM payment_private.customers c WHERE c.user_id=p_user_id AND c.mode=p_mode;
$$;

CREATE FUNCTION payment_private.create_setup(p_user_id uuid,p_mode text,p_operation_id uuid,p_return_path text,p_consent_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c payment_private.customers%ROWTYPE; s payment_private.setup_sessions%ROWTYPE;
BEGIN
  PERFORM payment_private.assert_mode(p_mode,p_user_id);
  SELECT * INTO c FROM payment_private.customers WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
  IF NOT FOUND OR c.customer_ref IS NULL THEN RAISE EXCEPTION 'PAYMENT_CUSTOMER_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM payment_private.setup_sessions WHERE user_id=p_user_id AND mode=p_mode AND operation_id=p_operation_id;
  IF FOUND THEN
    IF s.return_path<>COALESCE(p_return_path,'/app-home/settings/payments') OR s.consent_version<>p_consent_version THEN RAISE EXCEPTION 'PAYMENT_OPERATION_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN payment_private.setup_json(s.id);
  END IF;
  UPDATE payment_private.setup_sessions SET status='canceled' WHERE customer_id=c.id AND status='pending';
  UPDATE payment_private.customers SET generation=generation+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
  INSERT INTO payment_private.setup_sessions(user_id,customer_id,mode,operation_id,customer_generation,return_path,consent_version)
    VALUES(p_user_id,c.id,p_mode,p_operation_id,c.generation,COALESCE(p_return_path,'/app-home/settings/payments'),p_consent_version) RETURNING * INTO s;
  RETURN payment_private.setup_json(s.id);
END; $$;
CREATE FUNCTION payment_private.attach_setup(p_setup_id uuid,p_external_ref text,p_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s payment_private.setup_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM payment_private.setup_sessions WHERE id=p_setup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_SETUP_NOT_FOUND' USING ERRCODE='22023'; END IF;
  PERFORM payment_private.assert_mode(s.mode,s.user_id);
  IF s.status<>'pending' OR s.expires_at<=now() OR p_external_ref IS NULL OR p_expires_at<=now() OR (s.external_session_ref IS NOT NULL AND s.external_session_ref<>p_external_ref) THEN
    RAISE EXCEPTION 'PAYMENT_SETUP_STALE' USING ERRCODE='22023';
  END IF;
  UPDATE payment_private.setup_sessions SET external_session_ref=p_external_ref,expires_at=p_expires_at WHERE id=s.id;
END; $$;
CREATE FUNCTION payment_private.get_setup(p_setup_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT payment_private.setup_json(p_setup_id); $$;

CREATE FUNCTION payment_private.complete_setup(p_setup_id uuid,p_event_id text,p_customer_ref text,p_method_ref text,p_method_kind text,p_brand text,p_last4 text,p_expiry_month integer,p_expiry_year integer,p_livemode boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s payment_private.setup_sessions%ROWTYPE; c payment_private.customers%ROWTYPE; e payment_private.processed_events%ROWTYPE;
BEGIN
  IF p_livemode IS DISTINCT FROM false THEN RAISE EXCEPTION 'LIVE_PAYMENTS_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM payment_private.setup_sessions WHERE id=p_setup_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_SETUP_NOT_FOUND' USING ERRCODE='22023'; END IF;
  PERFORM payment_private.assert_mode(s.mode,s.user_id);
  SELECT * INTO c FROM payment_private.customers WHERE id=s.customer_id FOR UPDATE;
  SELECT * INTO s FROM payment_private.setup_sessions WHERE id=p_setup_id FOR UPDATE;
  SELECT * INTO e FROM payment_private.processed_events WHERE mode=s.mode AND event_id=p_event_id;
  IF FOUND THEN
    IF e.user_id<>s.user_id OR e.operation<>'setup' OR e.setup_id IS DISTINCT FROM s.id THEN RAISE EXCEPTION 'PAYMENT_EVENT_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('applied',false,'duplicate',true);
  END IF;
  IF c.customer_ref IS DISTINCT FROM p_customer_ref OR p_method_ref IS NULL THEN RAISE EXCEPTION 'PAYMENT_CUSTOMER_MISMATCH' USING ERRCODE='22023'; END IF;
  IF s.status='complete' THEN RETURN jsonb_build_object('applied',false,'duplicate',true); END IF;
  IF s.status<>'pending' OR s.customer_generation<>c.generation OR s.expires_at<=now() OR (s.mode='sandbox' AND s.external_session_ref IS NULL) THEN
    RETURN jsonb_build_object('applied',false,'reason','PAYMENT_SETUP_STALE');
  END IF;
  -- Keep retirement evidence after a successful external detach. A delayed
  -- previously inspected setup must never revive that same PaymentMethod ID.
  IF EXISTS(SELECT FROM payment_private.pending_detaches d WHERE d.mode=s.mode AND d.method_ref=p_method_ref) THEN
    RETURN jsonb_build_object('applied',false,'reason','PAYMENT_SETUP_STALE');
  END IF;
  INSERT INTO payment_private.processed_events(mode,event_id,user_id,operation,setup_id) VALUES(s.mode,p_event_id,s.user_id,'setup',s.id);
  IF s.mode='sandbox' AND c.method_ref IS NOT NULL AND c.method_ref<>p_method_ref THEN
    INSERT INTO payment_private.pending_detaches(mode,method_ref,customer_id) VALUES(s.mode,c.method_ref,c.id) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE payment_private.customers SET method_ref=p_method_ref,method_kind=p_method_kind,brand=p_brand,last4=p_last4,expiry_month=p_expiry_month,expiry_year=p_expiry_year,
    consent_version=s.consent_version,consent_at=s.consent_at,updated_at=now() WHERE id=c.id;
  UPDATE payment_private.setup_sessions SET status='complete',completed_at=now() WHERE id=s.id;
  RETURN jsonb_build_object('applied',true);
END; $$;
CREATE FUNCTION payment_private.remove_method(p_user_id uuid,p_mode text,p_event_id text,p_method_ref text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c payment_private.customers%ROWTYPE; e payment_private.processed_events%ROWTYPE;
BEGIN
  PERFORM payment_private.assert_mode(p_mode,p_user_id);
  SELECT * INTO c FROM payment_private.customers WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO e FROM payment_private.processed_events WHERE mode=p_mode AND event_id=p_event_id;
  IF FOUND THEN
    IF e.user_id<>p_user_id OR e.operation<>'remove' THEN RAISE EXCEPTION 'PAYMENT_EVENT_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN;
  END IF;
  INSERT INTO payment_private.processed_events(mode,event_id,user_id,operation) VALUES(p_mode,p_event_id,p_user_id,'remove');
  IF p_method_ref IS NOT NULL AND c.method_ref IS DISTINCT FROM p_method_ref THEN RETURN; END IF;
  IF p_mode='sandbox' AND c.method_ref IS NOT NULL THEN
    INSERT INTO payment_private.pending_detaches(mode,method_ref,customer_id) VALUES(p_mode,c.method_ref,c.id) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE payment_private.customers SET method_ref=NULL,method_kind=NULL,brand=NULL,last4=NULL,expiry_month=NULL,expiry_year=NULL,consent_version=NULL,consent_at=NULL,generation=generation+1,updated_at=now() WHERE id=c.id;
  UPDATE payment_private.setup_sessions SET status='canceled' WHERE customer_id=c.id AND status='pending';
END; $$;
CREATE FUNCTION payment_private.confirm_detach(p_user_id uuid,p_mode text,p_method_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE payment_private.pending_detaches d SET detached_at=COALESCE(d.detached_at,now()) FROM payment_private.customers c WHERE c.id=d.customer_id AND c.user_id=p_user_id AND d.mode=p_mode AND d.method_ref=p_method_ref;
END; $$;
CREATE FUNCTION payment_private.remove_by_reference(p_mode text,p_event_id text,p_method_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c payment_private.customers%ROWTYPE;
BEGIN
  SELECT customers.* INTO c FROM payment_private.customers customers WHERE customers.mode=p_mode AND
    (customers.method_ref=p_method_ref OR EXISTS(SELECT FROM payment_private.pending_detaches d WHERE d.customer_id=customers.id AND d.mode=p_mode AND d.method_ref=p_method_ref));
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM payment_private.remove_method(c.user_id,p_mode,p_event_id,p_method_ref);
  PERFORM payment_private.confirm_detach(c.user_id,p_mode,p_method_ref);
END; $$;
CREATE FUNCTION payment_private.cancel_setup(p_setup_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s payment_private.setup_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM payment_private.setup_sessions WHERE id=p_setup_id;
  IF NOT FOUND OR s.user_id<>p_user_id THEN RAISE EXCEPTION 'PAYMENT_SETUP_NOT_FOUND' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM payment_private.customers WHERE id=s.customer_id FOR UPDATE;
  UPDATE payment_private.setup_sessions SET status='canceled' WHERE id=s.id AND status='pending';
END; $$;

-- A database boundary covers insert, edit, publish and lifecycle re-open paths.
-- Cancellation must remain possible after removal/expiry of a payment method.
CREATE FUNCTION payment_private.guard_job_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE enabled boolean; address_ready boolean; payment_ready boolean; c payment_private.customers%ROWTYPE;
BEGIN
  SELECT publication_gate_enabled AND mode<>'disabled' INTO enabled FROM payment_private.configuration;
  IF NOT enabled OR NOT EXISTS(SELECT FROM payment_private.rollout_cohort r WHERE r.user_id=NEW.posted_by) THEN RETURN NEW; END IF;
  -- Existing published offers remain editable. Readiness is a publication
  -- boundary, not a retroactive restriction on an unchanged owner's offer.
  IF TG_OP='UPDATE' AND OLD.status='open' AND NEW.status='open' AND OLD.posted_by IS NOT DISTINCT FROM NEW.posted_by THEN RETURN NEW; END IF;
  IF NEW.status<>'open' THEN
    IF TG_OP<>'UPDATE' THEN RETURN NEW; END IF;
    IF NOT (OLD.status='closed' AND NEW.status IN ('reserved','filled')) THEN RETURN NEW; END IF;
  END IF;
  SELECT EXISTS(SELECT FROM public.profiles p WHERE p.id=NEW.posted_by AND p.account_type='job_provider' AND p.provider_verification_status='verified' AND p.provider_verified_at IS NOT NULL) INTO address_ready;
  -- Serialize publication with method removal/replacement, using the locked row.
  SELECT customer.* INTO c FROM payment_private.customers customer JOIN payment_private.configuration config ON config.mode=customer.mode
    WHERE customer.user_id=NEW.posted_by FOR SHARE OF customer;
  payment_ready:=FOUND AND c.customer_ref IS NOT NULL AND c.method_ref IS NOT NULL AND c.consent_at IS NOT NULL
    AND ((c.mode='local_simulation' AND c.method_kind='simulated') OR (make_date(c.expiry_year,c.expiry_month,1)+interval '1 month' > now()));
  IF address_ready AND payment_ready THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('reserved','filled','reviewing') AND NEW.filled_by IS NULL
    AND NOT EXISTS(SELECT FROM public.applications a WHERE a.job_id=NEW.id AND a.is_primary AND a.status IN('submitted','negotiating','accepted') AND a.conversation_state='open') THEN
    NEW.status:='draft';
    RETURN NEW;
  END IF;
  IF NOT address_ready THEN RAISE EXCEPTION 'provider_verification_required' USING ERRCODE='42501'; END IF;
  RAISE EXCEPTION 'buyer_payment_required' USING ERRCODE='42501';
END; $$;
CREATE TRIGGER pay_guard_job_publication BEFORE INSERT OR UPDATE OF status,posted_by ON public.jobs FOR EACH ROW EXECUTE FUNCTION payment_private.guard_job_publication();

-- Report the actual post-trigger publication state, not the attempted UPDATE.
CREATE OR REPLACE FUNCTION activity_private._activity_rebalance_job(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_job public.jobs%ROWTYPE; v_primary public.applications%ROWTYPE; v_status public.job_status;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Job nicht gefunden.'); END IF;
  IF v_job.status IN ('draft','closed') THEN RETURN jsonb_build_object('ok',true,'action','unchanged'); END IF;
  SELECT * INTO v_primary FROM public.applications WHERE job_id=p_job_id AND is_primary AND conversation_state='open' AND status IN ('submitted','negotiating','accepted') LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.jobs SET status=CASE WHEN v_primary.status='accepted' THEN 'filled'::public.job_status ELSE 'reserved'::public.job_status END,
      filled_by=CASE WHEN v_primary.status='accepted' THEN v_primary.user_id ELSE NULL END,
      filled_at=CASE WHEN v_primary.status='accepted' THEN COALESCE(filled_at,now()) ELSE NULL END,updated_at=now() WHERE id=p_job_id;
    RETURN jsonb_build_object('ok',true,'action','primary_kept','application_id',v_primary.id);
  END IF;
  UPDATE public.jobs SET status='open',filled_by=NULL,filled_at=NULL,completed_at=NULL,updated_at=now()
    WHERE id=p_job_id AND status IN ('reserved','reviewing','filled') RETURNING status INTO v_status;
  RETURN jsonb_build_object('ok',true,'action',CASE WHEN v_status='draft' THEN 'job_unpublished' ELSE 'job_reopened' END,'status',COALESCE(v_status,v_job.status));
END; $$;

-- Exposed wrappers are invokers only; privileged functions remain unexposed.
CREATE FUNCTION public.get_payment_settings_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.own_snapshot(); $$;
CREATE FUNCTION public.pay_claim_customer(p_user_id uuid,p_mode text,p_operation_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.claim_customer(p_user_id,p_mode,p_operation_id); $$;
CREATE FUNCTION public.pay_save_customer(p_user_id uuid,p_mode text,p_operation_id uuid,p_customer_ref text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.save_customer(p_user_id,p_mode,p_operation_id,p_customer_ref); $$;
CREATE FUNCTION public.pay_get_customer(p_user_id uuid,p_mode text) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.get_customer(p_user_id,p_mode); $$;
CREATE FUNCTION public.pay_create_setup(p_user_id uuid,p_mode text,p_operation_id uuid,p_return_path text,p_consent_version text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.create_setup(p_user_id,p_mode,p_operation_id,p_return_path,p_consent_version); $$;
CREATE FUNCTION public.pay_attach_setup_session(p_setup_id uuid,p_external_ref text,p_expires_at timestamptz) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.attach_setup(p_setup_id,p_external_ref,p_expires_at); $$;
CREATE FUNCTION public.pay_get_setup(p_setup_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.get_setup(p_setup_id); $$;
CREATE FUNCTION public.pay_complete_setup(p_setup_id uuid,p_event_id text,p_customer_ref text,p_method_ref text,p_method_kind text,p_brand text,p_last4 text,p_expiry_month integer,p_expiry_year integer,p_livemode boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.complete_setup(p_setup_id,p_event_id,p_customer_ref,p_method_ref,p_method_kind,p_brand,p_last4,p_expiry_month,p_expiry_year,p_livemode); $$;
CREATE FUNCTION public.pay_remove_method(p_user_id uuid,p_mode text,p_event_id text,p_method_ref text DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.remove_method(p_user_id,p_mode,p_event_id,p_method_ref); $$;
CREATE FUNCTION public.pay_cancel_setup(p_setup_id uuid,p_user_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.cancel_setup(p_setup_id,p_user_id); $$;
CREATE FUNCTION public.pay_remove_method_by_reference(p_mode text,p_event_id text,p_method_ref text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.remove_by_reference(p_mode,p_event_id,p_method_ref); $$;
CREATE FUNCTION public.pay_confirm_method_detached(p_user_id uuid,p_mode text,p_method_ref text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.confirm_detach(p_user_id,p_mode,p_method_ref); $$;
CREATE FUNCTION public.pay_enroll_local_preview(p_user_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.enroll_local_preview(p_user_id); $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA payment_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION payment_private.own_snapshot() TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA payment_private TO service_role;
REVOKE ALL ON FUNCTION public.get_payment_settings_snapshot() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_settings_snapshot() TO authenticated;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('pay_claim_customer','pay_save_customer','pay_get_customer','pay_create_setup','pay_attach_setup_session','pay_get_setup','pay_complete_setup','pay_remove_method','pay_cancel_setup','pay_remove_method_by_reference','pay_confirm_method_detached','pay_enroll_local_preview') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END; $$;

COMMIT;
