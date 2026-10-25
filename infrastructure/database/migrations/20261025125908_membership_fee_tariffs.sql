BEGIN;
-- Preserve every existing order and tariff snapshot. Selection changes only
-- for a newly proposed price after the operator activates the new bundle.
CREATE OR REPLACE FUNCTION payment_private.order_fee_tariff(p_earnings integer,p_policy text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE fee integer; tax integer; base integer; workfare integer;
BEGIN
 IF p_earnings IS NULL OR p_earnings NOT BETWEEN 50 AND 99999999 THEN RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
 IF p_policy='local-zero-fee-v1' THEN RETURN NULL; END IF;
 IF p_policy IN('workfare-service-regular-v2','workfare-service-member-v1') THEN
  base:=round(p_earnings::numeric*600/10000)::integer+49;
  workfare:=CASE WHEN p_policy='workfare-service-member-v1' THEN 0 ELSE round(p_earnings::numeric*600/10000)::integer END;
  fee:=base+workfare;
  IF p_earnings::bigint+fee>99999999 THEN RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('version',p_policy,'scope','platform','rateBasisPoints',CASE WHEN p_policy='workfare-service-member-v1' THEN 600 ELSE 1200 END,
   'fixedCents',49,'baseCents',base,'workfareCents',workfare,'grossCents',fee,'netCents',NULL,'taxCents',NULL,'tax',NULL);
 END IF;
 IF p_policy NOT IN('test-service-5-v1','workfare-service-5-v1') OR p_policy IS NULL THEN RAISE EXCEPTION 'PAYMENT_ORDER_TARIFF_REQUIRED' USING ERRCODE='22023'; END IF;
 fee:=round(p_earnings::numeric*500/10000)::integer;
 IF p_earnings::bigint+fee>99999999 THEN RAISE EXCEPTION 'PAYMENT_ORDER_AMOUNT_INVALID' USING ERRCODE='22023'; END IF;
 IF p_policy='workfare-service-5-v1' THEN RETURN jsonb_build_object('version',p_policy,'scope','live','rateBasisPoints',500,'grossCents',fee,'netCents',NULL,'taxCents',NULL,'tax',NULL); END IF;
 tax:=round(fee::numeric*1900/11900)::integer;
 RETURN jsonb_build_object('version','test-service-5-v1','scope','local_test_only','rateBasisPoints',500,'grossCents',fee,'netCents',fee-tax,'taxCents',tax,
  'tax',jsonb_build_object('jurisdiction','DE','treatment','simulation_vat_included','rateBasisPoints',1900,'determinationReference','sandbox-de-vat19-assumption-v1'));
END; $$;
ALTER TABLE payment_private.order_configuration ADD COLUMN bundle_started_at timestamptz;
ALTER TABLE payment_private.order_configuration ADD CONSTRAINT bundle_activation_required CHECK(fee_policy<>'workfare-service-regular-v2' OR bundle_started_at IS NOT NULL);
ALTER TABLE payment_private.order_configuration DROP CONSTRAINT order_configuration_fee_policy_check;
ALTER TABLE payment_private.order_configuration ADD CONSTRAINT order_configuration_fee_policy_check CHECK(fee_policy IS NULL OR fee_policy IN('local-zero-fee-v1','test-service-5-v1','workfare-service-5-v1','workfare-service-regular-v2'));
ALTER TABLE payment_private.orders DROP CONSTRAINT orders_fee_policy_check;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_fee_policy_check CHECK(
 (mode='live' AND fee_policy IN('workfare-service-5-v1','workfare-service-regular-v2','workfare-service-member-v1'))
 OR(mode<>'live' AND fee_policy IN('local-zero-fee-v1','test-service-5-v1','workfare-service-regular-v2','workfare-service-member-v1')));
ALTER TABLE payment_private.orders DROP CONSTRAINT orders_fee_tariff_check;
ALTER TABLE payment_private.orders ADD CONSTRAINT orders_fee_tariff_check CHECK(
 (fee_policy='local-zero-fee-v1' AND fee_cents=0 AND fee_tariff IS NULL)
 OR(fee_policy IN('test-service-5-v1','workfare-service-5-v1','workfare-service-regular-v2','workfare-service-member-v1') AND fee_tariff IS NOT NULL
  AND fee_tariff=payment_private.order_fee_tariff(earnings_cents,fee_policy) AND fee_cents=(fee_tariff->>'grossCents')::integer));

CREATE FUNCTION payment_private.current_order_fee_policy(p_user_id uuid,p_mode text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE policy text;
BEGIN
 SELECT fee_policy INTO policy FROM payment_private.order_configuration WHERE singleton AND enabled;
 IF policy='workfare-service-regular-v2' AND payment_private.membership_entitled(p_user_id,p_mode,statement_timestamp()) THEN RETURN 'workfare-service-member-v1'; END IF;
 RETURN policy;
END; $$;
REVOKE ALL ON FUNCTION payment_private.current_order_fee_policy(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.current_order_fee_policy(uuid,text) TO service_role;

-- Jobs already created before activation keep their original published price.
CREATE FUNCTION payment_private.job_order_fee_policy(p_user_id uuid,p_mode text,p_job_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE policy text; starts_at timestamptz; job_created_at timestamptz;
BEGIN
 SELECT fee_policy,bundle_started_at INTO policy,starts_at FROM payment_private.order_configuration WHERE singleton;
 SELECT created_at INTO job_created_at FROM public.jobs WHERE id=p_job_id;
 IF policy='workfare-service-regular-v2' AND starts_at IS NOT NULL AND job_created_at<starts_at THEN
  RETURN CASE WHEN p_mode='live' THEN 'workfare-service-5-v1' ELSE 'test-service-5-v1' END;
 END IF;
 RETURN payment_private.current_order_fee_policy(p_user_id,p_mode);
END; $$;
REVOKE ALL ON FUNCTION payment_private.job_order_fee_policy(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.job_order_fee_policy(uuid,text,uuid) TO service_role;

DO $migration$
DECLARE source text; changed text;
BEGIN
 source:=pg_get_functiondef('payment_private.order_create(uuid,text,uuid,uuid,timestamp with time zone,integer)'::regprocedure);
 changed:=replace(source,'  SELECT fee_policy INTO policy FROM payment_private.order_configuration WHERE enabled FOR SHARE;',
  '  PERFORM 1 FROM payment_private.order_configuration WHERE enabled FOR SHARE; policy:=payment_private.job_order_fee_policy(p_user_id,p_mode,j.id);');
 IF changed=source THEN RAISE EXCEPTION 'Expected price policy selection missing'; END IF; EXECUTE changed;
 source:=pg_get_functiondef('payment_private.order_create_for_tariff(uuid,text,uuid,uuid,timestamp with time zone,integer,text)'::regprocedure);
 changed:=replace(source,'''local-zero-fee-v1'',''test-service-5-v1'',''workfare-service-5-v1''','''local-zero-fee-v1'',''test-service-5-v1'',''workfare-service-5-v1'',''workfare-service-regular-v2'',''workfare-service-member-v1''');
 IF changed=source THEN RAISE EXCEPTION 'Expected tariff allowlist missing'; END IF; source:=changed;
 changed:=replace(source,'  SELECT fee_policy INTO current_fee_policy FROM payment_private.order_configuration WHERE singleton FOR SHARE;',
  '  PERFORM 1 FROM payment_private.order_configuration WHERE singleton FOR SHARE; current_fee_policy:=payment_private.job_order_fee_policy(p_user_id,p_mode,(SELECT e.job_id FROM public.job_appointments a JOIN public.job_engagements e ON e.id=a.engagement_id WHERE a.id=p_appointment_id));');
 IF changed=source THEN RAISE EXCEPTION 'Expected tariff snapshot check missing'; END IF; EXECUTE changed;
 source:=pg_get_functiondef('payment_private.order_assert_new(text)'::regprocedure);
 changed:=replace(source,'fee_policy=''workfare-service-5-v1''','fee_policy IN(''workfare-service-5-v1'',''workfare-service-regular-v2'')');
 IF changed=source THEN RAISE EXCEPTION 'Expected runtime tariff guard missing'; END IF; EXECUTE changed;
 source:=pg_get_functiondef('payment_private.order_assert_mode(text)'::regprocedure);
 changed:=replace(source,'fee_policy IN(''local-zero-fee-v1'',''test-service-5-v1'')','fee_policy IN(''local-zero-fee-v1'',''test-service-5-v1'',''workfare-service-regular-v2'')');
 IF changed=source THEN RAISE EXCEPTION 'Expected sandbox tariff guard missing'; END IF; EXECUTE changed;
END; $migration$;
CREATE OR REPLACE FUNCTION payment_private.order_overview(p_user_id uuid,p_application_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE current_orders jsonb; policy text; provider uuid; mode text; job uuid;
BEGIN
 current_orders:=payment_private.order_list(p_user_id,p_application_id);
 SELECT j.posted_by,j.id INTO provider,job FROM public.applications a JOIN public.jobs j ON j.id=a.job_id WHERE a.id=p_application_id;
 SELECT c.mode INTO mode FROM payment_private.configuration c WHERE singleton;
 policy:=payment_private.job_order_fee_policy(provider,mode,job);
 IF policy IS NULL OR policy NOT IN('local-zero-fee-v1','test-service-5-v1','workfare-service-5-v1','workfare-service-regular-v2','workfare-service-member-v1') THEN RAISE EXCEPTION 'PAYMENT_ORDER_DISABLED' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('orders',current_orders,'quoteFeePolicy',policy);
END; $$;
-- No UPDATE of configuration or existing contracts: activation is a separate,
-- reviewed operation after the compatible server/browser code has deployed.
NOTIFY pgrst,'reload schema';
COMMIT;
