BEGIN;

-- Explicit production configuration. Applying this migration does not enable
-- payments, publish/reserve gates, recipient eligibility or money movement.
-- Sandbox identities and their records never become real-money readiness.
CREATE TABLE payment_private.live_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  buyer_setup_enabled boolean NOT NULL DEFAULT false,
  recipient_setup_enabled boolean NOT NULL DEFAULT false,
  adult_model_approved boolean NOT NULL DEFAULT false,
  orders_enabled boolean NOT NULL DEFAULT false,
  CHECK(NOT (buyer_setup_enabled OR recipient_setup_enabled OR orders_enabled) OR enabled),
  CHECK(NOT orders_enabled OR (buyer_setup_enabled AND recipient_setup_enabled AND adult_model_approved))
);
INSERT INTO payment_private.live_configuration DEFAULT VALUES;
ALTER TABLE payment_private.live_configuration ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.live_configuration FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE payment_private.recipients ADD COLUMN claim_contact_email text,
  ADD COLUMN claim_display_name text;

ALTER TABLE payment_private.configuration DROP CONSTRAINT configuration_mode_check;
ALTER TABLE payment_private.configuration ADD CONSTRAINT configuration_mode_check CHECK(mode IN('disabled','local_simulation','sandbox','live'));


ALTER TABLE payment_private.customers DROP CONSTRAINT customers_mode_check;
ALTER TABLE payment_private.customers ADD CONSTRAINT customers_mode_check CHECK(mode IN('local_simulation','sandbox','live'));

ALTER TABLE payment_private.setup_sessions DROP CONSTRAINT setup_sessions_mode_check;
ALTER TABLE payment_private.setup_sessions ADD CONSTRAINT setup_sessions_mode_check CHECK(mode IN('local_simulation','sandbox','live'));

ALTER TABLE payment_private.processed_events DROP CONSTRAINT processed_events_mode_check;
ALTER TABLE payment_private.processed_events ADD CONSTRAINT processed_events_mode_check CHECK(mode IN('local_simulation','sandbox','live'));

ALTER TABLE payment_private.recipients DROP CONSTRAINT recipients_mode_check;
ALTER TABLE payment_private.recipients ADD CONSTRAINT recipients_mode_check CHECK(mode IN('local_simulation','sandbox','live'));

ALTER TABLE payment_private.orders DROP CONSTRAINT orders_mode_check;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_mode_check CHECK(mode IN('local_simulation','sandbox','live'));

ALTER TABLE payment_private.customers DROP CONSTRAINT customers_livemode_check;
ALTER TABLE payment_private.customers ADD CONSTRAINT customers_livemode_check CHECK(livemode=(mode='live'));

ALTER TABLE payment_private.setup_sessions DROP CONSTRAINT setup_sessions_livemode_check;
ALTER TABLE payment_private.setup_sessions ADD CONSTRAINT setup_sessions_livemode_check CHECK(livemode=(mode='live'));

ALTER TABLE payment_private.recipients DROP CONSTRAINT recipients_livemode_check;
ALTER TABLE payment_private.recipients ADD CONSTRAINT recipients_livemode_check CHECK(livemode=(mode='live'));

ALTER TABLE payment_private.orders DROP CONSTRAINT orders_livemode_check;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_livemode_check CHECK(livemode=(mode='live'));

ALTER TABLE payment_private.pending_detaches DROP CONSTRAINT pending_detaches_mode_check;
ALTER TABLE payment_private.pending_detaches ADD CONSTRAINT pending_detaches_mode_check CHECK(mode IN('sandbox','live'));
ALTER TABLE payment_private.customers DROP CONSTRAINT customers_check;
ALTER TABLE payment_private.customers ADD CONSTRAINT customers_check CHECK(customer_ref IS NULL OR
  (mode IN('sandbox','live') AND customer_ref ~ '^cus_[a-zA-Z0-9]+$') OR (mode='local_simulation' AND customer_ref ~ '^local_[a-zA-Z0-9_-]+$'));
ALTER TABLE payment_private.customers DROP CONSTRAINT customers_check1;
ALTER TABLE payment_private.customers ADD CONSTRAINT customers_check1 CHECK(
  (method_ref IS NULL AND method_kind IS NULL AND brand IS NULL AND last4 IS NULL AND expiry_month IS NULL AND expiry_year IS NULL AND consent_version IS NULL AND consent_at IS NULL)
  OR (customer_ref IS NOT NULL AND method_ref IS NOT NULL AND method_kind IS NOT NULL AND brand IS NOT NULL AND consent_version IS NOT NULL AND consent_at IS NOT NULL
    AND ((mode='local_simulation' AND brand='simulation' AND last4 IS NULL AND expiry_month IS NULL AND expiry_year IS NULL)
      OR (mode IN('sandbox','live') AND last4 IS NOT NULL AND expiry_month IS NOT NULL AND expiry_year IS NOT NULL))));
ALTER TABLE payment_private.customers DROP CONSTRAINT customers_check2;
ALTER TABLE payment_private.customers ADD CONSTRAINT customers_check2 CHECK(method_kind IS NULL
  OR (mode IN('sandbox','live') AND method_kind='card' AND method_ref ~ '^pm_[a-zA-Z0-9]+$')
  OR (mode='local_simulation' AND method_kind='simulated' AND method_ref ~ '^local_[a-zA-Z0-9_-]+$'));
ALTER TABLE payment_private.setup_sessions DROP CONSTRAINT setup_sessions_check1;
ALTER TABLE payment_private.setup_sessions ADD CONSTRAINT setup_sessions_check1 CHECK(external_session_ref IS NULL
  OR (mode='sandbox' AND external_session_ref ~ '^cs_test_[a-zA-Z0-9]+$')
  OR (mode='live' AND external_session_ref ~ '^cs_live_[a-zA-Z0-9]+$')
  OR (mode='local_simulation' AND external_session_ref ~ '^local_[a-zA-Z0-9_-]+$'));
ALTER TABLE payment_private.recipients DROP CONSTRAINT recipients_check;
ALTER TABLE payment_private.recipients ADD CONSTRAINT recipients_check CHECK(account_ref IS NULL
  OR (mode IN('sandbox','live') AND account_ref ~ '^acct_[a-zA-Z0-9]+$')
  OR (mode='local_simulation' AND account_ref ~ '^local_recipient_[a-zA-Z0-9_-]+$'));
ALTER TABLE payment_private.orders DROP CONSTRAINT orders_check4;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_check4 CHECK(intent_ref IS NULL
  OR (mode IN('sandbox','live') AND intent_ref ~ '^pi_[a-zA-Z0-9]+$')
  OR (mode='local_simulation' AND intent_ref ~ '^local_pi_[a-zA-Z0-9_-]+$'));
ALTER TABLE payment_private.orders DROP CONSTRAINT orders_check5;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_check5 CHECK(refund_ref IS NULL
  OR (mode IN('sandbox','live') AND refund_ref ~ '^re_[a-zA-Z0-9]+$')
  OR (mode='local_simulation' AND refund_ref ~ '^local_refund_[a-zA-Z0-9_-]+$'));

-- The gross platform surcharge is 5%. This does not invent a tax registration,
-- VAT rate, net tax amount, processor-cost guarantee or 5% net profit promise.


CREATE OR REPLACE FUNCTION payment_private.order_fee_tariff(p_earnings integer,p_policy text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE fee integer; tax integer;
BEGIN
  IF p_earnings IS NULL OR p_earnings NOT BETWEEN 50 AND 99999999 THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_policy='local-zero-fee-v1' THEN RETURN NULL; END IF;
  IF p_policy NOT IN('test-service-5-v1','workfare-service-5-v1') OR p_policy IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_TARIFF_REQUIRED' USING ERRCODE='22023';
  END IF;
  fee:=round(p_earnings::numeric*500/10000)::integer;
  IF p_earnings::bigint+fee>99999999 THEN RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  IF p_policy='workfare-service-5-v1' THEN
    RETURN jsonb_build_object('version',p_policy,'scope','live','rateBasisPoints',500,
      'grossCents',fee,'netCents',NULL,'taxCents',NULL,'tax',NULL);
  END IF;
  tax:=round(fee::numeric*1900/11900)::integer;
  RETURN jsonb_build_object('version','test-service-5-v1','scope','local_test_only','rateBasisPoints',500,
    'grossCents',fee,'netCents',fee-tax,'taxCents',tax,'tax',jsonb_build_object('jurisdiction','DE',
      'treatment','simulation_vat_included','rateBasisPoints',1900,'determinationReference','sandbox-de-vat19-assumption-v1'));
END; $$;

ALTER TABLE payment_private.order_configuration DROP CONSTRAINT order_configuration_fee_policy_check;
ALTER TABLE payment_private.order_configuration ADD CONSTRAINT order_configuration_fee_policy_check CHECK(fee_policy IS NULL OR fee_policy IN('local-zero-fee-v1','test-service-5-v1','workfare-service-5-v1'));
ALTER TABLE payment_private.orders DROP CONSTRAINT orders_fee_policy_check;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_fee_policy_check CHECK(
  (mode='live' AND fee_policy='workfare-service-5-v1') OR (mode<>'live' AND fee_policy IN('local-zero-fee-v1','test-service-5-v1')));
ALTER TABLE payment_private.orders DROP CONSTRAINT orders_fee_tariff_check;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_fee_tariff_check CHECK(
  (fee_policy='local-zero-fee-v1' AND fee_cents=0 AND fee_tariff IS NULL)
  OR (fee_policy IN('test-service-5-v1','workfare-service-5-v1') AND fee_tariff IS NOT NULL
    AND fee_tariff=payment_private.order_fee_tariff(earnings_cents,fee_policy)
    AND fee_cents=(fee_tariff->>'grossCents')::integer));

CREATE FUNCTION payment_private.live_identity(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE valid boolean;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN RETURN false; END IF;
  EXECUTE $query$ SELECT EXISTS(SELECT FROM auth.users u WHERE u.id=$1 AND u.email IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
    AND COALESCE(u.raw_app_meta_data->>'demo_session_id','')=''
    AND COALESCE(u.raw_app_meta_data->>'demo_identity','')=''
    AND lower(u.email) NOT LIKE '%@example.test') $query$ INTO valid USING p_user_id;
  RETURN COALESCE(valid,false);
END; $$;
REVOKE ALL ON FUNCTION payment_private.live_identity(uuid) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION payment_private.assert_mode(p_mode text,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN('local_simulation','sandbox','live') OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode) THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT FROM public.profiles WHERE id=p_user_id AND account_type='job_provider') THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_mode='live' AND (NOT EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND buyer_setup_enabled)
    OR NOT payment_private.live_identity(p_user_id)
    OR NOT EXISTS(SELECT FROM public.profiles WHERE id=p_user_id AND country='DE' AND birthdate IS NOT NULL
      AND birthdate<=(current_date-interval '18 years')::date)) THEN RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501'; END IF;
  IF p_mode='sandbox' THEN PERFORM payment_private.assert_sandbox_preview(p_user_id,'provider'); END IF;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.assert_recipient(p_user_id uuid,p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN('local_simulation','sandbox','live') OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode) THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND OR p.account_type IS DISTINCT FROM 'job_seeker' THEN RAISE EXCEPTION 'RECIPIENT_SEEKER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_mode='live' THEN
    IF NOT EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND recipient_setup_enabled AND adult_model_approved)
      OR NOT payment_private.live_identity(p_user_id) OR p.country IS DISTINCT FROM 'DE' OR p.birthdate IS NULL
      OR p.birthdate>(current_date-interval '18 years')::date OR p.birthdate<=(current_date-interval '21 years')::date THEN
      RAISE EXCEPTION 'RECIPIENT_MODEL_NOT_APPROVED' USING ERRCODE='42501'; END IF;
    RETURN;
  END IF;
  IF p_mode='local_simulation' THEN
    IF NOT payment_private.recipient_synthetic(p_user_id) OR NOT EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p_user_id) THEN
      RAISE EXCEPTION 'RECIPIENT_LOCAL_DEMO_REQUIRED' USING ERRCODE='42501';
    END IF;
  ELSE
    IF p.country IS DISTINCT FROM 'DE' OR p.birthdate IS NULL OR p.birthdate>(current_date-interval '18 years')::date THEN
      RAISE EXCEPTION 'RECIPIENT_MODEL_NOT_APPROVED' USING ERRCODE='42501';
    END IF;
    PERFORM payment_private.assert_sandbox_preview(p_user_id,'recipient');
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.buyer_ready(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT FROM payment_private.customers c JOIN payment_private.configuration config ON config.mode=c.mode
    WHERE c.user_id=p_user_id AND c.customer_ref IS NOT NULL AND c.method_ref IS NOT NULL AND c.consent_at IS NOT NULL
      AND (c.mode<>'live' OR (payment_private.live_identity(p_user_id) AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND buyer_setup_enabled)))
      AND ((c.mode='local_simulation' AND c.method_kind='simulated') OR (make_date(c.expiry_year,c.expiry_month,1)+interval '1 month' > now())));
$$;

CREATE OR REPLACE FUNCTION payment_private.own_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE config payment_private.configuration%ROWTYPE; c payment_private.customers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO config FROM payment_private.configuration;
  SELECT * INTO c FROM payment_private.customers WHERE user_id=auth.uid() AND mode=config.mode;
  RETURN jsonb_build_object('kind',CASE config.mode WHEN 'local_simulation' THEN 'local' WHEN 'sandbox' THEN 'sandbox' WHEN 'live' THEN 'live' ELSE 'disabled' END,
    'setupEnabled',config.mode='live' AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND buyer_setup_enabled),
    'featureEnabled',config.publication_gate_enabled AND config.mode<>'disabled'
      AND ((config.mode='live' AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND buyer_setup_enabled))
        OR (config.mode<>'live' AND EXISTS(SELECT FROM payment_private.rollout_cohort r WHERE r.user_id=auth.uid()))),'buyerReady',payment_private.buyer_ready(auth.uid()),
    'method',CASE WHEN c.method_ref IS NULL THEN NULL ELSE jsonb_build_object('brand',c.brand,'last4',c.last4,'expiryMonth',c.expiry_month,'expiryYear',c.expiry_year) END,
    'pendingRemoval',EXISTS(SELECT FROM payment_private.pending_detaches d WHERE d.customer_id=c.id AND d.detached_at IS NULL),
    'recipientStatus','not_started');
END; $$;

CREATE OR REPLACE FUNCTION payment_private.claim_customer(p_user_id uuid,p_mode text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c payment_private.customers%ROWTYPE; claimed boolean;
BEGIN
  PERFORM payment_private.assert_mode(p_mode,p_user_id);
  INSERT INTO payment_private.customers(user_id,mode,claim_operation,livemode) VALUES(p_user_id,p_mode,p_operation_id,p_mode='live') ON CONFLICT(user_id,mode) DO NOTHING;
  SELECT * INTO c FROM payment_private.customers WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
  claimed:=c.customer_ref IS NULL AND (c.claim_operation=p_operation_id OR c.claim_expires_at<=now());
  IF claimed THEN UPDATE payment_private.customers SET claim_operation=p_operation_id,claim_expires_at=now()+interval '2 minutes' WHERE id=c.id; END IF;
  RETURN jsonb_build_object('claimed',claimed,'customerRef',c.customer_ref);
END; $$;

CREATE OR REPLACE FUNCTION payment_private.create_setup(p_user_id uuid,p_mode text,p_operation_id uuid,p_return_path text,p_consent_version text)
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
  INSERT INTO payment_private.setup_sessions(user_id,customer_id,mode,operation_id,customer_generation,return_path,consent_version,livemode)
    VALUES(p_user_id,c.id,p_mode,p_operation_id,c.generation,COALESCE(p_return_path,'/app-home/settings/payments'),p_consent_version,p_mode='live') RETURNING * INTO s;
  RETURN payment_private.setup_json(s.id);
END; $$;

CREATE OR REPLACE FUNCTION payment_private.complete_setup(p_setup_id uuid,p_event_id text,p_customer_ref text,p_method_ref text,p_method_kind text,p_brand text,p_last4 text,p_expiry_month integer,p_expiry_year integer,p_livemode boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s payment_private.setup_sessions%ROWTYPE; c payment_private.customers%ROWTYPE; e payment_private.processed_events%ROWTYPE;
BEGIN
  SELECT * INTO s FROM payment_private.setup_sessions WHERE id=p_setup_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_SETUP_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF p_livemode IS DISTINCT FROM (s.mode='live') THEN RAISE EXCEPTION 'PAYMENT_OBJECT_MODE_MISMATCH' USING ERRCODE='42501'; END IF;
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
  IF s.status<>'pending' OR s.customer_generation<>c.generation OR s.expires_at<=now() OR (s.mode IN('sandbox','live') AND s.external_session_ref IS NULL) THEN
    RETURN jsonb_build_object('applied',false,'reason','PAYMENT_SETUP_STALE');
  END IF;
  -- Keep retirement evidence after a successful external detach. A delayed
  -- previously inspected setup must never revive that same PaymentMethod ID.
  IF EXISTS(SELECT FROM payment_private.pending_detaches d WHERE d.mode=s.mode AND d.method_ref=p_method_ref) THEN
    RETURN jsonb_build_object('applied',false,'reason','PAYMENT_SETUP_STALE');
  END IF;
  INSERT INTO payment_private.processed_events(mode,event_id,user_id,operation,setup_id) VALUES(s.mode,p_event_id,s.user_id,'setup',s.id);
  IF s.mode IN('sandbox','live') AND c.method_ref IS NOT NULL AND c.method_ref<>p_method_ref THEN
    INSERT INTO payment_private.pending_detaches(mode,method_ref,customer_id) VALUES(s.mode,c.method_ref,c.id) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE payment_private.customers SET method_ref=p_method_ref,method_kind=p_method_kind,brand=p_brand,last4=p_last4,expiry_month=p_expiry_month,expiry_year=p_expiry_year,
    consent_version=s.consent_version,consent_at=s.consent_at,updated_at=now() WHERE id=c.id;
  UPDATE payment_private.setup_sessions SET status='complete',completed_at=now() WHERE id=s.id;
  RETURN jsonb_build_object('applied',true);
END; $$;

CREATE OR REPLACE FUNCTION payment_private.remove_method(p_user_id uuid,p_mode text,p_event_id text,p_method_ref text DEFAULT NULL)
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
  IF p_mode IN('sandbox','live') AND c.method_ref IS NOT NULL THEN
    INSERT INTO payment_private.pending_detaches(mode,method_ref,customer_id) VALUES(p_mode,c.method_ref,c.id) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE payment_private.customers SET method_ref=NULL,method_kind=NULL,brand=NULL,last4=NULL,expiry_month=NULL,expiry_year=NULL,consent_version=NULL,consent_at=NULL,generation=generation+1,updated_at=now() WHERE id=c.id;
  UPDATE payment_private.setup_sessions SET status='canceled' WHERE customer_id=c.id AND status='pending';
END; $$;

CREATE OR REPLACE FUNCTION payment_private.recipient_ready(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT FROM payment_private.recipients r JOIN payment_private.configuration c ON c.mode=r.mode
    JOIN public.profiles p ON p.id=r.user_id CROSS JOIN payment_private.recipient_configuration rc
    WHERE r.user_id=p_user_id AND p.account_type='job_seeker' AND r.status='ready' AND r.account_ref IS NOT NULL
      AND r.requirement_count=0 AND r.has_payout_method AND r.details_submitted AND r.transfers_active AND r.payouts_enabled AND r.verified_at IS NOT NULL
      AND ((r.mode='live' AND r.livemode AND p.country='DE' AND p.birthdate IS NOT NULL
          AND p.birthdate<=(current_date-interval '18 years')::date AND p.birthdate>(current_date-interval '21 years')::date
          AND payment_private.live_identity(r.user_id) AND r.verified_at>now()-interval '24 hours'
          AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND recipient_setup_enabled AND adult_model_approved))
        OR (r.mode='local_simulation' AND payment_private.recipient_synthetic(r.user_id) AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=r.user_id))
        OR (r.mode='sandbox' AND rc.sandbox_adult_enabled AND p.country='DE'
          AND payment_private.sandbox_synthetic(r.user_id,'recipient') AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=r.user_id)
          AND r.verified_at>now()-interval '24 hours')));
$$;

CREATE OR REPLACE FUNCTION payment_private.recipient_snapshot()
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
    WHEN 'live' THEN eligible='adult' AND p.country='DE' AND p.birthdate>(current_date-interval '21 years')::date
      AND payment_private.live_identity(p.id) AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND recipient_setup_enabled AND adult_model_approved)
    WHEN 'sandbox' THEN eligible='adult' AND rc.sandbox_adult_enabled AND payment_private.sandbox_synthetic(p.id,'recipient')
      AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p.id) ELSE false END;
  active:=payment_private.recipient_ready(auth.uid());
  RETURN jsonb_build_object('kind',CASE c.mode WHEN 'local_simulation' THEN 'local' WHEN 'sandbox' THEN 'sandbox' WHEN 'live' THEN 'live' ELSE 'disabled' END,
    'setupEnabled',c.mode='live' AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND recipient_setup_enabled),
    'featureEnabled',c.mode<>'disabled' AND rc.application_gate_enabled
      AND ((c.mode='live' AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND recipient_setup_enabled AND adult_model_approved))
        OR (c.mode<>'live' AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p.id))),
    'status',CASE WHEN r.id IS NULL THEN 'not_started' WHEN r.status='ready' AND NOT active THEN 'pending' ELSE r.status END,
    'canStart',can_start,'eligibility',eligible,'requirementCount',COALESCE(r.requirement_count,0),
    'hasPayoutMethod',COALESCE(r.has_payout_method,false),'detailsSubmitted',COALESCE(r.details_submitted,false),
    'transfersActive',COALESCE(r.transfers_active,false),'payoutsEnabled',COALESCE(r.payouts_enabled,false),'checkedAt',r.verified_at);
END; $$;

-- Freeze the verified contact on the first create claim. Stripe account-create
-- idempotency must never replay a different person's/email payload after edits.
CREATE OR REPLACE FUNCTION payment_private.recipient_claim(p_user_id uuid,p_mode text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; claimed boolean; email text; display_name text;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,p_mode);
  IF p_mode='live' THEN
    SELECT u.email,p.full_name INTO email,display_name FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=p_user_id;
  END IF;
  INSERT INTO payment_private.recipients(user_id,mode,claim_operation,livemode,claim_contact_email,claim_display_name)
    VALUES(p_user_id,p_mode,p_operation_id,p_mode='live',email,display_name) ON CONFLICT(user_id,mode) DO NOTHING;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
  claimed:=r.account_ref IS NULL AND (r.claim_operation=p_operation_id OR r.claim_expires_at<=now());
  IF claimed THEN UPDATE payment_private.recipients SET claim_operation=p_operation_id,claim_expires_at=now()+interval '2 minutes' WHERE id=r.id; END IF;
  RETURN jsonb_build_object('claimed',claimed,'accountRef',r.account_ref)
    || CASE WHEN p_mode='live' THEN jsonb_build_object('prefill',jsonb_strip_nulls(jsonb_build_object('contactEmail',r.claim_contact_email,'displayName',r.claim_display_name))) ELSE '{}'::jsonb END;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.recipient_begin_sync(p_user_id uuid,p_event_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; e payment_private.recipient_events%ROWTYPE;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,(SELECT mode FROM payment_private.configuration));
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode=(SELECT mode FROM payment_private.configuration) FOR UPDATE;
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

CREATE OR REPLACE FUNCTION payment_private.recipient_apply_sync(p_user_id uuid,p_event_id text,p_generation bigint,p_account_ref text,p_state jsonb,p_livemode boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; e payment_private.recipient_events%ROWTYPE;
  state text; n integer; method boolean; submitted boolean; transfers boolean; payouts boolean;
BEGIN
  PERFORM payment_private.assert_recipient(p_user_id,(SELECT mode FROM payment_private.configuration));
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode=(SELECT mode FROM payment_private.configuration) FOR UPDATE;
  SELECT * INTO e FROM payment_private.recipient_events WHERE event_id=p_event_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR r.id IS NULL OR e.recipient_id<>r.id OR r.account_ref IS DISTINCT FROM p_account_ref THEN
    RAISE EXCEPTION 'RECIPIENT_EVENT_CONFLICT' USING ERRCODE='22023';
  END IF;
  IF p_livemode IS DISTINCT FROM (r.mode='live') THEN RAISE EXCEPTION 'RECIPIENT_OBJECT_MODE_MISMATCH' USING ERRCODE='22023'; END IF;
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

CREATE OR REPLACE FUNCTION payment_private.recipient_find_account(p_account_ref text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT payment_private.recipient_json(id) FROM payment_private.recipients WHERE mode=(SELECT mode FROM payment_private.configuration) AND account_ref=p_account_ref;
$$;

CREATE OR REPLACE FUNCTION payment_private.guard_job_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE enabled boolean; address_ready boolean; payment_ready boolean; c payment_private.customers%ROWTYPE;
BEGIN
  SELECT publication_gate_enabled AND mode<>'disabled' INTO enabled FROM payment_private.configuration;
  IF NOT enabled OR NOT EXISTS(SELECT FROM payment_private.configuration config WHERE
    (config.mode='live' AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND buyer_setup_enabled))
    OR (config.mode<>'live' AND EXISTS(SELECT FROM payment_private.rollout_cohort r WHERE r.user_id=NEW.posted_by))) THEN RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION payment_private.guard_recipient_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE required boolean;
BEGIN
  IF NEW.status NOT IN('submitted','negotiating','accepted') OR COALESCE(NEW.conversation_state,'open')<>'open' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.user_id=OLD.user_id AND OLD.status IN('submitted','negotiating','accepted') AND COALESCE(OLD.conversation_state,'open')='open' THEN RETURN NEW; END IF;
  SELECT c.mode<>'disabled' AND rc.application_gate_enabled AND ((c.mode='live' AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND recipient_setup_enabled AND adult_model_approved))
      OR (c.mode<>'live' AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=NEW.user_id)))
    INTO required FROM payment_private.configuration c CROSS JOIN payment_private.recipient_configuration rc;
  IF NOT COALESCE(required,false) THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.profiles WHERE id=NEW.user_id FOR UPDATE;
  PERFORM 1 FROM payment_private.recipients r JOIN payment_private.configuration c ON c.mode=r.mode WHERE r.user_id=NEW.user_id FOR UPDATE OF r;
  IF NOT payment_private.recipient_ready(NEW.user_id) THEN RAISE EXCEPTION 'RECIPIENT_SETUP_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.order_assert_mode(p_mode text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_mode='live' AND EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode)
    AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled) THEN RETURN; END IF;
  IF p_mode IS NULL OR p_mode NOT IN('local_simulation','sandbox')
    OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode)
    OR NOT EXISTS(SELECT FROM payment_private.order_configuration WHERE enabled AND ((p_mode='live' AND fee_policy='workfare-service-5-v1'
      AND EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND orders_enabled))
      OR (p_mode<>'live' AND fee_policy IN('local-zero-fee-v1','test-service-5-v1')))) THEN
    RAISE EXCEPTION 'PAYMENT_ORDERS_DISABLED' USING ERRCODE='42501';
  END IF;
END; $$;

CREATE FUNCTION payment_private.order_assert_new(p_mode text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM payment_private.order_assert_mode(p_mode);
  IF p_mode='live' AND (NOT EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled AND lc.orders_enabled)
    OR NOT EXISTS(SELECT FROM payment_private.order_configuration WHERE enabled AND fee_policy='workfare-service-5-v1')) THEN
    RAISE EXCEPTION 'PAYMENT_ORDERS_DISABLED' USING ERRCODE='42501'; END IF;
END; $$;
REVOKE ALL ON FUNCTION payment_private.order_assert_new(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.order_assert_new(text) TO service_role;

CREATE OR REPLACE FUNCTION payment_private.order_json(p_id uuid,p_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',o.id,'mode',o.mode,'appointmentId',o.appointment_id,'applicationId',o.application_id,
    'providerId',o.provider_id,'recipientId',o.recipient_id,'title',o.title,'startsAt',o.starts_at,'endsAt',o.ends_at,'timezone',o.timezone,
    'appointmentVersion',o.appointment_version,'quoteVersion',o.quote_version,'paymentType',o.payment_type,'rateCents',o.rate_cents,'plannedMinutes',o.planned_minutes,
    'earningsCents',o.earnings_cents,'serviceFeeCents',o.fee_cents,'totalCents',o.total_cents,'currency',o.currency,
    'feePolicy',o.fee_policy,'feeTariff',o.fee_tariff,'termsVersion',o.terms_version,'recipientConfirmedAt',o.recipient_confirmed_at,'state',o.state,
    'captureBefore',o.capture_before,'refundedCents',o.refunded_cents,'createdAt',o.created_at,'updatedAt',o.updated_at,
    'termsCurrent',payment_private.order_fingerprint(o.appointment_id)=o.appointment_fingerprint,
    'bankPayoutConfirmed',false,'livePaymentsEnabled',o.mode='live')
    || CASE WHEN p_private THEN jsonb_build_object('customerRef',o.customer_ref,'methodRef',o.method_ref,'accountRef',o.account_ref,
      'intentRef',o.intent_ref,'refundRef',o.refund_ref,'revision',o.revision) ELSE '{}'::jsonb END
  FROM payment_private.orders o WHERE o.id=p_id;
$$;

CREATE OR REPLACE FUNCTION payment_private.order_create(p_user_id uuid,p_mode text,p_operation_id uuid,p_appointment_id uuid,p_appointment_version timestamptz,p_planned_minutes integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.job_appointments%ROWTYPE; e public.job_engagements%ROWTYPE; j public.jobs%ROWTYPE; o payment_private.orders%ROWTYPE;
  rate integer; earnings integer; next_version integer; policy text; tariff jsonb; fee integer;
BEGIN
  PERFORM payment_private.order_assert_new(p_mode);
  PERFORM payment_private.assert_mode(p_mode,p_user_id);
  IF p_mode='local_simulation' AND NOT EXISTS(SELECT FROM payment_private.rollout_cohort WHERE user_id=p_user_id) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_LOCAL_PREVIEW_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO o FROM payment_private.orders WHERE provider_id=p_user_id AND mode=p_mode AND operation_id=p_operation_id;
  IF FOUND THEN
    IF o.appointment_id IS DISTINCT FROM p_appointment_id OR o.appointment_version IS DISTINCT FROM p_appointment_version
      OR o.planned_minutes IS DISTINCT FROM p_planned_minutes THEN RAISE EXCEPTION 'PAYMENT_ORDER_OPERATION_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN payment_private.order_json(o.id);
  END IF;
  SELECT * INTO a FROM public.job_appointments WHERE id=p_appointment_id;
  SELECT * INTO e FROM public.job_engagements WHERE id=a.engagement_id;
  -- Match the existing appointment domain's application/job/engagement/term
  -- lock order; quote creation must not deadlock against a normal reschedule.
  PERFORM 1 FROM public.applications WHERE id=e.application_id FOR UPDATE;
  SELECT * INTO j FROM public.jobs WHERE id=e.job_id FOR UPDATE;
  SELECT * INTO e FROM public.job_engagements WHERE id=a.engagement_id FOR UPDATE;
  SELECT * INTO a FROM public.job_appointments WHERE id=p_appointment_id FOR UPDATE;
  SELECT * INTO o FROM payment_private.orders WHERE provider_id=p_user_id AND mode=p_mode AND operation_id=p_operation_id;
  IF FOUND THEN
    IF o.appointment_id IS DISTINCT FROM p_appointment_id OR o.appointment_version IS DISTINCT FROM p_appointment_version
      OR o.planned_minutes IS DISTINCT FROM p_planned_minutes THEN RAISE EXCEPTION 'PAYMENT_ORDER_OPERATION_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN payment_private.order_json(o.id);
  END IF;
  IF a.id IS NULL OR e.provider_id IS DISTINCT FROM p_user_id OR j.posted_by IS DISTINCT FROM p_user_id
    OR a.status<>'scheduled' OR e.status<>'active' OR NOT EXISTS(SELECT FROM public.applications WHERE id=e.application_id AND status='accepted') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_APPOINTMENT_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF a.updated_at IS DISTINCT FROM p_appointment_version THEN RAISE EXCEPTION 'PAYMENT_ORDER_TERMS_CHANGED' USING ERRCODE='22023'; END IF;
  IF j.payment_type NOT IN('fixed','hourly') OR j.wage_hourly IS NULL OR j.wage_hourly<=0 OR j.wage_hourly*100<>round(j.wage_hourly*100) OR j.wage_hourly*100>99999999 THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_PRICE_REQUIRED' USING ERRCODE='22023';
  END IF;
  rate:=(j.wage_hourly*100)::integer;
  IF j.payment_type='fixed' THEN
    IF p_planned_minutes IS NOT NULL THEN RAISE EXCEPTION 'PAYMENT_ORDER_MINUTES_INVALID' USING ERRCODE='22023'; END IF;
    earnings:=rate;
  ELSE
    IF p_planned_minutes IS NULL OR p_planned_minutes NOT BETWEEN 1 AND 480 THEN RAISE EXCEPTION 'PAYMENT_ORDER_MINUTES_INVALID' USING ERRCODE='22023'; END IF;
    earnings:=round(rate::numeric*p_planned_minutes/60)::integer;
  END IF;
  IF earnings NOT BETWEEN 50 AND 99999999 THEN RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT fee_policy INTO policy FROM payment_private.order_configuration WHERE enabled FOR SHARE;
  tariff:=payment_private.order_fee_tariff(earnings,policy);
  fee:=CASE WHEN tariff IS NULL THEN 0 ELSE (tariff->>'grossCents')::integer END;
  IF earnings::bigint+fee>99999999 THEN RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM payment_private.orders WHERE appointment_id=a.id AND state NOT IN('canceled','refunded')) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_ACTIVE_EXISTS' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(max(quote_version),0)+1 INTO next_version FROM payment_private.orders WHERE appointment_id=a.id;
  INSERT INTO payment_private.orders(mode,operation_id,appointment_id,engagement_id,application_id,job_id,provider_id,recipient_id,
    appointment_version,quote_version,appointment_fingerprint,title,starts_at,ends_at,timezone,payment_type,rate_cents,planned_minutes,earnings_cents,fee_cents,total_cents,fee_policy,fee_tariff,livemode)
  VALUES(p_mode,p_operation_id,a.id,e.id,e.application_id,j.id,p_user_id,e.seeker_id,a.updated_at,next_version,payment_private.order_fingerprint(a.id),
    j.title,a.starts_at,a.ends_at,a.timezone,j.payment_type,rate,p_planned_minutes,earnings,fee,earnings+fee,policy,tariff,p_mode='live') RETURNING * INTO o;
  RETURN payment_private.order_json(o.id);
END; $$;

CREATE OR REPLACE FUNCTION payment_private.order_create_for_tariff(p_user_id uuid,p_mode text,p_operation_id uuid,p_appointment_id uuid,p_appointment_version timestamptz,p_planned_minutes integer,p_quote_fee_policy text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original_fee_policy text; current_fee_policy text; result jsonb;
BEGIN
  IF p_quote_fee_policy IS NULL OR p_quote_fee_policy NOT IN('local-zero-fee-v1','test-service-5-v1','workfare-service-5-v1') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_TARIFF_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT fee_policy INTO original_fee_policy FROM payment_private.orders
    WHERE provider_id=p_user_id AND mode=p_mode AND operation_id=p_operation_id;
  IF FOUND THEN
    IF original_fee_policy IS DISTINCT FROM p_quote_fee_policy THEN
      RAISE EXCEPTION 'PAYMENT_ORDER_OPERATION_CONFLICT' USING ERRCODE='22023';
    END IF;
    -- Reuse the original owner/mode and full immutable-parameter checks.
    RETURN payment_private.order_create(p_user_id,p_mode,p_operation_id,p_appointment_id,p_appointment_version,p_planned_minutes);
  END IF;
  SELECT fee_policy INTO current_fee_policy FROM payment_private.order_configuration WHERE singleton FOR SHARE;
  IF current_fee_policy IS DISTINCT FROM p_quote_fee_policy THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_TARIFF_CHANGED' USING ERRCODE='22023';
  END IF;
  result := payment_private.order_create(p_user_id,p_mode,p_operation_id,p_appointment_id,p_appointment_version,p_planned_minutes);
  -- A concurrent creator can commit the same operation while we wait. The
  -- base function correctly recovers it; verify its original tariff as well.
  IF result->>'feePolicy' IS DISTINCT FROM p_quote_fee_policy THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_OPERATION_CONFLICT' USING ERRCODE='22023';
  END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.order_apply(p_order_id uuid,p_event_id text,p_intent_ref text,p_state text,p_capture_before timestamptz DEFAULT NULL,p_refund_ref text DEFAULT NULL,p_livemode boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.orders%ROWTYPE; ev payment_private.order_events%ROWTYPE;
BEGIN
  SELECT * INTO o FROM payment_private.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF p_livemode IS DISTINCT FROM (o.mode='live') THEN RAISE EXCEPTION 'PAYMENT_OBJECT_MODE_MISMATCH' USING ERRCODE='42501'; END IF;
  PERFORM payment_private.order_assert_mode(o.mode);
  SELECT * INTO ev FROM payment_private.order_events WHERE event_id=p_event_id;
  IF FOUND THEN
    IF ev.order_id<>o.id THEN RAISE EXCEPTION 'PAYMENT_ORDER_EVENT_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN payment_private.order_json(o.id);
  END IF;
  IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 200 OR p_intent_ref IS NULL OR p_state NOT IN('authorization_pending','authorized','capture_pending','paid','canceled','refund_pending','refunded','failed','review_required')
    OR (o.intent_ref IS NOT NULL AND o.intent_ref<>p_intent_ref)
    OR (o.refund_ref IS NOT NULL AND p_refund_ref IS NOT NULL AND o.refund_ref<>p_refund_ref)
    OR (o.mode IN('sandbox','live') AND p_intent_ref !~ '^pi_[a-zA-Z0-9]+$') OR (o.mode='local_simulation' AND p_intent_ref !~ '^local_pi_[a-zA-Z0-9_-]+$') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_OBJECT_MISMATCH' USING ERRCODE='22023';
  END IF;
  IF p_state='authorized' AND (p_capture_before IS NULL OR p_capture_before<=now()) THEN RAISE EXCEPTION 'PAYMENT_ORDER_AUTHORIZATION_EXPIRED' USING ERRCODE='22023'; END IF;
  IF p_state IN('refunded','refund_pending') AND p_refund_ref IS NULL THEN RAISE EXCEPTION 'PAYMENT_ORDER_REFUND_REQUIRED' USING ERRCODE='22023'; END IF;
  -- A dispute may win the lock before the successful refund response. Preserve
  -- the verified money evidence while the review itself remains unresolved.
  IF o.state='review_required' AND p_state='refunded' THEN
    INSERT INTO payment_private.order_events(event_id,order_id,state) VALUES(p_event_id,o.id,p_state);
    UPDATE payment_private.orders SET refund_ref=COALESCE(refund_ref,p_refund_ref),refunded_cents=total_cents,
      revision=revision+1,updated_at=now() WHERE id=o.id;
    RETURN payment_private.order_json(o.id);
  END IF;
  IF (o.state IN('paid','refund_pending','refunded') AND p_state IN('authorization_pending','authorized','capture_pending','failed','canceled'))
    OR (o.state='refund_pending' AND p_state='paid')
    OR (o.state='refunded' AND p_state NOT IN('refunded','review_required'))
    OR (o.state='review_required' AND p_state<>'review_required')
    OR (o.state='canceled' AND p_state IN('authorization_pending','authorized','capture_pending','failed'))
    OR (o.state='cancel_pending' AND p_state IN('authorization_pending','authorized','failed')) THEN
    INSERT INTO payment_private.order_events(event_id,order_id,state) VALUES(p_event_id,o.id,p_state);
    RETURN payment_private.order_json(o.id);
  END IF;
  IF o.state IN('awaiting_confirmation','ready') OR o.recipient_confirmed_at IS NULL THEN RAISE EXCEPTION 'PAYMENT_ORDER_STATE_CONFLICT' USING ERRCODE='22023'; END IF;
  INSERT INTO payment_private.order_events(event_id,order_id,state) VALUES(p_event_id,o.id,p_state);
  UPDATE payment_private.orders SET intent_ref=p_intent_ref,state=p_state,capture_before=COALESCE(p_capture_before,capture_before),
    refund_ref=COALESCE(p_refund_ref,refund_ref),refunded_cents=CASE WHEN p_state='refunded' THEN total_cents ELSE refunded_cents END,
    revision=revision+1,updated_at=now() WHERE id=o.id;
  RETURN payment_private.order_json(o.id);
END; $$;

CREATE OR REPLACE FUNCTION payment_private.recipient_earnings_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); active_mode text; earnings jsonb; recent jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'RECIPIENT_AUTHENTICATION_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT mode INTO active_mode FROM payment_private.configuration;
  IF active_mode IS NULL OR active_mode NOT IN('local_simulation','sandbox','live') THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT FROM public.profiles WHERE id=actor AND account_type='job_seeker')
    OR (active_mode<>'live' AND NOT payment_private.recipient_synthetic(actor))
    OR (active_mode='live' AND (NOT payment_private.live_identity(actor)
      OR NOT EXISTS(SELECT FROM payment_private.live_configuration lc WHERE lc.enabled))) THEN
    RAISE EXCEPTION 'RECIPIENT_SEEKER_REQUIRED' USING ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object('scope','confirmed_workfare_payments',
    'confirmedCents',COALESCE(sum(earnings_cents::bigint) FILTER(WHERE state='paid' AND refunded_cents=0),0),
    'refundedCents',COALESCE(sum(earnings_cents::bigint) FILTER(WHERE refunded_cents=total_cents),0),
    'underReviewCents',COALESCE(sum(earnings_cents::bigint) FILTER(WHERE state IN('review_required','refund_pending') AND refunded_cents=0),0),
    'underReviewCount',count(*) FILTER(WHERE state IN('review_required','refund_pending') AND refunded_cents=0),
    'paidJobs',count(DISTINCT appointment_id) FILTER(WHERE state='paid' AND refunded_cents=0)) INTO earnings
  FROM payment_private.orders WHERE recipient_id=actor AND mode=active_mode;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'applicationId',application_id,'title',title,
    'earningsCents',earnings_cents,'state',state,'startsAt',starts_at,'updatedAt',updated_at)
    ORDER BY updated_at DESC,id DESC),'[]'::jsonb) INTO recent
  FROM (SELECT id,application_id,title,earnings_cents,state,starts_at,updated_at FROM payment_private.orders
    WHERE recipient_id=actor AND mode=active_mode ORDER BY updated_at DESC,id DESC LIMIT 10) own_orders;
  RETURN jsonb_build_object('ownerId',actor,'kind',CASE active_mode WHEN 'sandbox' THEN 'sandbox' WHEN 'live' THEN 'live' ELSE 'local' END,
    'currency','eur','checkedAt',statement_timestamp(),'earnings',earnings,'recentPayments',recent);
END; $$;

COMMENT ON FUNCTION public.get_my_recipient_payment_summary() IS 'Own confirmed Workfare payment statistics in the active isolated mode; never a bank account, deposit claim or payout authority.';

CREATE OR REPLACE FUNCTION payment_private.order_overview(p_user_id uuid,p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE current_orders jsonb; current_fee_policy text;
BEGIN
  current_orders := payment_private.order_list(p_user_id,p_application_id);
  SELECT fee_policy INTO current_fee_policy FROM payment_private.order_configuration WHERE singleton;
  IF current_fee_policy IS NULL OR current_fee_policy NOT IN('local-zero-fee-v1','test-service-5-v1','workfare-service-5-v1') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_DISABLED' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('orders',current_orders,'quoteFeePolicy',current_fee_policy);
END; $$;

CREATE OR REPLACE FUNCTION payment_private.order_begin(p_user_id uuid,p_order_id uuid,p_action text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.orders%ROWTYPE; op payment_private.order_operations%ROWTYPE; c payment_private.customers%ROWTYPE; r payment_private.recipients%ROWTYPE;
BEGIN
  SELECT * INTO o FROM payment_private.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR o.provider_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
  PERFORM payment_private.order_assert_mode(o.mode);
  IF p_action IS NULL OR p_action NOT IN('authorize','capture','cancel','refund') THEN RAISE EXCEPTION 'PAYMENT_ORDER_ACTION_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO op FROM payment_private.order_operations WHERE order_id=o.id AND action=p_action;
  IF FOUND THEN
    -- Stripe only retains idempotency records for a limited period. An unknown
    -- authorization cannot be retried indefinitely and create a second intent.
    IF p_action='authorize' AND o.intent_ref IS NULL AND op.created_at<now()-interval '20 hours' THEN
      RAISE EXCEPTION 'PAYMENT_ORDER_RECONCILIATION_REQUIRED' USING ERRCODE='22023';
    END IF;
    RETURN payment_private.order_json(o.id,true)||jsonb_build_object('operationId',op.id,'replay',true);
  END IF;
  IF p_action='authorize' THEN
    PERFORM payment_private.order_assert_new(o.mode);
    PERFORM payment_private.assert_mode(o.mode,p_user_id);
    IF o.state<>'ready' OR o.recipient_confirmed_at IS NULL THEN RAISE EXCEPTION 'PAYMENT_ORDER_CONFIRMATION_REQUIRED' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.profiles WHERE id IN(o.provider_id,o.recipient_id) ORDER BY id FOR UPDATE;
    IF o.mode='sandbox' AND NOT EXISTS(SELECT FROM public.profiles WHERE id=o.provider_id AND birthdate<=(current_date-interval '18 years')::date) THEN
      RAISE EXCEPTION 'PAYMENT_ORDER_BUYER_MODEL_NOT_APPROVED' USING ERRCODE='42501';
    END IF;
    SELECT * INTO c FROM payment_private.customers WHERE user_id=o.provider_id AND mode=o.mode FOR UPDATE;
    SELECT * INTO r FROM payment_private.recipients WHERE user_id=o.recipient_id AND mode=o.mode FOR UPDATE;
    PERFORM 1 FROM public.job_appointments WHERE id=o.appointment_id FOR UPDATE;
    IF NOT payment_private.buyer_ready(o.provider_id) THEN RAISE EXCEPTION 'PAYMENT_ORDER_BUYER_REQUIRED' USING ERRCODE='22023'; END IF;
    IF NOT payment_private.recipient_ready(o.recipient_id) THEN RAISE EXCEPTION 'PAYMENT_ORDER_RECIPIENT_REQUIRED' USING ERRCODE='22023'; END IF;
    IF o.starts_at>now()+interval '24 hours' OR o.starts_at<now()-interval '24 hours' THEN RAISE EXCEPTION 'PAYMENT_ORDER_AUTHORIZATION_WINDOW' USING ERRCODE='22023'; END IF;
    IF payment_private.order_fingerprint(o.appointment_id) IS DISTINCT FROM o.appointment_fingerprint
      OR NOT EXISTS(SELECT FROM public.job_appointments WHERE id=o.appointment_id AND status='scheduled')
      OR NOT EXISTS(SELECT FROM public.job_engagements WHERE id=o.engagement_id AND status='active') THEN
      RAISE EXCEPTION 'PAYMENT_ORDER_TERMS_CHANGED' USING ERRCODE='22023';
    END IF;
    UPDATE payment_private.orders SET customer_ref=c.customer_ref,method_ref=c.method_ref,account_ref=r.account_ref,state='authorization_pending',revision=revision+1,updated_at=now() WHERE id=o.id;
  ELSIF p_action='capture' THEN
    PERFORM 1 FROM public.job_appointments WHERE id=o.appointment_id FOR UPDATE;
    IF o.state<>'authorized' OR o.capture_before IS NULL OR o.capture_before<=now() OR o.starts_at>now()
      OR payment_private.order_fingerprint(o.appointment_id) IS DISTINCT FROM o.appointment_fingerprint
      OR NOT EXISTS(SELECT FROM public.job_appointments WHERE id=o.appointment_id AND status IN('scheduled','completed')) THEN
      RAISE EXCEPTION 'PAYMENT_ORDER_CAPTURE_NOT_ALLOWED' USING ERRCODE='22023';
    END IF;
    UPDATE payment_private.orders SET state='capture_pending',revision=revision+1,updated_at=now() WHERE id=o.id;
  ELSIF p_action='cancel' THEN
    IF o.state NOT IN('awaiting_confirmation','ready','authorization_pending','authorized','failed') THEN RAISE EXCEPTION 'PAYMENT_ORDER_CANCEL_NOT_ALLOWED' USING ERRCODE='22023'; END IF;
    IF o.state='authorization_pending' AND o.intent_ref IS NULL THEN RAISE EXCEPTION 'PAYMENT_ORDER_OPERATION_PENDING' USING ERRCODE='22023'; END IF;
    UPDATE payment_private.orders SET state=CASE WHEN intent_ref IS NULL AND state IN('awaiting_confirmation','ready') THEN 'canceled' ELSE 'cancel_pending' END,revision=revision+1,updated_at=now() WHERE id=o.id;
  ELSE
    IF o.state<>'paid' THEN RAISE EXCEPTION 'PAYMENT_ORDER_REFUND_NOT_ALLOWED' USING ERRCODE='22023'; END IF;
    UPDATE payment_private.orders SET state='refund_pending',revision=revision+1,updated_at=now() WHERE id=o.id;
  END IF;
  INSERT INTO payment_private.order_operations(id,order_id,action) VALUES(p_operation_id,o.id,p_action);
  RETURN payment_private.order_json(o.id,true)||jsonb_build_object('operationId',p_operation_id,'replay',false);
END; $$;

COMMIT;
