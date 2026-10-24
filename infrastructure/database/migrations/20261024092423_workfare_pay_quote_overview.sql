-- Proposal totals must use the currently configured test tariff, even before
-- a chat has an order. One stable SQL snapshot reuses all list ownership gates.
BEGIN;

CREATE FUNCTION payment_private.order_overview(p_user_id uuid,p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE current_orders jsonb; current_fee_policy text;
BEGIN
  current_orders := payment_private.order_list(p_user_id,p_application_id);
  SELECT fee_policy INTO current_fee_policy FROM payment_private.order_configuration WHERE singleton;
  IF current_fee_policy IS NULL OR current_fee_policy NOT IN('local-zero-fee-v1','test-service-5-v1') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_DISABLED' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('orders',current_orders,'quoteFeePolicy',current_fee_policy);
END; $$;

CREATE FUNCTION public.pay_order_overview(p_user_id uuid,p_application_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT payment_private.order_overview(p_user_id,p_application_id);
$$;
REVOKE ALL ON FUNCTION public.pay_order_overview(uuid,uuid),payment_private.order_overview(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pay_order_overview(uuid,uuid),payment_private.order_overview(uuid,uuid) TO service_role;

-- Bind proposal consent to the displayed tariff and retain it through create.
CREATE FUNCTION payment_private.order_create_for_tariff(p_user_id uuid,p_mode text,p_operation_id uuid,p_appointment_id uuid,p_appointment_version timestamptz,p_planned_minutes integer,p_quote_fee_policy text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_fee_policy text;
BEGIN
  SELECT fee_policy INTO current_fee_policy FROM payment_private.order_configuration WHERE singleton FOR SHARE;
  IF p_quote_fee_policy IS NULL OR p_quote_fee_policy NOT IN('local-zero-fee-v1','test-service-5-v1') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_TARIFF_INVALID' USING ERRCODE='22023';
  END IF;
  IF current_fee_policy IS DISTINCT FROM p_quote_fee_policy THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_TARIFF_CHANGED' USING ERRCODE='22023';
  END IF;
  RETURN payment_private.order_create(p_user_id,p_mode,p_operation_id,p_appointment_id,p_appointment_version,p_planned_minutes);
END; $$;

CREATE FUNCTION public.pay_order_create_for_tariff(p_user_id uuid,p_mode text,p_operation_id uuid,p_appointment_id uuid,p_appointment_version timestamptz,p_planned_minutes integer,p_quote_fee_policy text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT payment_private.order_create_for_tariff(p_user_id,p_mode,p_operation_id,p_appointment_id,p_appointment_version,p_planned_minutes,p_quote_fee_policy);
$$;
REVOKE ALL ON FUNCTION public.pay_order_create_for_tariff(uuid,text,uuid,uuid,timestamptz,integer,text),payment_private.order_create_for_tariff(uuid,text,uuid,uuid,timestamptz,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pay_order_create_for_tariff(uuid,text,uuid,uuid,timestamptz,integer,text),payment_private.order_create_for_tariff(uuid,text,uuid,uuid,timestamptz,integer,text) TO service_role;

COMMIT;
