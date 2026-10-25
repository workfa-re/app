BEGIN;
-- Payment events reuse the existing recipient/event-key feed and channel outbox.
-- Only trusted server/trigger inserts are granted; no client can choose priority.
DO $migration$
DECLARE source text; changed text;
BEGIN
 source:=pg_get_functiondef('notification_private.prepare_event()'::regprocedure);
 changed:=replace(source,'  v_category := CASE', E'  v_category := CASE\n    WHEN NEW.type IN (''payment_price_proposed'',''payment_price_confirmed'',''payment_paid'',''payment_failed'',''payment_canceled'',''payment_refund_pending'',''payment_refunded'',''payment_review_required'',''payout_started'',''payout_paid'',''payout_failed'',''payout_canceled'',''payout_schedule_changed'',''payout_review_required'') THEN ''system''');
 IF changed=source THEN RAISE EXCEPTION 'Expected notification classifier missing'; END IF; source:=changed;
 changed:=replace(source,'  NEW.event_type := CASE', E'  NEW.event_type := CASE\n    WHEN NEW.type IN (''payment_price_proposed'',''payment_price_confirmed'',''payment_paid'',''payment_failed'',''payment_canceled'',''payment_refund_pending'',''payment_refunded'',''payment_review_required'',''payout_started'',''payout_paid'',''payout_failed'',''payout_canceled'',''payout_schedule_changed'',''payout_review_required'') THEN NEW.type');
 IF changed=source THEN RAISE EXCEPTION 'Expected notification event classifier missing'; END IF; source:=changed;
 changed:=replace(source,'  NEW.priority := CASE', E'  NEW.priority := CASE\n    WHEN NEW.event_type IN (''payment_price_proposed'',''payment_price_confirmed'',''payment_failed'',''payment_review_required'',''payout_failed'',''payout_review_required'') THEN 1\n    WHEN NEW.event_type IN (''payment_paid'',''payment_refund_pending'',''payment_refunded'',''payout_started'',''payout_paid'',''payout_schedule_changed'') THEN 2');
 IF changed=source THEN RAISE EXCEPTION 'Expected notification importance classifier missing'; END IF;
 EXECUTE changed;
END; $migration$;

-- Keep the established price notices and add one actionable bell event for the
-- opposite participant in the same transaction. Reconfirmation emits nothing.
CREATE OR REPLACE FUNCTION payment_private.order_price_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event text; actor uuid; recipient uuid; content text; notice_id uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  event:='payment_price_proposed'; actor:=NEW.provider_id; recipient:=NEW.recipient_id;
  content:='Endpreis vorgeschlagen: '||replace(to_char(NEW.earnings_cents::numeric/100,'FM9999990.00'),'.',',')||' €.';
 ELSIF OLD.recipient_confirmed_at IS NULL AND NEW.recipient_confirmed_at IS NOT NULL THEN
  event:='payment_price_confirmed'; actor:=NEW.recipient_id; recipient:=NEW.provider_id;
  content:='Endpreis bestätigt: '||replace(to_char(NEW.earnings_cents::numeric/100,'FM9999990.00'),'.',',')||' €.';
 ELSE RETURN NEW; END IF;
 INSERT INTO public.messages(application_id,sender_id,content,kind)
  VALUES(NEW.application_id,actor,content,'system') RETURNING id INTO notice_id;
 INSERT INTO public.application_events(application_id,actor_id,event_type,metadata)
  VALUES(NEW.application_id,actor,event,jsonb_build_object('message_id',notice_id,'payment_order_id',NEW.id,
   'appointment_id',NEW.appointment_id,'quote_version',NEW.quote_version));
 INSERT INTO public.notifications(user_id,type,title,body,event_key,data)
  VALUES(recipient,event,CASE WHEN event='payment_price_proposed' THEN 'Vergütung bestätigen' ELSE 'Preis bestätigt · jetzt bezahlen' END,
   content,'payment-order:'||NEW.id::text||':'||event,jsonb_build_object('route','/app-home/activities?conversation='||NEW.application_id::text||'&payment_message='||notice_id::text,
    'application_id',NEW.application_id,'appointment_id',NEW.appointment_id,'payment_order_id',NEW.id,'message_id',notice_id));
 RETURN NEW;
END; $$;

-- Completion already changes the job and chat atomically. Its generic notices
-- are replaced by exact per-order events below; no duplicate "paid" bells.
DO $migration$
DECLARE source text; changed text; start_at integer;
BEGIN
 source:=pg_get_functiondef('payment_private.finish_paid_appointment()'::regprocedure);
 start_at:=strpos(source,'  INSERT INTO public.notifications(user_id,type,title,body,data) VALUES');
 IF start_at=0 THEN RAISE EXCEPTION 'Expected completion notifications missing'; END IF;
 changed:=substring(source FROM 1 FOR start_at-1)||substring(source FROM strpos(source,'  RETURN NEW;'||chr(10)||'END;'));
 EXECUTE changed;
END; $migration$;

-- The reducer owns state and financial evidence. The order row lock serializes
-- transitions; the persisted event identity survives webhook replay/reordering.
CREATE FUNCTION payment_private.order_lifecycle_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event text; content text; notice_id uuid; amount text; existing_id uuid;
BEGIN
 IF NEW.refunded_cents=NEW.total_cents AND OLD.refunded_cents<>NEW.refunded_cents THEN event:='payment_refunded';
 ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN('paid','failed','canceled','review_required') THEN event:='payment_'||NEW.state;
 ELSIF NEW.state='refund_pending' AND NEW.refund_ref IS NOT NULL AND (OLD.state IS DISTINCT FROM NEW.state OR OLD.refund_ref IS NULL) THEN event:='payment_refund_pending';
 ELSE RETURN NEW; END IF;
 IF EXISTS(SELECT FROM public.application_events e WHERE e.application_id=NEW.application_id
  AND e.event_type=event AND e.metadata->>'payment_order_id'=NEW.id::text) THEN RETURN NEW; END IF;
 amount:=replace(to_char(NEW.earnings_cents::numeric/100,'FM9999990.00'),'.',',')||' €';
 content:=CASE event WHEN 'payment_paid' THEN 'Vergütung bezahlt: '||amount||'.'
  WHEN 'payment_failed' THEN 'Die Zahlung konnte nicht bestätigt werden.'
  WHEN 'payment_canceled' THEN 'Der Zahlungsauftrag wurde storniert.'
  WHEN 'payment_refund_pending' THEN 'Die Erstattung wurde veranlasst.'
  WHEN 'payment_refunded' THEN 'Die Zahlung wurde vollständig erstattet.'
  ELSE 'Der Zahlungsvorgang wird geprüft.' END;
 INSERT INTO public.messages(application_id,sender_id,content,kind)
  VALUES(NEW.application_id,NEW.provider_id,content,'system') RETURNING id INTO notice_id;
 INSERT INTO public.application_events(application_id,actor_id,event_type,metadata)
  VALUES(NEW.application_id,NEW.provider_id,event,jsonb_build_object('message_id',notice_id,'payment_order_id',NEW.id,
   'appointment_id',NEW.appointment_id,'quote_version',NEW.quote_version));
 INSERT INTO public.notifications(user_id,type,title,body,event_key,data)
 SELECT recipient,event,
  CASE event WHEN 'payment_paid' THEN CASE WHEN recipient=NEW.recipient_id THEN 'Du wurdest bezahlt' ELSE 'Zahlung bestätigt' END
   WHEN 'payment_failed' THEN 'Zahlung nicht bestätigt' WHEN 'payment_canceled' THEN 'Zahlungsauftrag storniert'
   WHEN 'payment_refund_pending' THEN 'Erstattung veranlasst' WHEN 'payment_refunded' THEN 'Zahlung erstattet' ELSE 'Zahlung wird geprüft' END,
  CASE WHEN event='payment_paid' AND recipient=NEW.recipient_id THEN amount||' für „'||NEW.title||'“ sind bezahlt. Den Auszahlungsstand siehst du in Workfare Pay.'
   WHEN event='payment_paid' THEN 'Deine Zahlung für „'||NEW.title||'“ ist bestätigt.'
   ELSE content END,
  'payment-order:'||NEW.id::text||':'||event,
  jsonb_build_object('route','/app-home/activities?conversation='||NEW.application_id::text||'&payment_message='||notice_id::text,
   'application_id',NEW.application_id,'appointment_id',NEW.appointment_id,'payment_order_id',NEW.id,'message_id',notice_id)
 FROM unnest(ARRAY[NEW.provider_id,NEW.recipient_id]) recipient;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION payment_private.order_lifecycle_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payment_order_lifecycle_notice AFTER UPDATE OF state,refund_ref,refunded_cents ON payment_private.orders
 FOR EACH ROW EXECUTE FUNCTION payment_private.order_lifecycle_notice();

-- A participant can inspect these notices even after verified payment closes
-- the conversation. Neither translated text nor the latest quote selects a target.
CREATE OR REPLACE FUNCTION payment_private.payment_message_target(p_application_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; matches integer;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
  WHERE a.id=p_application_id AND auth.uid() IN(a.user_id,j.posted_by)) THEN RAISE EXCEPTION 'PAYMENT_MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT count(*),jsonb_agg(jsonb_build_object('applicationId',o.application_id,'appointmentId',o.appointment_id,'orderId',o.id,'event',e.event_type))->0 INTO matches,result
 FROM public.messages m JOIN public.application_events e
  ON e.application_id=m.application_id AND e.metadata->>'message_id'=m.id::text AND e.actor_id=m.sender_id
 JOIN payment_private.orders o ON o.id::text=e.metadata->>'payment_order_id' AND o.application_id=e.application_id
  AND o.appointment_id::text=e.metadata->>'appointment_id' AND o.quote_version::text=e.metadata->>'quote_version'
 WHERE m.id=p_message_id AND m.application_id=p_application_id AND m.kind='system' AND m.deleted_at IS NULL
  AND e.event_type IN('payment_price_proposed','payment_price_confirmed','payment_paid','payment_failed','payment_canceled','payment_refund_pending','payment_refunded','payment_review_required');
 IF matches<>1 THEN RETURN NULL; END IF; RETURN result;
END; $$;

-- Actual bank payouts are account-wide. They must not be attributed to an
-- arbitrary job/chat. The service calls this only after retrieving the actual
-- payout on the exact owned connected account and checking its mode/currency.
CREATE FUNCTION payment_private.recipient_payout_notice(p_user_id uuid,p_mode text,p_account_ref text,p_payout_ref text,p_status text,p_amount_cents bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event text; amount text; identity text;
BEGIN
 IF p_mode NOT IN('live','sandbox') OR p_mode IS DISTINCT FROM(SELECT mode FROM payment_private.configuration WHERE singleton)
  OR p_payout_ref IS NULL OR p_payout_ref !~ '^po_[A-Za-z0-9]+$' OR p_amount_cents IS NULL OR p_amount_cents<=0 OR p_amount_cents>999999999
  OR p_status IS NULL OR p_status NOT IN('pending','in_transit','paid','failed','canceled')
  OR NOT EXISTS(SELECT FROM payment_private.recipients WHERE user_id=p_user_id AND mode=p_mode AND account_ref=p_account_ref) THEN
  RAISE EXCEPTION 'RECIPIENT_PAYOUT_CONFLICT' USING ERRCODE='42501'; END IF;
 identity:=md5(p_mode||':'||p_account_ref||':'||p_payout_ref);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payout-notice:'||identity,0));
 -- A paid payout can later fail at the receiving bank. A late pending/paid
 -- observation cannot undo a failure/cancellation or produce a false success.
 IF p_status IN('pending','in_transit') AND EXISTS(SELECT FROM public.notifications WHERE user_id=p_user_id AND event_key IN('payout:'||identity||':payout_paid','payout:'||identity||':payout_failed','payout:'||identity||':payout_canceled')) THEN RETURN; END IF;
 IF p_status='paid' AND EXISTS(SELECT FROM public.notifications WHERE user_id=p_user_id AND event_key IN('payout:'||identity||':payout_failed','payout:'||identity||':payout_canceled')) THEN RETURN; END IF;
 event:=CASE WHEN p_status IN('pending','in_transit') THEN 'payout_started' ELSE 'payout_'||p_status END;
 amount:=replace(to_char(p_amount_cents::numeric/100,'FM9999990.00'),'.',',')||' €';
 INSERT INTO public.notifications(user_id,type,title,body,event_key,data) VALUES(p_user_id,event,
  CASE event WHEN 'payout_started' THEN 'Auszahlung veranlasst' WHEN 'payout_paid' THEN 'Auszahlung ausgeführt' WHEN 'payout_failed' THEN 'Auszahlung fehlgeschlagen' ELSE 'Auszahlung storniert' END,
  CASE event WHEN 'payout_started' THEN 'Die Auszahlung von '||amount||' an deine hinterlegte Bankverbindung wird verarbeitet.'
   WHEN 'payout_paid' THEN amount||' wurden an deine hinterlegte Bankverbindung ausgezahlt.'
   WHEN 'payout_failed' THEN 'Die Auszahlung von '||amount||' konnte nicht abgeschlossen werden. Prüfe deine Bankverbindung in Workfare Pay.'
   ELSE 'Die Auszahlung von '||amount||' wurde storniert. Den aktuellen Betrag siehst du in Workfare Pay.' END,
  'payout:'||identity||':'||event,jsonb_build_object('route','/app-home/settings/payments','payout_status',p_status));
END; $$;
CREATE FUNCTION public.pay_recipient_payout_notice(p_user_id uuid,p_mode text,p_account_ref text,p_payout_ref text,p_status text,p_amount_cents bigint) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.recipient_payout_notice(p_user_id,p_mode,p_account_ref,p_payout_ref,p_status,p_amount_cents); $$;
REVOKE ALL ON FUNCTION payment_private.recipient_payout_notice(uuid,text,text,text,text,bigint),public.pay_recipient_payout_notice(uuid,text,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.recipient_payout_notice(uuid,text,text,text,text,bigint),public.pay_recipient_payout_notice(uuid,text,text,text,text,bigint) TO service_role;

CREATE FUNCTION payment_private.payout_operation_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.kind='payout' AND NEW.payout_ref IS NOT NULL AND NEW.payout_status IS NOT NULL THEN
  PERFORM payment_private.recipient_payout_notice(NEW.user_id,NEW.mode,NEW.account_ref,NEW.payout_ref,NEW.payout_status,NEW.amount_cents);
 ELSIF NEW.kind='schedule' AND NEW.state='complete' AND OLD.state IS DISTINCT FROM NEW.state AND NEW.restored THEN
  INSERT INTO public.notifications(user_id,type,title,body,event_key,data) VALUES(NEW.user_id,'payout_schedule_changed','Auszahlungsplan geändert',
   'Deine Auszahlungen erfolgen monatlich am '||(NEW.target_schedule->'monthlyDays'->>0)||'.',
   'payout-operation:'||NEW.id::text||':schedule',jsonb_build_object('route','/app-home/settings/payments'));
 END IF;
 IF NEW.kind='payout' AND NEW.state='review_required' AND OLD.state IS DISTINCT FROM NEW.state THEN
  INSERT INTO public.notifications(user_id,type,title,body,event_key,data) VALUES(NEW.user_id,'payout_review_required','Auszahlung wird geprüft',
   'Prüfe den aktuellen Auszahlungsstand in Workfare Pay, bevor du eine weitere Auszahlung anforderst.',
   'payout-operation:'||NEW.id::text||':review',jsonb_build_object('route','/app-home/settings/payments'));
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION payment_private.payout_operation_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_operation_notice AFTER UPDATE OF state,payout_ref,payout_status ON payment_private.payout_operations FOR EACH ROW EXECUTE FUNCTION payment_private.payout_operation_notice();
NOTIFY pgrst,'reload schema';
COMMIT;
