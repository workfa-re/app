BEGIN;

-- A payer's explicit after-work payment request survives SCA, lost responses
-- and webhook retries. Existing pre-work card holds are never backfilled.
CREATE TABLE payment_private.completion_payments (
  order_id uuid PRIMARY KEY REFERENCES payment_private.orders(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  operation_id uuid NOT NULL UNIQUE,
  capture_operation_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  quote_version integer NOT NULL CHECK(quote_version>0),
  total_cents bigint NOT NULL CHECK(total_cents>0),
  work_done_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payment_private.completion_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.completion_payments FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION payment_private.completion_payment_current(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT FROM payment_private.completion_payments request JOIN payment_private.orders o ON o.id=request.order_id
    WHERE o.id=p_order_id AND request.provider_id=o.provider_id AND request.quote_version=o.quote_version
      AND request.total_cents=o.total_cents AND o.recipient_confirmed_at IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION payment_private.completion_payment_current(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION payment_private.completion_payment_context(p_user_id uuid,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.orders%ROWTYPE; request payment_private.completion_payments%ROWTYPE;
BEGIN
  SELECT * INTO o FROM payment_private.orders WHERE id=p_order_id;
  IF o.id IS NULL OR p_user_id IS NULL OR p_user_id NOT IN(o.provider_id,o.recipient_id) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
  SELECT * INTO request FROM payment_private.completion_payments WHERE order_id=o.id;
  RETURN jsonb_build_object('orderId',o.id,'providerId',o.provider_id,'requested',payment_private.completion_payment_current(o.id),
    'operationId',request.operation_id);
END; $$;

CREATE FUNCTION payment_private.order_begin_completion(p_user_id uuid,p_order_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.orders%ROWTYPE; request payment_private.completion_payments%ROWTYPE; action text; operation uuid;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_ORDER_OPERATION_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO o FROM payment_private.orders WHERE id=p_order_id FOR UPDATE;
  IF o.id IS NULL OR o.provider_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND' USING ERRCODE='42501'; END IF;
  PERFORM payment_private.order_assert_mode(o.mode);
  SELECT * INTO request FROM payment_private.completion_payments WHERE order_id=o.id;
  IF o.state IN('paid','refunded','refund_pending','review_required','canceled','cancel_pending','failed') THEN
    RETURN payment_private.order_json(o.id,true)||jsonb_build_object('paymentAction','capture','operationId',COALESCE(request.capture_operation_id,p_operation_id),'replay',true);
  END IF;
  IF o.state NOT IN('ready','authorization_pending','authorized','capture_pending') OR o.recipient_confirmed_at IS NULL
    OR o.id IS DISTINCT FROM (SELECT id FROM payment_private.orders WHERE appointment_id=o.appointment_id ORDER BY quote_version DESC LIMIT 1)
    OR payment_private.order_fingerprint(o.appointment_id) IS DISTINCT FROM o.appointment_fingerprint
    OR NOT EXISTS(SELECT FROM public.job_appointments WHERE id=o.appointment_id AND status='scheduled')
    OR NOT EXISTS(SELECT FROM public.job_engagements WHERE id=o.engagement_id AND status='active')
    OR NOT EXISTS(SELECT FROM public.applications WHERE id=o.application_id AND status='accepted' AND conversation_state='open') THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_TERMS_CHANGED' USING ERRCODE='22023'; END IF;
  IF NOT payment_private.recipient_ready(o.recipient_id) THEN RAISE EXCEPTION 'PAYMENT_ORDER_RECIPIENT_REQUIRED' USING ERRCODE='22023'; END IF;
  IF request.order_id IS NULL THEN
    IF NOT payment_private.buyer_ready(o.provider_id) THEN RAISE EXCEPTION 'PAYMENT_ORDER_BUYER_REQUIRED' USING ERRCODE='22023'; END IF;
    INSERT INTO payment_private.completion_payments(order_id,provider_id,operation_id,quote_version,total_cents)
      VALUES(o.id,p_user_id,p_operation_id,o.quote_version,o.total_cents) RETURNING * INTO request;
  ELSIF NOT payment_private.completion_payment_current(o.id) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_CONFIRMATION_REQUIRED' USING ERRCODE='22023'; END IF;
  action:=CASE WHEN o.state IN('authorized','capture_pending') THEN 'capture' ELSE 'authorize' END;
  operation:=CASE WHEN action='capture' THEN request.capture_operation_id ELSE request.operation_id END;
  RETURN payment_private.order_begin(p_user_id,o.id,action,operation)||jsonb_build_object('paymentAction',action);
END; $$;

-- Only a durable completion declaration relaxes planning-time restrictions.
-- Ordinary authorization and legacy capture retain their original windows.
DO $migration$
DECLARE source text; changed text;
BEGIN
  source:=pg_get_functiondef('payment_private.order_begin(uuid,uuid,text,uuid)'::regprocedure);
  changed:=replace(source,'IF o.starts_at>now()+interval ''24 hours'' THEN',
    'IF o.starts_at>now()+interval ''24 hours'' AND NOT payment_private.completion_payment_current(o.id) THEN');
  IF changed=source THEN RAISE EXCEPTION 'Expected authorization window was not found'; END IF;
  source:=changed;
  changed:=replace(source,'OR o.starts_at>now()',
    'OR (o.starts_at>now() AND NOT payment_private.completion_payment_current(o.id))');
  IF changed=source THEN RAISE EXCEPTION 'Expected capture time guard was not found'; END IF;
  EXECUTE changed;
  source:=pg_get_functiondef('payment_private.order_apply(uuid,text,text,text,timestamptz,text,boolean)'::regprocedure);
  changed:=replace(source,'IF (o.state IN(''paid'',''refund_pending'',''refunded'')',
    'IF (o.state=''capture_pending'' AND p_state IN(''authorization_pending'',''authorized'')) OR (o.state IN(''paid'',''refund_pending'',''refunded'')');
  IF changed=source THEN RAISE EXCEPTION 'Expected payment state guard was not found'; END IF;
  EXECUTE changed;
END $migration$;

CREATE FUNCTION public.pay_order_begin_completion(p_user_id uuid,p_order_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.order_begin_completion(p_user_id,p_order_id,p_operation_id); $$;
CREATE FUNCTION public.pay_order_completion_context(p_user_id uuid,p_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.completion_payment_context(p_user_id,p_order_id); $$;
REVOKE ALL ON FUNCTION payment_private.order_begin_completion(uuid,uuid,uuid),payment_private.completion_payment_context(uuid,uuid),
  public.pay_order_begin_completion(uuid,uuid,uuid),public.pay_order_completion_context(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.order_begin_completion(uuid,uuid,uuid),payment_private.completion_payment_context(uuid,uuid),
  public.pay_order_begin_completion(uuid,uuid,uuid),public.pay_order_completion_context(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
