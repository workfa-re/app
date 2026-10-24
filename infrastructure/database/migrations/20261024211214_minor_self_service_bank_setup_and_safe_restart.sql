BEGIN;

-- A new consent never silently transfers an existing payout account. Only a
-- freshly inspected, empty and never-used setup may be restarted explicitly.
-- Retain the old account/binding for reconciliation; no Stripe account is deleted.
CREATE TABLE payment_private.recipient_setup_restarts (
  operation_id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES payment_private.recipients(id) ON DELETE CASCADE,
  child_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  old_account_ref text NOT NULL UNIQUE CHECK(old_account_ref ~ '^acct_[A-Za-z0-9]+$'),
  old_generation bigint NOT NULL CHECK(old_generation>=0),
  new_generation bigint NOT NULL CHECK(new_generation=old_generation+1),
  old_minor_binding jsonb NOT NULL CHECK(jsonb_typeof(old_minor_binding)='object'),
  new_minor_binding jsonb NOT NULL CHECK(jsonb_typeof(new_minor_binding)='object'),
  stripe_checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipient_id,old_generation),
  CHECK(actor_id IN(child_id,guardian_id)),
  CHECK(old_minor_binding IS DISTINCT FROM new_minor_binding)
);
CREATE INDEX recipient_setup_restarts_child_idx ON payment_private.recipient_setup_restarts(child_id,created_at DESC);
ALTER TABLE payment_private.recipient_setup_restarts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON payment_private.recipient_setup_restarts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION payment_private.recipient_setup_restartable(p_recipient_id uuid,p_guardian_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT FROM payment_private.recipients r JOIN public.profiles p ON p.id=r.user_id
    WHERE r.id=p_recipient_id AND r.mode='live' AND r.livemode
      AND r.account_ref IS NOT NULL AND r.minor_binding IS NOT NULL
      AND r.status IN('onboarding','pending')
      AND NOT r.has_payout_method AND NOT r.details_submitted
      AND NOT r.transfers_active AND NOT r.payouts_enabled
      AND r.guardian_person_ref IS NULL AND r.guardian_tos_accepted_at IS NULL
      AND r.verified_at IS NULL
      AND r.claim_birthdate=p.birthdate
      AND r.minor_binding->>'childBirthdate'=p.birthdate::text
      AND NOT payment_private.minor_binding_current(r.user_id,r.minor_binding)
      -- A currently eligible old parent keeps their account. The same
      -- parent can explicitly restart an unused setup after a renewed
      -- declaration; another parent's approval never authorizes takeover.
      AND (payment_private.current_minor_binding((r.minor_binding->>'guardianId')::uuid,r.user_id) IS NULL
        OR p_guardian_id IS NULL OR p_guardian_id=(r.minor_binding->>'guardianId')::uuid)
      AND NOT EXISTS(SELECT FROM payment_private.orders o WHERE o.recipient_id=r.user_id OR o.account_ref=r.account_ref));
$$;

CREATE FUNCTION payment_private.minor_setup_context(p_actor_id uuid,p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE child public.profiles%ROWTYPE; r payment_private.recipients%ROWTYPE; guardians jsonb;
BEGIN
  IF NOT EXISTS(SELECT FROM payment_private.configuration WHERE singleton AND mode='live')
    OR NOT EXISTS(SELECT FROM payment_private.live_configuration WHERE singleton AND enabled AND recipient_setup_enabled) THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501'; END IF;
  SELECT * INTO child FROM public.profiles WHERE id=p_child_id;
  IF child.id IS NULL OR child.account_type IS DISTINCT FROM 'job_seeker'
    OR child.country IS DISTINCT FROM 'DE' OR NOT payment_private.live_identity(child.id)
    OR child.birthdate IS NULL OR child.birthdate>(guardian_private.today()-interval '14 years')::date
    OR child.birthdate<=(guardian_private.today()-interval '18 years')::date
    OR p_actor_id IS NULL OR NOT payment_private.live_identity(p_actor_id)
    OR (p_actor_id<>p_child_id AND payment_private.current_minor_binding(p_actor_id,p_child_id) IS NULL) THEN
    RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('guardianId',p.id,'name',p.full_name) ORDER BY p.full_name,p.id),'[]'::jsonb)
    INTO guardians FROM public.guardian_relationships rel JOIN public.profiles p ON p.id=rel.guardian_id
    WHERE rel.child_id=p_child_id AND rel.status='active' AND payment_private.current_minor_binding(p.id,p_child_id) IS NOT NULL;
  IF jsonb_array_length(guardians)>100 THEN RAISE EXCEPTION 'RECIPIENT_GUARDIAN_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_child_id AND mode='live';
  RETURN jsonb_build_object('userId',p_child_id,'guardians',guardians,
    'recipient',CASE WHEN r.id IS NULL THEN NULL ELSE payment_private.recipient_json(r.id) END,
    'bindingCurrent',COALESCE(payment_private.minor_binding_current(p_child_id,r.minor_binding),false),
    'hasPayoutMethod',COALESCE(r.has_payout_method,false),'ready',COALESCE(payment_private.recipient_ready(p_child_id),false),
    'canRestart',COALESCE(payment_private.recipient_setup_restartable(r.id,CASE WHEN p_actor_id=p_child_id THEN NULL ELSE p_actor_id END),false));
END; $$;

CREATE FUNCTION payment_private.minor_recipient_claim(p_child_id uuid,p_guardian_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; selected_guardian uuid; candidates uuid[];
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'RECIPIENT_INVALID_OPERATION' USING ERRCODE='22023'; END IF;
  -- Context is read-only but independently validates the child's actual identity,
  -- age, country and current live configuration before selecting any guardian.
  PERFORM payment_private.minor_setup_context(p_child_id,p_child_id);
  PERFORM 1 FROM public.profiles WHERE id=p_child_id FOR UPDATE;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_child_id AND mode='live' FOR UPDATE;
  IF p_guardian_id IS NOT NULL THEN
    selected_guardian:=p_guardian_id;
    IF payment_private.current_minor_binding(selected_guardian,p_child_id) IS NULL THEN
      RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
  ELSIF r.minor_binding IS NOT NULL AND payment_private.minor_binding_current(p_child_id,r.minor_binding) THEN
    selected_guardian:=(r.minor_binding->>'guardianId')::uuid;
  ELSE
    SELECT array_agg(p.id ORDER BY p.id) INTO candidates FROM public.guardian_relationships rel JOIN public.profiles p ON p.id=rel.guardian_id
      WHERE rel.child_id=p_child_id AND rel.status='active' AND payment_private.current_minor_binding(p.id,p_child_id) IS NOT NULL;
    IF COALESCE(cardinality(candidates),0)=0 THEN RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
    IF cardinality(candidates)<>1 THEN RAISE EXCEPTION 'RECIPIENT_GUARDIAN_SELECTION_REQUIRED' USING ERRCODE='42501'; END IF;
    selected_guardian:=candidates[1];
  END IF;
  RETURN payment_private.guardian_recipient_claim(selected_guardian,p_child_id,p_operation_id);
END; $$;

CREATE OR REPLACE FUNCTION payment_private.preserve_minor_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.minor_binding IS DISTINCT FROM NEW.minor_binding OR OLD.claim_birthdate IS DISTINCT FROM NEW.claim_birthdate
    OR (OLD.mode='live' AND OLD.claim_display_name IS DISTINCT FROM NEW.claim_display_name)
    OR (OLD.minor_binding IS NOT NULL AND (OLD.claim_contact_email IS DISTINCT FROM NEW.claim_contact_email
      OR OLD.claim_display_name IS DISTINCT FROM NEW.claim_display_name)) THEN
    IF NOT EXISTS(SELECT FROM payment_private.recipient_setup_restarts a
      WHERE a.recipient_id=OLD.id AND a.child_id=OLD.user_id
        AND a.old_account_ref=OLD.account_ref AND a.old_generation=OLD.generation
        AND a.new_generation=NEW.generation AND a.operation_id=NEW.claim_operation
        AND a.old_minor_binding=OLD.minor_binding AND a.new_minor_binding=NEW.minor_binding
        AND a.created_at=now()
        AND NEW.id=OLD.id AND NEW.user_id=OLD.user_id AND NEW.mode=OLD.mode AND NEW.livemode=OLD.livemode
        AND NEW.claim_birthdate IS NOT DISTINCT FROM OLD.claim_birthdate
        AND NEW.claim_contact_email IS NOT DISTINCT FROM OLD.claim_contact_email
        AND NEW.claim_display_name IS NOT DISTINCT FROM OLD.claim_display_name
        AND NEW.account_ref IS NULL AND NEW.status='onboarding'
        AND NEW.guardian_person_ref IS NULL AND NEW.guardian_tos_accepted_at IS NULL
        AND NEW.guardian_reason='guardian_kyc_required'
        AND NOT NEW.has_payout_method AND NOT NEW.details_submitted AND NOT NEW.transfers_active AND NOT NEW.payouts_enabled
        AND NEW.requirement_count=0 AND NEW.verified_at IS NULL) THEN
      RAISE EXCEPTION 'RECIPIENT_BINDING_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION payment_private.restart_minor_setup(
  p_actor_id uuid,p_child_id uuid,p_guardian_id uuid,p_expected_account_ref text,p_expected_generation bigint,
  p_operation_id uuid,p_verified_empty boolean,p_stripe_checked_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; binding jsonb; previous payment_private.recipient_setup_restarts%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL OR p_expected_account_ref IS NULL OR p_expected_account_ref !~ '^acct_[A-Za-z0-9]+$'
    OR p_expected_generation IS NULL OR p_expected_generation<0 OR p_verified_empty IS DISTINCT FROM true
    OR p_stripe_checked_at IS NULL THEN RAISE EXCEPTION 'RECIPIENT_RESTART_PROOF_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM payment_private.minor_setup_context(p_actor_id,p_child_id);
  IF p_actor_id<>p_child_id AND p_actor_id<>p_guardian_id THEN
    RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=p_child_id FOR UPDATE;
  binding:=payment_private.current_minor_binding(p_guardian_id,p_child_id);
  IF binding IS NULL THEN RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_child_id AND mode='live' FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'RECIPIENT_RESTART_NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  SELECT * INTO previous FROM payment_private.recipient_setup_restarts WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF previous.recipient_id<>r.id OR previous.child_id<>p_child_id OR previous.actor_id<>p_actor_id
      OR previous.guardian_id<>p_guardian_id OR previous.old_account_ref<>p_expected_account_ref
      OR previous.old_generation<>p_expected_generation OR previous.new_minor_binding IS DISTINCT FROM binding
      OR r.minor_binding IS DISTINCT FROM binding OR r.generation<previous.new_generation THEN
      RAISE EXCEPTION 'RECIPIENT_RESTART_CONFLICT' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('ok',true,'unchanged',true,'childId',p_child_id,'guardianId',p_guardian_id,'generation',r.generation);
  END IF;
  IF p_stripe_checked_at<now()-interval '60 seconds' OR p_stripe_checked_at>now()+interval '5 seconds' THEN
    RAISE EXCEPTION 'RECIPIENT_RESTART_PROOF_EXPIRED' USING ERRCODE='42501'; END IF;
  IF r.account_ref IS DISTINCT FROM p_expected_account_ref OR r.generation<>p_expected_generation
    OR NOT payment_private.recipient_setup_restartable(r.id,p_guardian_id) THEN
    RAISE EXCEPTION 'RECIPIENT_RESTART_NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  INSERT INTO payment_private.recipient_setup_restarts(operation_id,recipient_id,child_id,actor_id,guardian_id,
    old_account_ref,old_generation,new_generation,old_minor_binding,new_minor_binding,stripe_checked_at)
  VALUES(p_operation_id,r.id,p_child_id,p_actor_id,p_guardian_id,r.account_ref,r.generation,r.generation+1,r.minor_binding,binding,p_stripe_checked_at);
  UPDATE payment_private.recipients SET minor_binding=binding,account_ref=NULL,claim_operation=p_operation_id,
    claim_expires_at=now()+interval '2 minutes',generation=r.generation+1,status='onboarding',requirement_count=0,
    has_payout_method=false,details_submitted=false,transfers_active=false,payouts_enabled=false,verified_at=NULL,
    guardian_person_ref=NULL,guardian_tos_accepted_at=NULL,guardian_reason='guardian_kyc_required',updated_at=now()
    WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'unchanged',false,'childId',p_child_id,'guardianId',p_guardian_id,'generation',r.generation+1);
END; $$;

CREATE FUNCTION public.pay_recipient_minor_setup_context(p_actor_id uuid,p_child_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.minor_setup_context(p_actor_id,p_child_id); $$;
CREATE FUNCTION public.pay_recipient_minor_claim(p_child_id uuid,p_guardian_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.minor_recipient_claim(p_child_id,p_guardian_id,p_operation_id); $$;
CREATE FUNCTION public.pay_recipient_restart_setup(p_actor_id uuid,p_child_id uuid,p_guardian_id uuid,p_expected_account_ref text,p_expected_generation bigint,
  p_operation_id uuid,p_verified_empty boolean,p_stripe_checked_at timestamptz) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.restart_minor_setup(p_actor_id,p_child_id,p_guardian_id,p_expected_account_ref,p_expected_generation,
  p_operation_id,p_verified_empty,p_stripe_checked_at); $$;

REVOKE ALL ON FUNCTION payment_private.recipient_setup_restartable(uuid,uuid),payment_private.minor_setup_context(uuid,uuid),
  payment_private.minor_recipient_claim(uuid,uuid,uuid),payment_private.restart_minor_setup(uuid,uuid,uuid,text,bigint,uuid,boolean,timestamptz),
  public.pay_recipient_minor_setup_context(uuid,uuid),public.pay_recipient_minor_claim(uuid,uuid,uuid),
  public.pay_recipient_restart_setup(uuid,uuid,uuid,text,bigint,uuid,boolean,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.minor_setup_context(uuid,uuid),payment_private.minor_recipient_claim(uuid,uuid,uuid),
  payment_private.restart_minor_setup(uuid,uuid,uuid,text,bigint,uuid,boolean,timestamptz),public.pay_recipient_minor_setup_context(uuid,uuid),
  public.pay_recipient_minor_claim(uuid,uuid,uuid),public.pay_recipient_restart_setup(uuid,uuid,uuid,text,bigint,uuid,boolean,timestamptz) TO service_role;

-- A conflict is a stale or differently bound setup, not a request to re-enter
-- the parent's identity. Do not offer an inherently failing sync action.
DO $migration$
DECLARE source text; changed text;
BEGIN
  source:=pg_get_functiondef('payment_private.guardian_recipient_context(uuid)'::regprocedure);
  changed:=replace(source,'''canStartPayout'',EXISTS(',
    '''canRestartPayout'',COALESCE(payment_private.recipient_setup_restartable(r.id,p_guardian_id),false),''canStartPayout'',EXISTS(');
  IF changed=source THEN RAISE EXCEPTION 'Expected guardian setup projection was not found'; END IF;
  source:=changed;
  changed:=replace(source,'r.minor_binding IS DISTINCT FROM b.binding THEN ''guardian_identity_mismatch''',
    'r.minor_binding IS DISTINCT FROM b.binding THEN ''recipient_guardian_binding_conflict''');
  IF changed=source THEN RAISE EXCEPTION 'Expected guardian binding conflict was not found'; END IF;
  EXECUTE changed;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
