BEGIN;

-- Explicit Stripe agreement acceptance is separate from Workfare permission.
-- Retain the first real acceptance evidence for an operation; never raw addresses.
CREATE TABLE payment_private.guardian_pay_acceptances (
  operation_id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES payment_private.recipients(id) ON DELETE CASCADE,
  account_ref text NOT NULL CHECK(account_ref ~ '^acct_[A-Za-z0-9]+$'),
  recipient_generation bigint NOT NULL CHECK(recipient_generation>=0),
  child_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  consent_id uuid NOT NULL,
  declaration_version text NOT NULL DEFAULT 'workfare-pay-guardian-2026-10-24-v1'
    CHECK(declaration_version='workfare-pay-guardian-2026-10-24-v1'),
  input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ip inet NOT NULL,
  user_agent text NOT NULL CHECK(length(user_agent) BETWEEN 1 AND 512 AND user_agent !~ '[[:cntrl:]]'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(child_id<>guardian_id),
  CHECK(masklen(ip)=CASE family(ip) WHEN 4 THEN 32 ELSE 128 END)
);
CREATE INDEX guardian_pay_acceptances_recipient_idx ON payment_private.guardian_pay_acceptances(recipient_id,created_at DESC);
CREATE INDEX guardian_pay_acceptances_child_idx ON payment_private.guardian_pay_acceptances(child_id,created_at DESC);
ALTER TABLE payment_private.guardian_pay_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.guardian_pay_acceptances FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION payment_private.guardian_native_acceptance(
  p_guardian_id uuid,p_child_id uuid,p_account_ref text,p_generation bigint,p_consent_id uuid,
  p_operation_id uuid,p_input_hash text,p_ip inet,p_user_agent text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; binding jsonb; a payment_private.guardian_pay_acceptances%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL OR p_input_hash IS NULL OR p_input_hash !~ '^[0-9a-f]{64}$'
    OR p_generation IS NULL OR p_generation<0 OR p_account_ref IS NULL OR p_account_ref !~ '^acct_[A-Za-z0-9]+$'
    OR p_consent_id IS NULL OR p_ip IS NULL
    OR masklen(p_ip)<>(CASE family(p_ip) WHEN 4 THEN 32 ELSE 128 END)
    OR p_user_agent IS NULL OR length(p_user_agent) NOT BETWEEN 1 AND 512 OR p_user_agent ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'RECIPIENT_ACCEPTANCE_INVALID' USING ERRCODE='22023'; END IF;
  -- Independently validates real verified identities, live configuration, current
  -- eligible guardian and actual 14--17-year-old target before any private write.
  PERFORM payment_private.minor_setup_context(p_guardian_id,p_child_id);
  PERFORM 1 FROM public.profiles WHERE id=p_child_id FOR UPDATE;
  binding:=payment_private.current_minor_binding(p_guardian_id,p_child_id);
  IF binding IS NULL OR binding->>'consentId' IS DISTINCT FROM p_consent_id::text THEN
    RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_child_id AND mode='live' FOR UPDATE;
  IF r.id IS NULL OR r.account_ref IS DISTINCT FROM p_account_ref OR r.generation<>p_generation
    OR r.minor_binding IS DISTINCT FROM binding THEN
    RAISE EXCEPTION 'RECIPIENT_ACCEPTANCE_CONFLICT' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM payment_private.guardian_pay_acceptances WHERE operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF a.recipient_id<>r.id OR a.account_ref<>r.account_ref OR a.child_id<>p_child_id OR a.guardian_id<>p_guardian_id
      OR a.consent_id<>p_consent_id OR a.input_hash<>p_input_hash OR a.recipient_generation>r.generation THEN
      RAISE EXCEPTION 'RECIPIENT_ACCEPTANCE_CONFLICT' USING ERRCODE='42501'; END IF;
  ELSE
    INSERT INTO payment_private.guardian_pay_acceptances(operation_id,recipient_id,account_ref,recipient_generation,child_id,guardian_id,consent_id,input_hash,ip,user_agent)
      VALUES(p_operation_id,r.id,r.account_ref,r.generation,p_child_id,p_guardian_id,p_consent_id,p_input_hash,p_ip,p_user_agent)
      RETURNING * INTO a;
  END IF;
  RETURN jsonb_build_object('ownerId',a.guardian_id,'childId',a.child_id,'accountRef',a.account_ref,'consentId',a.consent_id,
    'inputHash',a.input_hash,'declarationVersion',a.declaration_version,
    'date',to_char(a.accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ip',host(a.ip),'userAgent',a.user_agent);
END; $$;

CREATE FUNCTION public.pay_guardian_native_acceptance(
  p_guardian_id uuid,p_child_id uuid,p_account_ref text,p_generation bigint,p_consent_id uuid,
  p_operation_id uuid,p_input_hash text,p_ip inet,p_user_agent text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT payment_private.guardian_native_acceptance(p_guardian_id,p_child_id,p_account_ref,p_generation,p_consent_id,p_operation_id,p_input_hash,p_ip,p_user_agent);
$$;
REVOKE ALL ON FUNCTION payment_private.guardian_native_acceptance(uuid,uuid,text,bigint,uuid,uuid,text,inet,text),
  public.pay_guardian_native_acceptance(uuid,uuid,text,bigint,uuid,uuid,text,inet,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.guardian_native_acceptance(uuid,uuid,text,bigint,uuid,uuid,text,inet,text),
  public.pay_guardian_native_acceptance(uuid,uuid,text,bigint,uuid,uuid,text,inet,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
