BEGIN;
-- A browser can resolve its exact earlier command after another tab completed
-- newer commands. This lookup never mutates a schedule or originates a payout.
CREATE FUNCTION payment_private.payout_attempt(p_user_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT payment_private.payout_operation_json(o.id)
 FROM payment_private.payout_operations o
 WHERE o.user_id=p_user_id AND o.operation_id=p_operation_id
   AND o.mode=(SELECT mode FROM payment_private.configuration WHERE singleton);
$$;
CREATE FUNCTION public.pay_recipient_payout_attempt(p_user_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT payment_private.payout_attempt(p_user_id,p_operation_id);
$$;
REVOKE ALL ON FUNCTION payment_private.payout_attempt(uuid,uuid),public.pay_recipient_payout_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.payout_attempt(uuid,uuid),public.pay_recipient_payout_attempt(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
