BEGIN;

-- Price events belong to the conversation, not a parallel notification window.
-- A new quote / first confirmation writes one durable notice in its transaction.
CREATE FUNCTION payment_private.order_price_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event text; actor uuid; content text; message_id uuid;
BEGIN
  IF TG_OP='INSERT' THEN
    event:='payment_price_proposed'; actor:=NEW.provider_id;
    content:='Endpreis vorgeschlagen: '||replace(to_char(NEW.earnings_cents::numeric/100,'FM9999990.00'),'.',',')||' €.';
  ELSIF OLD.recipient_confirmed_at IS NULL AND NEW.recipient_confirmed_at IS NOT NULL THEN
    event:='payment_price_confirmed'; actor:=NEW.recipient_id;
    content:='Endpreis bestätigt: '||replace(to_char(NEW.earnings_cents::numeric/100,'FM9999990.00'),'.',',')||' €.';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO public.messages(application_id,sender_id,content,kind)
    VALUES(NEW.application_id,actor,content,'system') RETURNING id INTO message_id;
  INSERT INTO public.application_events(application_id,actor_id,event_type,metadata)
    VALUES(NEW.application_id,actor,event,jsonb_build_object('message_id',message_id,'payment_order_id',NEW.id,
      'appointment_id',NEW.appointment_id,'quote_version',NEW.quote_version));
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION payment_private.order_price_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payment_order_price_notice AFTER INSERT OR UPDATE OF recipient_confirmed_at ON payment_private.orders
  FOR EACH ROW EXECUTE FUNCTION payment_private.order_price_notice();

-- Only a real participant can resolve a server-persisted notice. Matching the
-- message ID to its audit event avoids guessing by visible text or time.
CREATE FUNCTION payment_private.payment_message_target(p_application_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; matches integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
    WHERE a.id=p_application_id AND auth.uid() IN(a.user_id,j.posted_by)) THEN
    RAISE EXCEPTION 'PAYMENT_MESSAGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT count(*),jsonb_agg(jsonb_build_object('applicationId',o.application_id,'appointmentId',o.appointment_id,
    'orderId',o.id,'event',e.event_type))->0 INTO matches,result
  FROM public.messages m JOIN public.application_events e
    ON e.application_id=m.application_id AND e.metadata->>'message_id'=m.id::text AND e.actor_id=m.sender_id
    JOIN payment_private.orders o ON o.id::text=e.metadata->>'payment_order_id' AND o.application_id=e.application_id
      AND o.appointment_id::text=e.metadata->>'appointment_id' AND o.quote_version::text=e.metadata->>'quote_version'
  WHERE m.id=p_message_id AND m.application_id=p_application_id AND m.kind='system' AND m.deleted_at IS NULL
    AND e.event_type IN('payment_price_proposed','payment_price_confirmed');
  IF matches<>1 THEN RETURN NULL; END IF;
  RETURN result;
END; $$;
CREATE FUNCTION public.get_application_payment_for_message(p_application_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT payment_private.payment_message_target(p_application_id,p_message_id);
$$;
REVOKE ALL ON FUNCTION payment_private.payment_message_target(uuid,uuid),public.get_application_payment_for_message(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION payment_private.payment_message_target(uuid,uuid),public.get_application_payment_for_message(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
