BEGIN;

-- Embedded payment setup can return directly to the original conversation.
-- This is still an exact relative route/UUID allowlist, never an arbitrary URL.
ALTER TABLE payment_private.setup_sessions DROP CONSTRAINT setup_sessions_return_path_check;
ALTER TABLE payment_private.setup_sessions ADD CONSTRAINT payment_setup_return_path_check CHECK(length(return_path)<=200 AND
  (return_path='/app-home/settings/payments'
   OR return_path ~ '^/app-home/offers/(new|edit/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})(\?resume=payment)?$'
   OR return_path ~ '^/app-home/activities\?conversation=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'));

-- No production tariff or activation. This additive, private foundation only
-- supports explicitly enabled local simulations and adult Stripe test orders.
CREATE TABLE payment_private.order_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  fee_policy text CHECK(fee_policy IS NULL OR fee_policy='local-zero-fee-v1')
);
INSERT INTO payment_private.order_configuration DEFAULT VALUES;

CREATE TABLE payment_private.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK(mode IN('local_simulation','sandbox')),
  operation_id uuid NOT NULL,
  appointment_id uuid NOT NULL REFERENCES public.job_appointments(id) ON DELETE RESTRICT,
  engagement_id uuid NOT NULL REFERENCES public.job_engagements(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  appointment_version timestamptz NOT NULL,
  quote_version integer NOT NULL CHECK(quote_version>0),
  appointment_fingerprint text NOT NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL,
  payment_type text NOT NULL CHECK(payment_type IN('fixed','hourly')),
  rate_cents integer NOT NULL CHECK(rate_cents BETWEEN 1 AND 99999999),
  planned_minutes integer CHECK(planned_minutes BETWEEN 1 AND 480),
  earnings_cents integer NOT NULL CHECK(earnings_cents BETWEEN 50 AND 99999999),
  fee_cents integer NOT NULL DEFAULT 0 CHECK(fee_cents=0),
  total_cents integer NOT NULL CHECK(total_cents=earnings_cents+fee_cents),
  currency text NOT NULL DEFAULT 'eur' CHECK(currency='eur'),
  fee_policy text NOT NULL CHECK(fee_policy='local-zero-fee-v1'),
  terms_version text NOT NULL DEFAULT 'appointment-price-v1' CHECK(terms_version='appointment-price-v1'),
  recipient_confirmed_at timestamptz,
  state text NOT NULL DEFAULT 'awaiting_confirmation' CHECK(state IN('awaiting_confirmation','ready','authorization_pending','authorized','capture_pending','paid','cancel_pending','canceled','refund_pending','refunded','failed','review_required')),
  customer_ref text,
  method_ref text,
  account_ref text,
  intent_ref text,
  refund_ref text,
  capture_before timestamptz,
  refunded_cents integer NOT NULL DEFAULT 0 CHECK(refunded_cents IN(0,total_cents)),
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  livemode boolean NOT NULL DEFAULT false CHECK(NOT livemode),
  UNIQUE(provider_id,mode,operation_id),
  UNIQUE(appointment_id,quote_version),
  UNIQUE(mode,intent_ref),UNIQUE(mode,refund_ref),
  CHECK(provider_id<>recipient_id),
  CHECK((payment_type='hourly')=(planned_minutes IS NOT NULL)),
  CHECK((mode='local_simulation' AND (intent_ref IS NULL OR intent_ref ~ '^local_pi_[a-zA-Z0-9_-]+$'))
    OR (mode='sandbox' AND (intent_ref IS NULL OR intent_ref ~ '^pi_[a-zA-Z0-9]+$'))),
  CHECK((mode='local_simulation' AND (refund_ref IS NULL OR refund_ref ~ '^local_refund_[a-zA-Z0-9_-]+$'))
    OR (mode='sandbox' AND (refund_ref IS NULL OR refund_ref ~ '^re_[a-zA-Z0-9]+$')))
);
CREATE INDEX payment_orders_provider_idx ON payment_private.orders(provider_id,created_at DESC);
CREATE INDEX payment_orders_recipient_idx ON payment_private.orders(recipient_id,created_at DESC);
CREATE INDEX payment_orders_engagement_idx ON payment_private.orders(engagement_id,created_at DESC);
CREATE UNIQUE INDEX payment_orders_one_active_appointment_idx ON payment_private.orders(appointment_id) WHERE state NOT IN('canceled','refunded');

CREATE TABLE payment_private.order_operations (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES payment_private.orders(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN('authorize','capture','cancel','refund')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(order_id,action)
);
CREATE TABLE payment_private.order_events (
  event_id text PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 200),
  order_id uuid NOT NULL REFERENCES payment_private.orders(id) ON DELETE RESTRICT,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payment_private.order_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.order_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_private.order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.order_configuration,payment_private.orders,payment_private.order_operations,payment_private.order_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION payment_private.order_assert_mode(p_mode text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN('local_simulation','sandbox')
    OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode)
    OR NOT EXISTS(SELECT FROM payment_private.order_configuration WHERE enabled AND fee_policy='local-zero-fee-v1') THEN
    RAISE EXCEPTION 'PAYMENT_ORDERS_DISABLED' USING ERRCODE='42501';
  END IF;
END; $$;

CREATE FUNCTION payment_private.order_fingerprint(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT md5(jsonb_build_array(a.starts_at,a.ends_at,a.timezone,a.note)::text) FROM public.job_appointments a WHERE a.id=p_id;
$$;

CREATE FUNCTION payment_private.order_json(p_id uuid,p_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',o.id,'mode',o.mode,'appointmentId',o.appointment_id,'applicationId',o.application_id,
    'providerId',o.provider_id,'recipientId',o.recipient_id,'title',o.title,'startsAt',o.starts_at,'endsAt',o.ends_at,'timezone',o.timezone,
    'appointmentVersion',o.appointment_version,'quoteVersion',o.quote_version,'paymentType',o.payment_type,'rateCents',o.rate_cents,'plannedMinutes',o.planned_minutes,
    'earningsCents',o.earnings_cents,'serviceFeeCents',o.fee_cents,'totalCents',o.total_cents,'currency',o.currency,
    'feePolicy',o.fee_policy,'termsVersion',o.terms_version,'recipientConfirmedAt',o.recipient_confirmed_at,'state',o.state,
    'captureBefore',o.capture_before,'refundedCents',o.refunded_cents,'createdAt',o.created_at,'updatedAt',o.updated_at,
    'termsCurrent',payment_private.order_fingerprint(o.appointment_id)=o.appointment_fingerprint,
    'bankPayoutConfirmed',false,'livePaymentsEnabled',false)
    || CASE WHEN p_private THEN jsonb_build_object('customerRef',o.customer_ref,'methodRef',o.method_ref,'accountRef',o.account_ref,
      'intentRef',o.intent_ref,'refundRef',o.refund_ref,'revision',o.revision) ELSE '{}'::jsonb END
  FROM payment_private.orders o WHERE o.id=p_id;
$$;

-- Quote values are derived from the stored offer, then separately accepted by
-- both people. An hourly quote is an explicit fixed billable-minute agreement;
-- variable hours/partial captures require a new agreed contract and are absent.
CREATE FUNCTION payment_private.order_create(p_user_id uuid,p_mode text,p_operation_id uuid,p_appointment_id uuid,p_appointment_version timestamptz,p_planned_minutes integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.job_appointments%ROWTYPE; e public.job_engagements%ROWTYPE; j public.jobs%ROWTYPE; o payment_private.orders%ROWTYPE;
  rate integer; earnings integer; next_version integer;
BEGIN
  PERFORM payment_private.order_assert_mode(p_mode);
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
  IF EXISTS(SELECT FROM payment_private.orders WHERE appointment_id=a.id AND state NOT IN('canceled','refunded')) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_ACTIVE_EXISTS' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(max(quote_version),0)+1 INTO next_version FROM payment_private.orders WHERE appointment_id=a.id;
  INSERT INTO payment_private.orders(mode,operation_id,appointment_id,engagement_id,application_id,job_id,provider_id,recipient_id,
    appointment_version,quote_version,appointment_fingerprint,title,starts_at,ends_at,timezone,payment_type,rate_cents,planned_minutes,earnings_cents,total_cents,fee_policy)
  VALUES(p_mode,p_operation_id,a.id,e.id,e.application_id,j.id,p_user_id,e.seeker_id,a.updated_at,next_version,payment_private.order_fingerprint(a.id),
    j.title,a.starts_at,a.ends_at,a.timezone,j.payment_type,rate,p_planned_minutes,earnings,earnings,'local-zero-fee-v1') RETURNING * INTO o;
  RETURN payment_private.order_json(o.id);
END; $$;

CREATE FUNCTION payment_private.order_confirm(p_user_id uuid,p_order_id uuid,p_terms_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM payment_private.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR o.recipient_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
  PERFORM payment_private.order_assert_mode(o.mode);
  PERFORM payment_private.assert_recipient(p_user_id,o.mode);
  IF p_terms_version IS DISTINCT FROM o.terms_version OR payment_private.order_fingerprint(o.appointment_id) IS DISTINCT FROM o.appointment_fingerprint
    OR NOT EXISTS(SELECT FROM public.job_appointments WHERE id=o.appointment_id AND status='scheduled') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_TERMS_CHANGED' USING ERRCODE='22023';
  END IF;
  IF o.recipient_confirmed_at IS NOT NULL THEN RETURN payment_private.order_json(o.id); END IF;
  IF o.state<>'awaiting_confirmation' THEN RAISE EXCEPTION 'PAYMENT_ORDER_STATE_CONFLICT' USING ERRCODE='22023'; END IF;
  UPDATE payment_private.orders SET recipient_confirmed_at=now(),state='ready',revision=revision+1,updated_at=now() WHERE id=o.id;
  RETURN payment_private.order_json(o.id);
END; $$;

CREATE FUNCTION payment_private.order_get(p_user_id uuid,p_order_id uuid,p_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM payment_private.orders WHERE id=p_order_id;
  IF NOT FOUND OR p_user_id IS NULL OR p_user_id NOT IN(o.provider_id,o.recipient_id) THEN RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
  PERFORM payment_private.order_assert_mode(o.mode);
  RETURN payment_private.order_json(o.id,p_private);
END; $$;

CREATE FUNCTION payment_private.order_list(p_user_id uuid,p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE active_mode text;
BEGIN
  SELECT mode INTO active_mode FROM payment_private.configuration;
  PERFORM payment_private.order_assert_mode(active_mode);
  IF p_user_id IS NULL OR NOT EXISTS(SELECT FROM public.job_engagements WHERE application_id=p_application_id AND p_user_id IN(provider_id,seeker_id)) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(payment_private.order_json(id) ORDER BY created_at DESC,id) FROM
    (SELECT id,created_at FROM payment_private.orders WHERE application_id=p_application_id AND mode=active_mode AND p_user_id IN(provider_id,recipient_id)
     ORDER BY created_at DESC,id LIMIT 50) recent),'[]'::jsonb);
END; $$;

CREATE FUNCTION payment_private.order_begin(p_user_id uuid,p_order_id uuid,p_action text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.orders%ROWTYPE; op payment_private.order_operations%ROWTYPE; c payment_private.customers%ROWTYPE; r payment_private.recipients%ROWTYPE;
BEGIN
  SELECT * INTO o FROM payment_private.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR o.provider_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
  PERFORM payment_private.order_assert_mode(o.mode);
  PERFORM payment_private.assert_mode(o.mode,p_user_id);
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

-- Only server-inspected PSP facts can enter this reducer. Events deduplicate
-- globally and may never silently regress a paid/refunded state to authorized.
CREATE FUNCTION payment_private.order_apply(p_order_id uuid,p_event_id text,p_intent_ref text,p_state text,p_capture_before timestamptz DEFAULT NULL,p_refund_ref text DEFAULT NULL,p_livemode boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.orders%ROWTYPE; ev payment_private.order_events%ROWTYPE;
BEGIN
  IF p_livemode IS DISTINCT FROM false THEN RAISE EXCEPTION 'LIVE_PAYMENTS_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM payment_private.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='22023'; END IF;
  PERFORM payment_private.order_assert_mode(o.mode);
  SELECT * INTO ev FROM payment_private.order_events WHERE event_id=p_event_id;
  IF FOUND THEN
    IF ev.order_id<>o.id THEN RAISE EXCEPTION 'PAYMENT_ORDER_EVENT_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN payment_private.order_json(o.id);
  END IF;
  IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 200 OR p_intent_ref IS NULL OR p_state NOT IN('authorization_pending','authorized','capture_pending','paid','canceled','refund_pending','refunded','failed','review_required')
    OR (o.intent_ref IS NOT NULL AND o.intent_ref<>p_intent_ref)
    OR (o.mode='sandbox' AND p_intent_ref !~ '^pi_[a-zA-Z0-9]+$') OR (o.mode='local_simulation' AND p_intent_ref !~ '^local_pi_[a-zA-Z0-9_-]+$') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_OBJECT_MISMATCH' USING ERRCODE='22023';
  END IF;
  IF p_state='authorized' AND (p_capture_before IS NULL OR p_capture_before<=now()) THEN RAISE EXCEPTION 'PAYMENT_ORDER_AUTHORIZATION_EXPIRED' USING ERRCODE='22023'; END IF;
  IF p_state IN('refunded','refund_pending') AND p_refund_ref IS NULL THEN RAISE EXCEPTION 'PAYMENT_ORDER_REFUND_REQUIRED' USING ERRCODE='22023'; END IF;
  IF (o.state IN('paid','refund_pending','refunded') AND p_state IN('authorization_pending','authorized','capture_pending','failed','canceled'))
    OR (o.state='refund_pending' AND p_state='paid')
    OR (o.state='refunded' AND p_state<>'refunded')
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

-- A quote cannot change after either participant has seen/accepted it. State
-- updates and separately verified PSP references remain possible.
CREATE FUNCTION payment_private.order_immutable_quote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['state','customer_ref','method_ref','account_ref','intent_ref','refund_ref','capture_before','refunded_cents','revision','updated_at','recipient_confirmed_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','customer_ref','method_ref','account_ref','intent_ref','refund_ref','capture_before','refunded_cents','revision','updated_at','recipient_confirmed_at']) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_QUOTE_IMMUTABLE' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payment_order_immutable_quote BEFORE UPDATE ON payment_private.orders FOR EACH ROW EXECUTE FUNCTION payment_private.order_immutable_quote();

-- Rescheduling cannot silently move an already authorized contract to another
-- date. The authorization must first be canceled explicitly; job completion
-- itself is permitted and never triggers financial activity.
CREATE FUNCTION payment_private.order_guard_appointment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (jsonb_build_array(NEW.starts_at,NEW.ends_at,NEW.timezone,NEW.note) IS DISTINCT FROM jsonb_build_array(OLD.starts_at,OLD.ends_at,OLD.timezone,OLD.note)
    OR (NEW.status='cancelled' AND OLD.status<>'cancelled'))
    AND EXISTS(SELECT FROM payment_private.orders WHERE appointment_id=OLD.id AND state IN('authorization_pending','authorized','capture_pending','cancel_pending','refund_pending')) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_SETTLEMENT_REQUIRED' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER payment_order_guard_appointment BEFORE UPDATE ON public.job_appointments FOR EACH ROW EXECUTE FUNCTION payment_private.order_guard_appointment();

CREATE FUNCTION public.pay_order_create(p_user_id uuid,p_mode text,p_operation_id uuid,p_appointment_id uuid,p_appointment_version timestamptz,p_planned_minutes integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.order_create(p_user_id,p_mode,p_operation_id,p_appointment_id,p_appointment_version,p_planned_minutes); $$;
CREATE FUNCTION public.pay_order_confirm(p_user_id uuid,p_order_id uuid,p_terms_version text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.order_confirm(p_user_id,p_order_id,p_terms_version); $$;
CREATE FUNCTION public.pay_order_get(p_user_id uuid,p_order_id uuid,p_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.order_get(p_user_id,p_order_id,p_private); $$;
CREATE FUNCTION public.pay_order_list(p_user_id uuid,p_application_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.order_list(p_user_id,p_application_id); $$;
CREATE FUNCTION public.pay_order_begin(p_user_id uuid,p_order_id uuid,p_action text,p_operation_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.order_begin(p_user_id,p_order_id,p_action,p_operation_id); $$;
CREATE FUNCTION public.pay_order_apply(p_order_id uuid,p_event_id text,p_intent_ref text,p_state text,p_capture_before timestamptz DEFAULT NULL,p_refund_ref text DEFAULT NULL,p_livemode boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.order_apply(p_order_id,p_event_id,p_intent_ref,p_state,p_capture_before,p_refund_ref,p_livemode); $$;

REVOKE ALL ON FUNCTION public.pay_order_create(uuid,text,uuid,uuid,timestamptz,integer),public.pay_order_confirm(uuid,uuid,text),public.pay_order_get(uuid,uuid,boolean),public.pay_order_begin(uuid,uuid,text,uuid),public.pay_order_apply(uuid,text,text,text,timestamptz,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pay_order_list(uuid,uuid),payment_private.order_list(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pay_order_list(uuid,uuid),payment_private.order_list(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_order_create(uuid,text,uuid,uuid,timestamptz,integer),public.pay_order_confirm(uuid,uuid,text),public.pay_order_get(uuid,uuid,boolean),public.pay_order_begin(uuid,uuid,text,uuid),public.pay_order_apply(uuid,text,text,text,timestamptz,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION payment_private.order_assert_mode(text),payment_private.order_fingerprint(uuid),payment_private.order_json(uuid,boolean),payment_private.order_create(uuid,text,uuid,uuid,timestamptz,integer),payment_private.order_confirm(uuid,uuid,text),payment_private.order_get(uuid,uuid,boolean),payment_private.order_begin(uuid,uuid,text,uuid),payment_private.order_apply(uuid,text,text,text,timestamptz,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION payment_private.order_immutable_quote(),payment_private.order_guard_appointment() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION payment_private.order_assert_mode(text),payment_private.order_fingerprint(uuid),payment_private.order_json(uuid,boolean),payment_private.order_create(uuid,text,uuid,uuid,timestamptz,integer),payment_private.order_confirm(uuid,uuid,text),payment_private.order_get(uuid,uuid,boolean),payment_private.order_begin(uuid,uuid,text,uuid),payment_private.order_apply(uuid,text,text,text,timestamptz,text,boolean) TO service_role;

COMMIT;
