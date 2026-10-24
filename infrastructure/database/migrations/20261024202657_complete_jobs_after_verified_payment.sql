BEGIN;

-- Unfinished payment attempts are exclusive. Verified captured funds and
-- post-payment reconciliation must remain recordable after a replaced quote.
-- order_create still refuses another quote while any non-cancelled order exists.
DROP INDEX payment_private.payment_orders_one_active_appointment_idx;
CREATE UNIQUE INDEX payment_orders_one_active_appointment_idx ON payment_private.orders(appointment_id)
  WHERE state IN('awaiting_confirmation','ready','authorization_pending','authorized','capture_pending','cancel_pending','failed');

-- A payment is the source of truth for completion. No existing orders or
-- historical completed jobs are rewritten by this forward change.
CREATE FUNCTION payment_private.finish_paid_appointment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE app public.applications%ROWTYPE; engagement public.job_engagements%ROWTYPE; job public.jobs%ROWTYPE;
BEGIN
  IF NEW.state<>'paid' OR NEW.refunded_cents<>0 OR NEW.recipient_confirmed_at IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO job FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
  SELECT * INTO app FROM public.applications WHERE id=NEW.application_id FOR UPDATE;
  SELECT * INTO engagement FROM public.job_engagements WHERE id=NEW.engagement_id FOR UPDATE;
  IF job.id IS NULL OR app.id IS NULL OR engagement.id IS NULL
    OR job.posted_by IS DISTINCT FROM NEW.provider_id OR app.job_id IS DISTINCT FROM job.id
    OR app.user_id IS DISTINCT FROM NEW.recipient_id OR engagement.application_id IS DISTINCT FROM app.id
    OR engagement.job_id IS DISTINCT FROM job.id OR engagement.provider_id IS DISTINCT FROM NEW.provider_id
    OR engagement.seeker_id IS DISTINCT FROM NEW.recipient_id
    OR NOT EXISTS(SELECT FROM public.job_appointments WHERE id=NEW.appointment_id AND engagement_id=engagement.id) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_SOURCE_REQUIRED' USING ERRCODE='22023';
  END IF;
  -- A cancellation/rejection won a concurrent lifecycle change. Never reopen
  -- it from a late financial event; the verified payment remains reconcilable.
  IF app.status<>'accepted' OR app.conversation_state<>'open' OR engagement.status<>'active' THEN RETURN NEW; END IF;
  -- Reconcile an already successful payment even during a temporary stop.
  -- A previous environment or replaced quote must never close current work.
  IF EXISTS(SELECT FROM payment_private.configuration WHERE singleton
      AND mode IN('local_simulation','sandbox','live') AND mode<>NEW.mode)
    OR NEW.id IS DISTINCT FROM (SELECT latest.id FROM payment_private.orders latest
      WHERE latest.appointment_id=NEW.appointment_id ORDER BY latest.quote_version DESC LIMIT 1)
    OR EXISTS(SELECT FROM payment_private.orders other WHERE other.appointment_id=NEW.appointment_id
      AND other.id<>NEW.id AND other.state IN('paid','refund_pending','refunded','review_required') AND other.refunded_cents<other.total_cents) THEN RETURN NEW; END IF;
  UPDATE public.job_appointments SET status='completed',updated_at=now()
    WHERE id=NEW.appointment_id AND engagement_id=engagement.id AND status='scheduled';
  IF job.job_kind<>'one_time' OR EXISTS(
    SELECT FROM public.job_appointments appointment
    WHERE appointment.engagement_id=engagement.id AND appointment.status<>'cancelled'
      AND NOT EXISTS(SELECT FROM payment_private.orders paid
        WHERE paid.id=(SELECT latest.id FROM payment_private.orders latest
          WHERE latest.appointment_id=appointment.id
          ORDER BY latest.quote_version DESC LIMIT 1)
          AND paid.mode=NEW.mode AND paid.engagement_id=engagement.id AND paid.application_id=app.id
          AND paid.provider_id=NEW.provider_id AND paid.recipient_id=NEW.recipient_id
          AND paid.state='paid' AND paid.refunded_cents=0 AND paid.recipient_confirmed_at IS NOT NULL
          AND NOT EXISTS(SELECT FROM payment_private.orders other WHERE other.appointment_id=appointment.id
            AND other.id<>paid.id AND other.state IN('paid','refund_pending','refunded','review_required') AND other.refunded_cents<other.total_cents))
  ) THEN RETURN NEW; END IF;
  UPDATE public.job_engagements SET status='completed',completed_at=now(),cancelled_at=NULL,
    closed_by=NEW.provider_id,close_reason='Auftrag bezahlt und abgeschlossen.',updated_at=now()
    WHERE id=engagement.id AND status='active';
  UPDATE public.job_agreements SET status='completed',updated_at=now() WHERE application_id=app.id;
  UPDATE public.applications SET status='completed',conversation_state='closed',closed_by=NEW.provider_id,
    closed_at=now(),closed_reason='Auftrag bezahlt und abgeschlossen.',close_action='engagement_completed',
    closed_from_status=app.status,was_primary_before_close=app.is_primary,closure_version=closure_version+1,
    is_primary=false,updated_at=now() WHERE id=app.id;
  UPDATE public.jobs SET status='closed',completed_at=now(),updated_at=now() WHERE id=job.id;
  INSERT INTO public.application_events(application_id,actor_id,event_type,reason,metadata)
    VALUES(app.id,NEW.provider_id,'engagement_completed','Auftrag bezahlt und abgeschlossen.',
      jsonb_build_object('engagement_id',engagement.id,'job_kind',job.job_kind,'payment_order_id',NEW.id));
  INSERT INTO public.notifications(user_id,type,title,body,data) VALUES
    (NEW.recipient_id,'application_status','Vergütung bezahlt','Die Vergütung für „'||job.title||'“ wurde bezahlt. Dein Auszahlungsstand steht in Workfare Pay.',
      jsonb_build_object('route','/app-home/activities?conversation='||app.id::text,'application_id',app.id,'job_id',job.id,'engagement_id',engagement.id)),
    (NEW.provider_id,'application_status','Auftrag abgeschlossen','Deine Zahlung für „'||job.title||'“ ist bestätigt. Den Beleg findest du in Workfare Pay.',
      jsonb_build_object('route','/app-home/settings/payments','application_id',app.id,'job_id',job.id,'engagement_id',engagement.id));
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION payment_private.finish_paid_appointment() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payment_order_finish_paid AFTER UPDATE OF state ON payment_private.orders
  FOR EACH ROW WHEN (NEW.state='paid' AND NEW.refunded_cents=0)
  EXECUTE FUNCTION payment_private.finish_paid_appointment();

-- Keep old completed engagements idempotent, but do not let the old completion
-- endpoint bypass payment for any current, non-cancelled agreed appointment.
DO $migration$
DECLARE source text; changed text;
BEGIN
  source:=pg_get_functiondef('activity_private.complete_job_engagement(uuid,text)'::regprocedure);
  changed:=replace(source,'  UPDATE public.job_engagements',
  '  IF ((EXISTS(SELECT FROM payment_private.order_configuration WHERE singleton AND enabled)
        AND EXISTS(SELECT FROM payment_private.configuration WHERE singleton AND mode IN (''local_simulation'',''sandbox'',''live'')))
      OR EXISTS(SELECT FROM payment_private.orders WHERE application_id=p_application_id))
      AND (NOT EXISTS(SELECT FROM public.job_appointments appointment JOIN public.job_engagements engagement ON engagement.id=appointment.engagement_id
            WHERE engagement.application_id=p_application_id AND appointment.status<>''cancelled'')
        OR EXISTS(SELECT FROM public.job_appointments appointment JOIN public.job_engagements engagement ON engagement.id=appointment.engagement_id
            WHERE engagement.application_id=p_application_id AND appointment.status<>''cancelled''
              AND NOT EXISTS(SELECT FROM payment_private.orders paid
                WHERE paid.id=(SELECT latest.id FROM payment_private.orders latest
                  WHERE latest.appointment_id=appointment.id
                  ORDER BY latest.quote_version DESC LIMIT 1)
                  AND paid.mode=COALESCE((SELECT mode FROM payment_private.configuration WHERE singleton AND mode IN (''local_simulation'',''sandbox'',''live'')),
                    (SELECT mode FROM payment_private.orders WHERE application_id=p_application_id ORDER BY created_at DESC LIMIT 1))
                  AND paid.application_id=p_application_id AND paid.engagement_id=engagement.id
                  AND paid.provider_id=v_user_id AND paid.recipient_id=v_app.user_id
                  AND paid.state=''paid'' AND paid.refunded_cents=0 AND paid.recipient_confirmed_at IS NOT NULL
                  AND NOT EXISTS(SELECT FROM payment_private.orders other WHERE other.appointment_id=appointment.id
                    AND other.id<>paid.id AND other.state IN(''paid'',''refund_pending'',''refunded'',''review_required'') AND other.refunded_cents<other.total_cents)))) THEN
    RETURN jsonb_build_object(''ok'',false,''error'',''PAYMENT_ORDER_PAYMENT_REQUIRED'');
  END IF;

  UPDATE public.job_engagements');
  IF changed=source THEN RAISE EXCEPTION 'Expected engagement completion writer was not found'; END IF;
  EXECUTE changed;

  -- Work can be paid after its date. Only early pre-work card reservation has
  -- a 24-hour window; existing unknown-operation/idempotency expiry survives.
  source:=pg_get_functiondef('payment_private.order_begin(uuid,uuid,text,uuid)'::regprocedure);
  changed:=replace(source,'o.starts_at>now()+interval ''24 hours'' OR o.starts_at<now()-interval ''24 hours''',
    'o.starts_at>now()+interval ''24 hours''');
  IF changed=source THEN RAISE EXCEPTION 'Expected authorization window was not found'; END IF;
  source:=changed;
  changed:=replace(source,'  SELECT * INTO op FROM payment_private.order_operations',
    '  IF p_action IN(''authorize'',''capture'') AND EXISTS(SELECT FROM payment_private.orders other
        WHERE other.appointment_id=o.appointment_id AND other.id<>o.id
          AND other.state IN(''paid'',''refund_pending'',''refunded'',''review_required'') AND other.refunded_cents<other.total_cents) THEN
    RAISE EXCEPTION ''PAYMENT_ORDER_RECONCILIATION_REQUIRED'' USING ERRCODE=''22023'';
  END IF;
  SELECT * INTO op FROM payment_private.order_operations');
  IF changed=source THEN RAISE EXCEPTION 'Expected payment operation guard was not found'; END IF;
  EXECUTE changed;

  -- These service-only reducers/readers validate stored owner and PSP evidence.
  -- A stop on creating charges must not discard already-verified money events.
  source:=pg_get_functiondef('payment_private.order_apply(uuid,text,text,text,timestamptz,text,boolean)'::regprocedure);
  changed:=replace(source,'  PERFORM payment_private.order_assert_mode(o.mode);',
    '  IF o.mode NOT IN(''local_simulation'',''sandbox'',''live'') THEN RAISE EXCEPTION ''PAYMENT_ORDER_OBJECT_MISMATCH'' USING ERRCODE=''22023''; END IF;');
  IF changed=source THEN RAISE EXCEPTION 'Expected verified payment reducer mode guard was not found'; END IF;
  EXECUTE changed;
  source:=pg_get_functiondef('payment_private.order_get(uuid,uuid,boolean)'::regprocedure);
  changed:=replace(source,'  PERFORM payment_private.order_assert_mode(o.mode);',
    '  IF o.mode NOT IN(''local_simulation'',''sandbox'',''live'') THEN RAISE EXCEPTION ''PAYMENT_ORDER_NOT_FOUND'' USING ERRCODE=''42501''; END IF;');
  IF changed=source THEN RAISE EXCEPTION 'Expected owned payment reader mode guard was not found'; END IF;
  EXECUTE changed;
END $migration$;
COMMIT;
