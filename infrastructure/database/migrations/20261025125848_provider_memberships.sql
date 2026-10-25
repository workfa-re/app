BEGIN;
-- One provider membership, reusing the existing mode-bound payment customer.
CREATE TABLE payment_private.membership_configuration (
 mode text PRIMARY KEY CHECK(mode IN('live','sandbox')),
 enabled boolean NOT NULL DEFAULT false,
 tax_treatment text NOT NULL DEFAULT 'pending' CHECK(tax_treatment IN('pending','small_business','vat19')),
 tax_rate_ref text CHECK(tax_rate_ref IS NULL OR tax_rate_ref ~ '^txr_[A-Za-z0-9]+$'),
 product_ref text CHECK(product_ref IS NULL OR product_ref ~ '^prod_[A-Za-z0-9_]+$'),
 price_ref text CHECK(price_ref IS NULL OR price_ref ~ '^price_[A-Za-z0-9]+$'),
 portal_ref text CHECK(portal_ref IS NULL OR portal_ref ~ '^bpc_[A-Za-z0-9]+$'),
 monthly_cents integer NOT NULL DEFAULT 590 CHECK(monthly_cents=590),
 terms_version text NOT NULL DEFAULT 'workfare-plan-v1' CHECK(terms_version='workfare-plan-v1'),
 CHECK(NOT enabled OR(product_ref IS NOT NULL AND price_ref IS NOT NULL AND tax_treatment<>'pending'AND(tax_treatment<>'vat19'OR tax_rate_ref IS NOT NULL)))
);
INSERT INTO payment_private.membership_configuration(mode)VALUES('live'),('sandbox');
ALTER TABLE payment_private.membership_configuration ENABLE ROW LEVEL SECURITY;
CREATE TABLE payment_private.memberships (
 user_id uuid NOT NULL REFERENCES auth.users(id)ON DELETE CASCADE,
 mode text NOT NULL REFERENCES payment_private.membership_configuration(mode),
 customer_id uuid NOT NULL REFERENCES payment_private.customers(id),
 contract_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 subscription_ref text CHECK(subscription_ref IS NULL OR subscription_ref ~ '^sub_[A-Za-z0-9]+$'),
 status text NOT NULL DEFAULT 'none' CHECK(status IN('none','active','canceled','incomplete','incomplete_expired','past_due','paused','trialing','unpaid')),
 paid_until timestamptz,
 period_end timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 invoice_ref text CHECK(invoice_ref IS NULL OR invoice_ref ~ '^in_[A-Za-z0-9]+$'),
 review_required boolean NOT NULL DEFAULT false,
 sync_generation bigint NOT NULL DEFAULT 0 CHECK(sync_generation>=0),
 checked_at timestamptz,
 PRIMARY KEY(user_id,mode),UNIQUE(mode,customer_id),UNIQUE(mode,subscription_ref)
);
CREATE INDEX memberships_customer_idx ON payment_private.memberships(customer_id);
ALTER TABLE payment_private.memberships ENABLE ROW LEVEL SECURITY;
CREATE TABLE payment_private.membership_checkouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL,
 user_id uuid NOT NULL,
 mode text NOT NULL,
 price_ref text NOT NULL,
 subscription_ref text CHECK(subscription_ref IS NULL OR subscription_ref ~ '^sub_[A-Za-z0-9]+$'),
 contract_reference uuid,
 terms_version text NOT NULL,
 session_ref text UNIQUE CHECK(session_ref IS NULL OR session_ref ~ '^cs_(live|test)_[A-Za-z0-9]+$'),
 expires_at timestamptz NOT NULL DEFAULT(statement_timestamp()+interval'24 hours'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','complete','expired')),
 consent_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 immediate_start_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(user_id,mode)REFERENCES payment_private.memberships(user_id,mode)ON DELETE CASCADE,
 UNIQUE(user_id,mode,operation_id)
);
CREATE INDEX membership_checkouts_contract_idx ON payment_private.membership_checkouts(contract_reference)WHERE state='complete';
CREATE INDEX membership_checkouts_owner_idx ON payment_private.membership_checkouts(user_id,mode,consent_at DESC);
ALTER TABLE payment_private.membership_checkouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.membership_configuration,payment_private.memberships,payment_private.membership_checkouts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION payment_private.membership_entitled(p_user_id uuid,p_mode text,p_at timestamptz DEFAULT statement_timestamp()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM payment_private.memberships m JOIN payment_private.membership_configuration c ON c.mode=m.mode
 WHERE m.user_id=p_user_id AND m.mode=p_mode AND m.status='active' AND NOT m.review_required AND m.paid_until>p_at);
$$;
CREATE FUNCTION payment_private.membership_record(p_user_id uuid,p_mode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c payment_private.membership_configuration; m payment_private.memberships; customer text; checkout jsonb;
BEGIN
 SELECT*INTO c FROM payment_private.membership_configuration WHERE mode=p_mode;
 IF NOT FOUND OR p_mode IS DISTINCT FROM(SELECT mode FROM payment_private.configuration WHERE singleton)THEN RAISE EXCEPTION 'MEMBERSHIP_UNAVAILABLE';END IF;
 SELECT*INTO m FROM payment_private.memberships WHERE user_id=p_user_id AND mode=p_mode;
 SELECT customer_ref INTO customer FROM payment_private.customers WHERE user_id=p_user_id AND mode=p_mode;
 SELECT jsonb_build_object('id',x.id,'operationId',x.operation_id,'sessionRef',x.session_ref,'state',x.state,'expiresAt',x.expires_at,'priceRef',x.price_ref,'termsVersion',x.terms_version)
 INTO checkout FROM payment_private.membership_checkouts x WHERE user_id=p_user_id AND mode=p_mode ORDER BY consent_at DESC LIMIT 1;
 RETURN jsonb_build_object('userId',p_user_id,'mode',p_mode,'enabled',c.enabled,'productRef',c.product_ref,'priceRef',c.price_ref,'portalRef',c.portal_ref,'monthlyCents',c.monthly_cents,'taxTreatment',c.tax_treatment,'taxRateRef',c.tax_rate_ref,'termsVersion',c.terms_version,'customerRef',customer,'contractReference',m.contract_reference,
 'subscriptionRef',m.subscription_ref,'status',coalesce(m.status,'none'),'paidUntil',m.paid_until,'periodEnd',m.period_end,'cancelAtPeriodEnd',coalesce(m.cancel_at_period_end,false),'reviewRequired',coalesce(m.review_required,false),'generation',coalesce(m.sync_generation,0),'checkedAt',m.checked_at,'entitled',payment_private.membership_entitled(p_user_id,p_mode),'checkout',checkout);
END;$$;
CREATE FUNCTION payment_private.membership_checkout_claim(p_user_id uuid,p_mode text,p_operation_id uuid,p_terms_version text,p_immediate_start boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c payment_private.membership_configuration; customer payment_private.customers; op payment_private.membership_checkouts; m payment_private.memberships;
BEGIN
 SELECT*INTO c FROM payment_private.membership_configuration WHERE mode=p_mode;
 IF NOT FOUND OR NOT c.enabled OR p_immediate_start IS DISTINCT FROM true OR p_terms_version IS DISTINCT FROM c.terms_version OR p_mode IS DISTINCT FROM(SELECT mode FROM payment_private.configuration WHERE singleton)THEN RAISE EXCEPTION 'MEMBERSHIP_UNAVAILABLE';END IF;
 IF NOT EXISTS(SELECT FROM public.profiles WHERE id=p_user_id AND account_type='job_provider')THEN RAISE EXCEPTION 'MEMBERSHIP_PROVIDER_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT*INTO customer FROM payment_private.customers WHERE user_id=p_user_id AND mode=p_mode;
 IF NOT FOUND OR customer.customer_ref IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_CUSTOMER_REQUIRED';END IF;
 INSERT INTO payment_private.memberships(user_id,mode,customer_id)VALUES(p_user_id,p_mode,customer.id)ON CONFLICT DO NOTHING;
 SELECT*INTO m FROM payment_private.memberships WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
 IF m.customer_id<>customer.id THEN RAISE EXCEPTION 'MEMBERSHIP_OWNER_CONFLICT';END IF;
 IF m.subscription_ref IS NOT NULL AND m.status NOT IN('canceled','incomplete_expired','none')THEN RAISE EXCEPTION 'MEMBERSHIP_EXISTS';END IF;
 SELECT*INTO op FROM payment_private.membership_checkouts WHERE user_id=p_user_id AND mode=p_mode AND operation_id=p_operation_id;
 IF FOUND THEN
  IF op.price_ref<>c.price_ref OR op.terms_version<>p_terms_version THEN RAISE EXCEPTION 'MEMBERSHIP_CHECKOUT_CONFLICT';END IF;
  RETURN payment_private.membership_record(p_user_id,p_mode);
 END IF;
 IF EXISTS(SELECT FROM payment_private.membership_checkouts WHERE user_id=p_user_id AND mode=p_mode AND state='pending'AND expires_at>statement_timestamp())THEN RAISE EXCEPTION 'MEMBERSHIP_CHECKOUT_PENDING';END IF;
 UPDATE payment_private.membership_checkouts SET state='expired'WHERE user_id=p_user_id AND mode=p_mode AND state='pending';
 INSERT INTO payment_private.membership_checkouts(operation_id,user_id,mode,price_ref,terms_version)VALUES(p_operation_id,p_user_id,p_mode,c.price_ref,p_terms_version);
 RETURN payment_private.membership_record(p_user_id,p_mode);
END;$$;
CREATE FUNCTION payment_private.membership_checkout_attach(p_user_id uuid,p_mode text,p_checkout_id uuid,p_session_ref text,p_expires_at timestamptz,p_complete boolean)RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_mode IS DISTINCT FROM(SELECT mode FROM payment_private.configuration WHERE singleton)OR p_session_ref !~ '^cs_(live|test)_[A-Za-z0-9]+$' OR p_expires_at IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_CHECKOUT_CONFLICT';END IF;
 UPDATE payment_private.membership_checkouts SET session_ref=p_session_ref,expires_at=least(p_expires_at,consent_at+interval'24 hours'),state=CASE WHEN p_complete THEN'complete'ELSE state END,subscription_ref=CASE WHEN p_complete THEN(SELECT subscription_ref FROM payment_private.memberships WHERE user_id=p_user_id AND mode=p_mode)ELSE subscription_ref END,contract_reference=CASE WHEN p_complete THEN(SELECT contract_reference FROM payment_private.memberships WHERE user_id=p_user_id AND mode=p_mode)ELSE contract_reference END
 WHERE id=p_checkout_id AND user_id=p_user_id AND mode=p_mode AND(session_ref IS NULL OR session_ref=p_session_ref);
 IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_CHECKOUT_CONFLICT';END IF;
END;$$;
CREATE FUNCTION payment_private.membership_checkout_expire(p_user_id uuid,p_mode text,p_checkout_id uuid,p_session_ref text)RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
BEGIN
 UPDATE payment_private.membership_checkouts SET state='expired'WHERE id=p_checkout_id AND user_id=p_user_id AND mode=p_mode AND session_ref=p_session_ref AND state='pending';
END;$$;
CREATE FUNCTION public.pay_membership_checkout_expire(p_user_id uuid,p_mode text,p_checkout_id uuid,p_session_ref text)RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_checkout_expire(p_user_id,p_mode,p_checkout_id,p_session_ref);$$;
CREATE FUNCTION payment_private.membership_sync_begin(p_user_id uuid,p_mode text,p_customer_ref text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ticket bigint;
BEGIN
 IF p_mode IS DISTINCT FROM(SELECT mode FROM payment_private.configuration WHERE singleton)THEN RAISE EXCEPTION 'MEMBERSHIP_UNAVAILABLE';END IF;
 UPDATE payment_private.memberships m SET sync_generation=sync_generation+1 FROM payment_private.customers c WHERE m.user_id=p_user_id AND m.mode=p_mode AND c.id=m.customer_id AND c.customer_ref=p_customer_ref RETURNING m.sync_generation INTO ticket;
 IF ticket IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_OWNER_CONFLICT';END IF;RETURN ticket;
END;$$;
CREATE FUNCTION payment_private.membership_sync_apply(p_user_id uuid,p_mode text,p_generation bigint,p_subscription_ref text,p_status text,p_paid_until timestamptz,p_period_end timestamptz,p_cancel_at_period_end boolean,p_invoice_ref text,p_review_required boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m payment_private.memberships; is_new boolean;
BEGIN
 SELECT*INTO m FROM payment_private.memberships WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
 IF NOT FOUND OR m.sync_generation<>p_generation THEN RETURN false;END IF;
 IF p_mode IS DISTINCT FROM(SELECT mode FROM payment_private.configuration WHERE singleton)OR p_subscription_ref !~ '^sub_[A-Za-z0-9]+$' OR p_status NOT IN('active','canceled','incomplete','incomplete_expired','past_due','paused','trialing','unpaid')OR p_cancel_at_period_end IS NULL OR p_review_required IS NULL THEN RAISE EXCEPTION 'MEMBERSHIP_SYNC_CONFLICT';END IF;
 IF m.subscription_ref IS NOT NULL AND m.subscription_ref<>p_subscription_ref AND m.status NOT IN('canceled','incomplete_expired','none')THEN RAISE EXCEPTION 'MEMBERSHIP_SUBSCRIPTION_CONFLICT';END IF;
 IF p_paid_until IS NOT NULL AND(p_period_end IS NULL OR p_paid_until>p_period_end OR p_invoice_ref IS NULL)THEN RAISE EXCEPTION 'MEMBERSHIP_PERIOD_CONFLICT';END IF;
 is_new:=m.subscription_ref IS DISTINCT FROM p_subscription_ref;
 UPDATE payment_private.memberships SET contract_reference=CASE WHEN is_new AND m.subscription_ref IS NOT NULL THEN gen_random_uuid()ELSE contract_reference END,subscription_ref=p_subscription_ref,status=p_status,paid_until=CASE WHEN p_review_required THEN NULL ELSE p_paid_until END,period_end=p_period_end,cancel_at_period_end=p_cancel_at_period_end,invoice_ref=p_invoice_ref,review_required=p_review_required,checked_at=statement_timestamp()
 WHERE user_id=p_user_id AND mode=p_mode;
 IF p_status='active'AND p_paid_until>statement_timestamp()AND NOT p_review_required AND(is_new OR m.paid_until IS NULL OR p_paid_until>m.paid_until)THEN
  INSERT INTO public.notifications(user_id,type,title,body,event_key,data)VALUES(p_user_id,'membership_active','Workfare Plan ist aktiv','Dein Workfare-Anteil entfällt bei neuen Jobs mit dem aktuellen Tarif.','membership:'||p_subscription_ref||':'||p_invoice_ref,jsonb_build_object('route','/app-home/settings/membership'));
 END IF;
 IF p_status IN('past_due','unpaid')AND(m.status IS DISTINCT FROM p_status OR m.invoice_ref IS DISTINCT FROM p_invoice_ref)THEN
  INSERT INTO public.notifications(user_id,type,title,body,event_key,data)VALUES(p_user_id,'membership_payment_failed','Zahlung für Workfare Plan prüfen','Bitte prüfe deine Zahlungsart. Ohne bestätigten bezahlten Zeitraum entstehen keine neuen Abo-Vorteile.','membership:'||p_subscription_ref||':'||coalesce(p_invoice_ref,'unknown')||':payment-failed',jsonb_build_object('route','/app-home/settings/membership'));
 END IF;
 IF NOT is_new AND m.cancel_at_period_end IS DISTINCT FROM p_cancel_at_period_end THEN
  INSERT INTO public.notifications(user_id,type,title,body,event_key,data)VALUES(p_user_id,'membership_renewal_changed',CASE WHEN p_cancel_at_period_end THEN 'Workfare Plan gekündigt'ELSE'Workfare Plan läuft weiter'END,CASE WHEN p_cancel_at_period_end THEN'Dein Plan verlängert sich nicht mehr. Den bezahlten Zeitraum kannst du weiter nutzen.'ELSE'Die monatliche Verlängerung ist wieder aktiv.'END,'membership:'||p_subscription_ref||':renewal:'||p_generation::text,jsonb_build_object('route','/app-home/settings/membership'));
 END IF;
 RETURN true;
END;$$;
CREATE FUNCTION payment_private.membership_find(p_mode text,p_customer_ref text)RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''AS $$SELECT m.user_id FROM payment_private.memberships m JOIN payment_private.customers c ON c.id=m.customer_id WHERE m.mode=p_mode AND c.mode=p_mode AND c.customer_ref=p_customer_ref;$$;
CREATE FUNCTION public.pay_membership_record(p_user_id uuid,p_mode text)RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_record(p_user_id,p_mode);$$;
CREATE FUNCTION public.pay_membership_checkout_claim(p_user_id uuid,p_mode text,p_operation_id uuid,p_terms_version text,p_immediate_start boolean)RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_checkout_claim(p_user_id,p_mode,p_operation_id,p_terms_version,p_immediate_start);$$;
CREATE FUNCTION public.pay_membership_checkout_attach(p_user_id uuid,p_mode text,p_checkout_id uuid,p_session_ref text,p_expires_at timestamptz,p_complete boolean)RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_checkout_attach(p_user_id,p_mode,p_checkout_id,p_session_ref,p_expires_at,p_complete);$$;
CREATE FUNCTION public.pay_membership_sync_begin(p_user_id uuid,p_mode text,p_customer_ref text)RETURNS bigint LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_sync_begin(p_user_id,p_mode,p_customer_ref);$$;
CREATE FUNCTION public.pay_membership_sync_apply(p_user_id uuid,p_mode text,p_generation bigint,p_subscription_ref text,p_status text,p_paid_until timestamptz,p_period_end timestamptz,p_cancel_at_period_end boolean,p_invoice_ref text,p_review_required boolean)RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_sync_apply(p_user_id,p_mode,p_generation,p_subscription_ref,p_status,p_paid_until,p_period_end,p_cancel_at_period_end,p_invoice_ref,p_review_required);$$;
CREATE FUNCTION public.pay_membership_find(p_mode text,p_customer_ref text)RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_find(p_mode,p_customer_ref);$$;
CREATE TABLE payment_private.membership_cancellations(
 id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id)ON DELETE CASCADE,mode text NOT NULL CHECK(mode IN('live','sandbox')),
 email text,provided_name text,kind text NOT NULL DEFAULT 'ordinary'CHECK(kind IN('ordinary','extraordinary','withdrawal')),reason text,requested_end date,review_required boolean NOT NULL DEFAULT false,review_resolved_at timestamptz,contract_reference uuid,subscription_ref text,request_hash text NOT NULL,rate_hash text NOT NULL,received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 state text NOT NULL CHECK(state IN('pending','complete','unmatched')),confirmed_until timestamptz,receipt_sent_at timestamptz,mail_sent_at timestamptz,
 lease_until timestamptz,lease_token uuid,
 CHECK((user_id IS NULL AND email IS NULL AND state='unmatched')OR(user_id IS NOT NULL AND email IS NOT NULL))
);
CREATE INDEX membership_cancellations_pending_idx ON payment_private.membership_cancellations(received_at)WHERE state='pending'OR(state='complete'AND mail_sent_at IS NULL);
CREATE INDEX membership_cancellations_owner_idx ON payment_private.membership_cancellations(user_id);
CREATE INDEX membership_cancellations_rate_idx ON payment_private.membership_cancellations(rate_hash,received_at DESC);
ALTER TABLE payment_private.membership_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.membership_cancellations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION payment_private.membership_cancellation_request(p_reference uuid,p_email text,p_name text,p_id uuid,p_rate_hash text,p_mode text,p_kind text,p_reason text,p_requested_end date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing payment_private.membership_cancellations; owner uuid; subscription_id text; fingerprint text;
BEGIN
 IF p_mode NOT IN('live','sandbox')OR length(p_rate_hash)<>64 OR length(p_email)>254 OR length(p_name)>150 OR p_kind NOT IN('ordinary','extraordinary','withdrawal')OR length(p_reason)>2000 THEN RAISE EXCEPTION 'MEMBERSHIP_CANCELLATION_INVALID';END IF;
 fingerprint:=md5(p_reference::text||':'||lower(trim(p_email))||':'||p_kind||':'||coalesce(p_reason,'')||':'||coalesce(p_requested_end::text,''));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('membership-cancellation:'||p_rate_hash,0));
 SELECT*INTO existing FROM payment_private.membership_cancellations WHERE id=p_id;
 IF FOUND THEN
  IF existing.request_hash<>fingerprint THEN RAISE EXCEPTION 'MEMBERSHIP_CANCELLATION_CONFLICT';END IF;
  RETURN jsonb_build_object('reference',existing.id,'receivedAt',existing.received_at);
 END IF;
 IF(SELECT count(*)FROM payment_private.membership_cancellations WHERE rate_hash=p_rate_hash AND received_at>statement_timestamp()-interval'15 minutes')>=5 THEN RAISE EXCEPTION 'MEMBERSHIP_RATE_LIMITED';END IF;
 SELECT m.user_id,m.subscription_ref INTO owner,subscription_id FROM(SELECT user_id,mode,subscription_ref,contract_reference FROM payment_private.memberships UNION SELECT user_id,mode,subscription_ref,contract_reference FROM payment_private.membership_checkouts WHERE state='complete')m JOIN auth.users u ON u.id=m.user_id
 WHERE m.contract_reference=p_reference AND m.mode=p_mode AND lower(trim(u.email))=lower(trim(p_email))AND m.subscription_ref IS NOT NULL LIMIT 1;
 INSERT INTO payment_private.membership_cancellations(id,user_id,mode,email,provided_name,kind,reason,requested_end,review_required,contract_reference,subscription_ref,request_hash,rate_hash,state)
 VALUES(p_id,owner,p_mode,CASE WHEN owner IS NOT NULL THEN lower(trim(p_email))ELSE NULL END,CASE WHEN owner IS NOT NULL THEN p_name ELSE NULL END,p_kind,CASE WHEN owner IS NOT NULL THEN p_reason ELSE NULL END,p_requested_end,p_kind IN('extraordinary','withdrawal')OR p_requested_end IS NOT NULL,CASE WHEN owner IS NOT NULL THEN p_reference ELSE NULL END,subscription_id,fingerprint,p_rate_hash,CASE WHEN owner IS NULL THEN'unmatched'ELSE'pending'END);
 RETURN jsonb_build_object('reference',p_id,'receivedAt',statement_timestamp());
END;$$;
CREATE FUNCTION payment_private.membership_cancellation_take(p_id uuid,p_token uuid)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.membership_cancellations;
BEGIN
 UPDATE payment_private.membership_cancellations SET lease_until=statement_timestamp()+interval'180 seconds',lease_token=p_token
 WHERE id=p_id AND state IN('pending','complete')AND mail_sent_at IS NULL AND(lease_until IS NULL OR lease_until<statement_timestamp())
 RETURNING*INTO r;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',r.id,'userId',r.user_id,'mode',r.mode,'email',r.email,'receivedAt',r.received_at,'state',r.state,'confirmedUntil',r.confirmed_until,'contractReference',r.contract_reference,'subscriptionRef',r.subscription_ref,'name',r.provided_name,'kind',r.kind,'reason',r.reason,'requestedEnd',r.requested_end,'reviewRequired',r.review_required,'receiptSentAt',r.receipt_sent_at);
END;$$;
CREATE FUNCTION payment_private.membership_cancellation_complete(p_id uuid,p_token uuid,p_until timestamptz,p_mail_sent boolean)RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE payment_private.membership_cancellations SET state='complete',confirmed_until=p_until,mail_sent_at=CASE WHEN p_mail_sent THEN statement_timestamp()ELSE mail_sent_at END,receipt_sent_at=CASE WHEN p_mail_sent THEN coalesce(receipt_sent_at,statement_timestamp())ELSE receipt_sent_at END,
 lease_until=NULL,lease_token=NULL WHERE id=p_id AND lease_token=p_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_CANCELLATION_CONFLICT';END IF;
END;$$;
CREATE FUNCTION payment_private.membership_cancellation_receipt(p_id uuid,p_token uuid)RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''AS $$
BEGIN
 UPDATE payment_private.membership_cancellations SET receipt_sent_at=coalesce(receipt_sent_at,statement_timestamp()),lease_until=NULL,lease_token=NULL WHERE id=p_id AND lease_token=p_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_CANCELLATION_CONFLICT';END IF;
END;$$;
CREATE FUNCTION public.pay_membership_cancellation_receipt(p_id uuid,p_token uuid)RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_cancellation_receipt(p_id,p_token);$$;
CREATE FUNCTION payment_private.membership_cancellation_pending(p_mode text)RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''AS $$SELECT id FROM payment_private.membership_cancellations WHERE mode=p_mode AND(state='pending'OR(state='complete'AND mail_sent_at IS NULL))AND(lease_until IS NULL OR lease_until<statement_timestamp())ORDER BY received_at LIMIT 10;$$;
CREATE FUNCTION public.pay_membership_cancellation_request(p_reference uuid,p_email text,p_name text,p_id uuid,p_rate_hash text,p_mode text,p_kind text,p_reason text,p_requested_end date)RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_cancellation_request(p_reference,p_email,p_name,p_id,p_rate_hash,p_mode,p_kind,p_reason,p_requested_end);$$;
CREATE FUNCTION public.pay_membership_cancellation_take(p_id uuid,p_token uuid)RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_cancellation_take(p_id,p_token);$$;
CREATE FUNCTION public.pay_membership_cancellation_complete(p_id uuid,p_token uuid,p_until timestamptz,p_mail_sent boolean)RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_cancellation_complete(p_id,p_token,p_until,p_mail_sent);$$;
CREATE FUNCTION public.pay_membership_cancellation_pending(p_mode text)RETURNS SETOF uuid LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT*FROM payment_private.membership_cancellation_pending(p_mode);$$;
CREATE FUNCTION payment_private.membership_cancellation_review_count(p_mode text)RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''AS $$SELECT count(*)FROM payment_private.membership_cancellations WHERE mode=p_mode AND review_required AND review_resolved_at IS NULL;$$;
CREATE FUNCTION public.pay_membership_cancellation_review_count(p_mode text)RETURNS bigint LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT payment_private.membership_cancellation_review_count(p_mode);$$;
DO $$DECLARE fn record;BEGIN
 FOR fn IN SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE(n.nspname='payment_private'AND p.proname LIKE 'membership_%')OR(n.nspname='public'AND p.proname LIKE'pay_membership_%')LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC,anon,authenticated,service_role',fn.nspname,fn.proname,fn.args);
 IF fn.proname<>'membership_entitled'THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',fn.nspname,fn.proname,fn.args);END IF;
 END LOOP;
END;$$;
DO $classification$DECLARE source text;changed text;BEGIN
 source:=pg_get_functiondef('notification_private.prepare_event()'::regprocedure);
 changed:=replace(source,'  NEW.event_type := CASE',E'  NEW.event_type := CASE\n    WHEN NEW.type IN (''membership_active'',''membership_payment_failed'',''membership_renewal_changed'') THEN NEW.type');
 IF changed=source THEN RAISE EXCEPTION 'Expected event classifier missing';END IF;source:=changed;
 changed:=replace(source,'  NEW.priority := CASE',E'  NEW.priority := CASE\n    WHEN NEW.type=''membership_payment_failed'' THEN 1\n    WHEN NEW.type IN (''membership_active'',''membership_renewal_changed'') THEN 2');
 IF changed=source THEN RAISE EXCEPTION 'Expected priority classifier missing';END IF;EXECUTE changed;
END;$classification$;
NOTIFY pgrst,'reload schema';
COMMIT;
