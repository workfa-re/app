BEGIN;

-- Versioned local/Sandbox QA tariff, never a live price or tax determination.
-- Existing zero-fee quotes and their confirmations remain byte-for-byte intact.
CREATE FUNCTION payment_private.order_fee_tariff(p_earnings integer,p_policy text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE fee integer; tax integer;
BEGIN
  IF p_earnings IS NULL OR p_earnings NOT BETWEEN 50 AND 99999999 THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_policy='local-zero-fee-v1' THEN RETURN NULL; END IF;
  IF p_policy IS DISTINCT FROM 'test-service-5-v1' THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_TARIFF_REQUIRED' USING ERRCODE='22023';
  END IF;
  fee:=round(p_earnings::numeric*500/10000)::integer;
  IF p_earnings::bigint+fee>99999999 THEN RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  tax:=round(fee::numeric*1900/11900)::integer;
  RETURN jsonb_build_object('version','test-service-5-v1','scope','local_test_only','rateBasisPoints',500,
    'grossCents',fee,'netCents',fee-tax,'taxCents',tax,'tax',jsonb_build_object('jurisdiction','DE',
      'treatment','simulation_vat_included','rateBasisPoints',1900,'determinationReference','sandbox-de-vat19-assumption-v1'));
END; $$;
REVOKE ALL ON FUNCTION payment_private.order_fee_tariff(integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.order_fee_tariff(integer,text) TO service_role;

ALTER TABLE payment_private.order_configuration DROP CONSTRAINT order_configuration_fee_policy_check;
ALTER TABLE payment_private.order_configuration ADD CONSTRAINT order_configuration_fee_policy_check
  CHECK(fee_policy IS NULL OR fee_policy IN('local-zero-fee-v1','test-service-5-v1'));
ALTER TABLE payment_private.orders ADD COLUMN fee_tariff jsonb;
ALTER TABLE payment_private.orders DROP CONSTRAINT orders_fee_cents_check;
ALTER TABLE payment_private.orders DROP CONSTRAINT orders_fee_policy_check;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_fee_cents_check CHECK(fee_cents BETWEEN 0 AND 99999999);
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_fee_policy_check CHECK(fee_policy IN('local-zero-fee-v1','test-service-5-v1'));
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_total_limit_check CHECK(total_cents BETWEEN 50 AND 99999999);
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_fee_tariff_check CHECK(
  (fee_policy='local-zero-fee-v1' AND fee_cents=0 AND fee_tariff IS NULL)
  OR (fee_policy='test-service-5-v1' AND fee_tariff IS NOT NULL
    AND fee_tariff=payment_private.order_fee_tariff(earnings_cents,fee_policy)
    AND fee_cents=(fee_tariff->>'grossCents')::integer));

CREATE OR REPLACE FUNCTION payment_private.order_assert_mode(p_mode text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN('local_simulation','sandbox')
    OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode)
    OR NOT EXISTS(SELECT FROM payment_private.order_configuration WHERE enabled AND fee_policy IN('local-zero-fee-v1','test-service-5-v1')) THEN
    RAISE EXCEPTION 'PAYMENT_ORDERS_DISABLED' USING ERRCODE='42501';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.order_json(p_id uuid,p_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',o.id,'mode',o.mode,'appointmentId',o.appointment_id,'applicationId',o.application_id,
    'providerId',o.provider_id,'recipientId',o.recipient_id,'title',o.title,'startsAt',o.starts_at,'endsAt',o.ends_at,'timezone',o.timezone,
    'appointmentVersion',o.appointment_version,'quoteVersion',o.quote_version,'paymentType',o.payment_type,'rateCents',o.rate_cents,'plannedMinutes',o.planned_minutes,
    'earningsCents',o.earnings_cents,'serviceFeeCents',o.fee_cents,'totalCents',o.total_cents,'currency',o.currency,
    'feePolicy',o.fee_policy,'feeTariff',o.fee_tariff,'termsVersion',o.terms_version,'recipientConfirmedAt',o.recipient_confirmed_at,'state',o.state,
    'captureBefore',o.capture_before,'refundedCents',o.refunded_cents,'createdAt',o.created_at,'updatedAt',o.updated_at,
    'termsCurrent',payment_private.order_fingerprint(o.appointment_id)=o.appointment_fingerprint,
    'bankPayoutConfirmed',false,'livePaymentsEnabled',false)
    || CASE WHEN p_private THEN jsonb_build_object('customerRef',o.customer_ref,'methodRef',o.method_ref,'accountRef',o.account_ref,
      'intentRef',o.intent_ref,'refundRef',o.refund_ref,'revision',o.revision) ELSE '{}'::jsonb END
  FROM payment_private.orders o WHERE o.id=p_id;
$$;

CREATE OR REPLACE FUNCTION payment_private.order_create(p_user_id uuid,p_mode text,p_operation_id uuid,p_appointment_id uuid,p_appointment_version timestamptz,p_planned_minutes integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.job_appointments%ROWTYPE; e public.job_engagements%ROWTYPE; j public.jobs%ROWTYPE; o payment_private.orders%ROWTYPE;
  rate integer; earnings integer; next_version integer; policy text; tariff jsonb; fee integer;
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
  SELECT fee_policy INTO policy FROM payment_private.order_configuration WHERE enabled FOR SHARE;
  tariff:=payment_private.order_fee_tariff(earnings,policy);
  fee:=CASE WHEN tariff IS NULL THEN 0 ELSE (tariff->>'grossCents')::integer END;
  IF earnings::bigint+fee>99999999 THEN RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM payment_private.orders WHERE appointment_id=a.id AND state NOT IN('canceled','refunded')) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_ACTIVE_EXISTS' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(max(quote_version),0)+1 INTO next_version FROM payment_private.orders WHERE appointment_id=a.id;
  INSERT INTO payment_private.orders(mode,operation_id,appointment_id,engagement_id,application_id,job_id,provider_id,recipient_id,
    appointment_version,quote_version,appointment_fingerprint,title,starts_at,ends_at,timezone,payment_type,rate_cents,planned_minutes,earnings_cents,fee_cents,total_cents,fee_policy,fee_tariff)
  VALUES(p_mode,p_operation_id,a.id,e.id,e.application_id,j.id,p_user_id,e.seeker_id,a.updated_at,next_version,payment_private.order_fingerprint(a.id),
    j.title,a.starts_at,a.ends_at,a.timezone,j.payment_type,rate,p_planned_minutes,earnings,fee,earnings+fee,policy,tariff) RETURNING * INTO o;
  RETURN payment_private.order_json(o.id);
END; $$;

COMMIT;
