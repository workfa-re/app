BEGIN;
CREATE TABLE payment_private.payout_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE,
  recipient_id uuid NOT NULL REFERENCES payment_private.recipients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  mode text NOT NULL CHECK(mode IN('sandbox','live')),
  account_ref text NOT NULL CHECK(account_ref ~ '^acct_[A-Za-z0-9]+$'),
  kind text NOT NULL CHECK(kind IN('schedule','payout')),
  original_schedule jsonb NOT NULL CHECK(jsonb_typeof(original_schedule)='object'),
  target_schedule jsonb,
  amount_cents bigint CHECK(amount_cents>0 AND amount_cents<=999999999),
  source_type text CHECK(source_type IN('card','bank_account','fpx')),
  destination_ref text CHECK(destination_ref ~ '^ba_[A-Za-z0-9]+$'),
  payout_ref text UNIQUE CHECK(payout_ref ~ '^po_[A-Za-z0-9]+$'),
  payout_status text CHECK(payout_status IN('pending','in_transit','paid','failed','canceled')),
  arrival_at timestamptz,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','submitted','complete','failed','review_required')),
  restored boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  CHECK((kind='schedule' AND target_schedule IS NOT NULL AND amount_cents IS NULL AND source_type IS NULL AND destination_ref IS NULL)
    OR (kind='payout' AND target_schedule IS NULL AND amount_cents IS NOT NULL AND source_type IS NOT NULL AND destination_ref IS NOT NULL)),
  CHECK(finished_at IS NULL OR (restored AND state IN('complete','failed')))
);
CREATE UNIQUE INDEX payout_operations_one_active_idx ON payment_private.payout_operations(recipient_id) WHERE finished_at IS NULL;
CREATE INDEX payout_operations_recipient_idx ON payment_private.payout_operations(recipient_id);
CREATE INDEX payout_operations_user_idx ON payment_private.payout_operations(user_id,mode,created_at DESC);
ALTER TABLE payment_private.payout_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.payout_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION payment_private.valid_auto_payout_schedule(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT value IS NOT NULL AND jsonb_typeof(value)='object' AND (value-ARRAY['interval','monthlyDays','weeklyDays'])='{}'::jsonb
 AND CASE value->>'interval'
 WHEN 'daily' THEN value='{"interval":"daily"}'::jsonb
 WHEN 'monthly' THEN jsonb_typeof(value->'monthlyDays')='array' AND jsonb_array_length(value->'monthlyDays') BETWEEN 1 AND 31
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(value->'monthlyDays') n WHERE jsonb_typeof(n)<>'number' OR n::text !~ '^[0-9]+$' OR (n::text)::int NOT BETWEEN 1 AND 31)
   AND NOT value ? 'weeklyDays'
 WHEN 'weekly' THEN jsonb_typeof(value->'weeklyDays')='array' AND jsonb_array_length(value->'weeklyDays') BETWEEN 1 AND 7
   AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(value->'weeklyDays') n WHERE n NOT IN('monday','tuesday','wednesday','thursday','friday','saturday','sunday'))
   AND NOT value ? 'monthlyDays'
 ELSE false END;
$$;

CREATE FUNCTION payment_private.payout_operation_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',o.id,'operationId',o.operation_id,'userId',o.user_id,'mode',o.mode,'accountRef',o.account_ref,'kind',o.kind,
 'originalSchedule',o.original_schedule,'targetSchedule',o.target_schedule,'amountCents',o.amount_cents,'sourceType',o.source_type,
 'destinationRef',o.destination_ref,'payoutRef',o.payout_ref,'payoutStatus',o.payout_status,'arrivalAt',o.arrival_at,
 'state',o.state,'restored',o.restored,'createdAt',o.created_at,'finished',o.finished_at IS NOT NULL) FROM payment_private.payout_operations o WHERE o.id=p_id;
$$;

CREATE FUNCTION payment_private.payout_operation_begin(p_user_id uuid,p_operation_id uuid,p_account_ref text,p_kind text,
 p_original_schedule jsonb,p_target_schedule jsonb,p_amount_cents bigint,p_source_type text,p_destination_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; o payment_private.payout_operations%ROWTYPE; v_mode text;
BEGIN
 v_mode:=(SELECT c.mode FROM payment_private.configuration c WHERE singleton);
 IF v_mode NOT IN('sandbox','live') OR p_operation_id IS NULL OR p_kind NOT IN('schedule','payout')
  OR NOT payment_private.valid_auto_payout_schedule(p_original_schedule) THEN RAISE EXCEPTION 'RECIPIENT_PAYOUT_INVALID' USING ERRCODE='22023';END IF;
 PERFORM payment_private.assert_recipient(p_user_id,v_mode);
 PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND recipients.mode=v_mode FOR UPDATE;
 IF r.id IS NULL OR r.account_ref IS DISTINCT FROM p_account_ref OR NOT payment_private.recipient_ready(p_user_id) THEN RAISE EXCEPTION 'RECIPIENT_PAYOUT_NOT_READY' USING ERRCODE='42501';END IF;
 IF p_kind='schedule' AND (NOT payment_private.valid_auto_payout_schedule(p_target_schedule) OR p_target_schedule->>'interval'<>'monthly'
  OR jsonb_array_length(p_target_schedule->'monthlyDays')<>1 OR p_amount_cents IS NOT NULL OR p_source_type IS NOT NULL OR p_destination_ref IS NOT NULL)
  OR p_kind='payout' AND (p_target_schedule IS NOT NULL OR p_amount_cents IS NULL OR p_amount_cents<=0 OR p_amount_cents>999999999
   OR p_source_type NOT IN('card','bank_account','fpx') OR p_destination_ref IS NULL OR p_destination_ref !~ '^ba_[A-Za-z0-9]+$') THEN RAISE EXCEPTION 'RECIPIENT_PAYOUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO o FROM payment_private.payout_operations WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF o.user_id<>p_user_id OR o.account_ref<>p_account_ref OR o.mode<>v_mode OR o.kind<>p_kind
    OR o.target_schedule IS DISTINCT FROM p_target_schedule OR o.amount_cents IS DISTINCT FROM p_amount_cents
    OR o.source_type IS DISTINCT FROM p_source_type OR o.destination_ref IS DISTINCT FROM p_destination_ref THEN RAISE EXCEPTION 'RECIPIENT_PAYOUT_CONFLICT' USING ERRCODE='42501';END IF;
  RETURN payment_private.payout_operation_json(o.id);
 END IF;
 SELECT * INTO o FROM payment_private.payout_operations WHERE recipient_id=r.id AND finished_at IS NULL;
 IF FOUND THEN
  IF o.kind<>p_kind OR o.target_schedule IS DISTINCT FROM p_target_schedule OR o.amount_cents IS DISTINCT FROM p_amount_cents
    OR o.source_type IS DISTINCT FROM p_source_type OR o.destination_ref IS DISTINCT FROM p_destination_ref THEN RAISE EXCEPTION 'RECIPIENT_PAYOUT_CONFLICT' USING ERRCODE='42501';END IF;
  RETURN payment_private.payout_operation_json(o.id);
 END IF;
 INSERT INTO payment_private.payout_operations(operation_id,recipient_id,user_id,mode,account_ref,kind,original_schedule,target_schedule,amount_cents,source_type,destination_ref)
 VALUES(p_operation_id,r.id,p_user_id,v_mode,p_account_ref,p_kind,p_original_schedule,p_target_schedule,p_amount_cents,p_source_type,p_destination_ref) RETURNING * INTO o;
 RETURN payment_private.payout_operation_json(o.id);
END; $$;

CREATE FUNCTION payment_private.payout_operation_mark(p_id uuid,p_user_id uuid,p_account_ref text,p_state text,p_restored boolean,
 p_payout_ref text DEFAULT NULL,p_payout_status text DEFAULT NULL,p_arrival_at timestamptz DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.payout_operations%ROWTYPE;
BEGIN
 SELECT * INTO o FROM payment_private.payout_operations WHERE id=p_id FOR UPDATE;
 IF o.id IS NULL OR o.user_id IS DISTINCT FROM p_user_id OR o.account_ref IS DISTINCT FROM p_account_ref
 OR p_state NOT IN('pending','submitted','complete','failed','review_required') OR p_restored IS NULL
 OR (o.payout_ref IS NOT NULL AND p_payout_ref IS DISTINCT FROM o.payout_ref)
 OR (p_payout_ref IS NOT NULL AND p_payout_ref !~ '^po_[A-Za-z0-9]+$')
 OR (p_payout_status IS NOT NULL AND p_payout_status NOT IN('pending','in_transit','paid','failed','canceled'))
 OR (p_state='complete' AND o.kind='payout' AND (p_payout_ref IS NULL OR p_payout_status IS NULL)) THEN RAISE EXCEPTION 'RECIPIENT_PAYOUT_CONFLICT' USING ERRCODE='42501';END IF;
 IF o.finished_at IS NOT NULL THEN
  IF o.kind='payout' AND p_payout_ref=o.payout_ref AND p_payout_status IS NOT NULL THEN
   UPDATE payment_private.payout_operations SET payout_status=p_payout_status,arrival_at=COALESCE(p_arrival_at,arrival_at),updated_at=now() WHERE id=o.id;
  END IF;
  RETURN;
 END IF;
 UPDATE payment_private.payout_operations SET state=p_state,restored=p_restored,payout_ref=COALESCE(p_payout_ref,payout_ref),
 payout_status=COALESCE(p_payout_status,payout_status),arrival_at=COALESCE(p_arrival_at,arrival_at),updated_at=now(),
 finished_at=CASE WHEN p_state IN('complete','failed') AND p_restored THEN now() ELSE NULL END WHERE id=p_id;
END; $$;

CREATE FUNCTION payment_private.payout_operation_lease(p_id uuid,p_token uuid,p_release boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o payment_private.payout_operations%ROWTYPE;
BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'RECIPIENT_PAYOUT_INVALID' USING ERRCODE='22023';END IF;
 SELECT * INTO o FROM payment_private.payout_operations WHERE id=p_id FOR UPDATE;
 IF o.id IS NULL THEN RETURN false;END IF;
 IF p_release THEN
  UPDATE payment_private.payout_operations SET lease_token=NULL,lease_expires_at=NULL WHERE id=p_id AND lease_token=p_token;
  RETURN true;
 END IF;
 IF o.finished_at IS NOT NULL OR (o.lease_token IS NOT NULL AND o.lease_token<>p_token AND o.lease_expires_at>now()) THEN RETURN false;END IF;
 UPDATE payment_private.payout_operations SET lease_token=p_token,lease_expires_at=now()+interval '2 minutes',updated_at=now() WHERE id=p_id;
 RETURN true;
END; $$;
CREATE FUNCTION public.pay_recipient_payout_lease(p_id uuid,p_token uuid,p_release boolean DEFAULT false) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.payout_operation_lease(p_id,p_token,p_release); $$;
CREATE FUNCTION public.pay_recipient_payout_begin(p_user_id uuid,p_operation_id uuid,p_account_ref text,p_kind text,
 p_original_schedule jsonb,p_target_schedule jsonb,p_amount_cents bigint,p_source_type text,p_destination_ref text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.payout_operation_begin(p_user_id,p_operation_id,p_account_ref,p_kind,p_original_schedule,p_target_schedule,p_amount_cents,p_source_type,p_destination_ref); $$;
CREATE FUNCTION public.pay_recipient_payout_mark(p_id uuid,p_user_id uuid,p_account_ref text,p_state text,p_restored boolean,
 p_payout_ref text DEFAULT NULL,p_payout_status text DEFAULT NULL,p_arrival_at timestamptz DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.payout_operation_mark(p_id,p_user_id,p_account_ref,p_state,p_restored,p_payout_ref,p_payout_status,p_arrival_at); $$;
CREATE FUNCTION payment_private.payout_current(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT payment_private.payout_operation_json(o.id) FROM payment_private.payout_operations o
 WHERE o.user_id=p_user_id AND o.mode=(SELECT mode FROM payment_private.configuration WHERE singleton) ORDER BY o.created_at DESC LIMIT 1; $$;
CREATE FUNCTION payment_private.payout_recovery_list() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT COALESCE(jsonb_agg(payment_private.payout_operation_json(o.id)),'[]'::jsonb)
 FROM (SELECT id FROM payment_private.payout_operations WHERE finished_at IS NULL AND mode=(SELECT mode FROM payment_private.configuration WHERE singleton) AND created_at<now()-interval '30 seconds' ORDER BY updated_at,id LIMIT 20) o; $$;
CREATE FUNCTION public.pay_recipient_payout_current(p_user_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.payout_current(p_user_id); $$;
CREATE FUNCTION public.pay_recipient_payout_recovery_list() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.payout_recovery_list(); $$;
CREATE FUNCTION payment_private.payout_find(p_account_ref text,p_operation_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT payment_private.payout_operation_json(id) FROM payment_private.payout_operations WHERE account_ref=p_account_ref AND id=p_operation_id; $$;
CREATE FUNCTION public.pay_recipient_payout_find(p_account_ref text,p_operation_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.payout_find(p_account_ref,p_operation_id); $$;
REVOKE ALL ON FUNCTION payment_private.valid_auto_payout_schedule(jsonb),payment_private.payout_operation_lease(uuid,uuid,boolean),public.pay_recipient_payout_lease(uuid,uuid,boolean),payment_private.payout_operation_json(uuid),payment_private.payout_operation_begin(uuid,uuid,text,text,jsonb,jsonb,bigint,text,text),
 payment_private.payout_operation_mark(uuid,uuid,text,text,boolean,text,text,timestamptz),public.pay_recipient_payout_begin(uuid,uuid,text,text,jsonb,jsonb,bigint,text,text),
 public.pay_recipient_payout_mark(uuid,uuid,text,text,boolean,text,text,timestamptz),payment_private.payout_current(uuid),payment_private.payout_recovery_list(),payment_private.payout_find(text,uuid),public.pay_recipient_payout_current(uuid),public.pay_recipient_payout_recovery_list(),public.pay_recipient_payout_find(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.payout_operation_lease(uuid,uuid,boolean),public.pay_recipient_payout_lease(uuid,uuid,boolean),payment_private.payout_operation_begin(uuid,uuid,text,text,jsonb,jsonb,bigint,text,text),payment_private.payout_operation_mark(uuid,uuid,text,text,boolean,text,text,timestamptz),
 public.pay_recipient_payout_begin(uuid,uuid,text,text,jsonb,jsonb,bigint,text,text),public.pay_recipient_payout_mark(uuid,uuid,text,text,boolean,text,text,timestamptz),
 payment_private.payout_current(uuid),payment_private.payout_recovery_list(),payment_private.payout_find(text,uuid),public.pay_recipient_payout_current(uuid),public.pay_recipient_payout_recovery_list(),public.pay_recipient_payout_find(text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
