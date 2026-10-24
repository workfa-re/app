BEGIN;

-- Retain proved refund evidence if a concurrent dispute already requires review.
-- This never resolves that review or initiates any financial operation.
CREATE OR REPLACE FUNCTION payment_private.order_apply(p_order_id uuid,p_event_id text,p_intent_ref text,p_state text,p_capture_before timestamptz DEFAULT NULL,p_refund_ref text DEFAULT NULL,p_livemode boolean DEFAULT false)
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
    OR (o.refund_ref IS NOT NULL AND p_refund_ref IS NOT NULL AND o.refund_ref<>p_refund_ref)
    OR (o.mode='sandbox' AND p_intent_ref !~ '^pi_[a-zA-Z0-9]+$') OR (o.mode='local_simulation' AND p_intent_ref !~ '^local_pi_[a-zA-Z0-9_-]+$') THEN
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

COMMIT;
