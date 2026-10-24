-- Recover the original immutable quote after a lost response, even if today's
-- proposal tariff changed. Reusing its operation for another tariff is a conflict.
BEGIN;

CREATE OR REPLACE FUNCTION payment_private.order_create_for_tariff(p_user_id uuid,p_mode text,p_operation_id uuid,p_appointment_id uuid,p_appointment_version timestamptz,p_planned_minutes integer,p_quote_fee_policy text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original_fee_policy text; current_fee_policy text; result jsonb;
BEGIN
  IF p_quote_fee_policy IS NULL OR p_quote_fee_policy NOT IN('local-zero-fee-v1','test-service-5-v1') THEN
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

REVOKE ALL ON FUNCTION payment_private.order_create_for_tariff(uuid,text,uuid,uuid,timestamptz,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.order_create_for_tariff(uuid,text,uuid,uuid,timestamptz,integer,text) TO service_role;

COMMIT;
