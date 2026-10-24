BEGIN;

-- Installation is inert. Only a separately verified, explicit local CLI call
-- enables the sandbox and enrolls exact synthetic provider/adult-recipient IDs.
CREATE FUNCTION payment_private.sandbox_synthetic(p_user_id uuid,p_role text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE valid boolean;
BEGIN
  IF p_role IS NULL OR p_role NOT IN('provider','recipient')
    OR to_regclass('demo_private.visits') IS NULL OR to_regclass('demo_private.personas') IS NULL
    OR to_regclass('auth.users') IS NULL THEN RETURN false; END IF;
  EXECUTE $query$
    SELECT EXISTS(SELECT FROM public.profiles p
      JOIN demo_private.personas persona ON persona.user_id=p.id
      JOIN demo_private.visits visit ON visit.id=persona.visit_id
      JOIN auth.users account ON account.id=p.id
      WHERE p.id=$1 AND p.country='DE' AND p.birthdate IS NOT NULL
        AND p.birthdate<=(current_date-interval '18 years')::date
        AND visit.seeded_at IS NOT NULL AND visit.revoked_at IS NULL AND visit.expires_at>statement_timestamp()
        AND account.raw_app_meta_data->>'demo_session_id'=visit.id::text
        AND account.raw_app_meta_data->>'demo_identity'=persona.persona
        AND lower(account.email)='demo+'||visit.id::text||'.'||persona.persona||'@example.test'
        AND lower(p.email)=lower(account.email)
        AND (($2='provider' AND p.account_type='job_provider' AND persona.persona IN('private-provider','company'))
          OR ($2='recipient' AND p.account_type='job_seeker' AND persona.persona IN('seeker','peer-seeker')
            AND p.birthdate>(current_date-interval '21 years')::date)))
  $query$ INTO valid USING p_user_id,p_role;
  RETURN COALESCE(valid,false);
END; $$;

CREATE FUNCTION payment_private.enroll_sandbox_preview(p_user_id uuid,p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode='sandbox')
    OR NOT payment_private.sandbox_synthetic(p_user_id,p_role) THEN
    RAISE EXCEPTION 'PAYMENT_SANDBOX_PREVIEW_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_role='provider' THEN
    INSERT INTO payment_private.rollout_cohort(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  ELSIF p_role='recipient' AND EXISTS(SELECT FROM payment_private.recipient_configuration WHERE sandbox_adult_enabled) THEN
    INSERT INTO payment_private.recipient_cohort(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  ELSE RAISE EXCEPTION 'RECIPIENT_MODEL_NOT_APPROVED' USING ERRCODE='42501'; END IF;
END; $$;

CREATE FUNCTION payment_private.assert_sandbox_preview(p_user_id uuid,p_role text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode='sandbox')
    OR NOT payment_private.sandbox_synthetic(p_user_id,p_role)
    OR (p_role='provider' AND NOT EXISTS(SELECT FROM payment_private.rollout_cohort WHERE user_id=p_user_id))
    OR (p_role='recipient' AND (NOT EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p_user_id)
      OR NOT EXISTS(SELECT FROM payment_private.recipient_configuration WHERE sandbox_adult_enabled))) THEN
    RAISE EXCEPTION 'PAYMENT_SANDBOX_PREVIEW_REQUIRED' USING ERRCODE='42501';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.assert_mode(p_mode text,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN('local_simulation','sandbox') OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode) THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT FROM public.profiles WHERE id=p_user_id AND account_type='job_provider') THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_mode='sandbox' THEN PERFORM payment_private.assert_sandbox_preview(p_user_id,'provider'); END IF;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.assert_recipient(p_user_id uuid,p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN('local_simulation','sandbox') OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode=p_mode) THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND OR p.account_type<>'job_seeker' THEN RAISE EXCEPTION 'RECIPIENT_SEEKER_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_mode='local_simulation' THEN
    IF NOT payment_private.recipient_synthetic(p_user_id) OR NOT EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p_user_id) THEN
      RAISE EXCEPTION 'RECIPIENT_LOCAL_DEMO_REQUIRED' USING ERRCODE='42501';
    END IF;
  ELSE
    IF p.country IS DISTINCT FROM 'DE' OR p.birthdate IS NULL OR p.birthdate>(current_date-interval '18 years')::date THEN
      RAISE EXCEPTION 'RECIPIENT_MODEL_NOT_APPROVED' USING ERRCODE='42501';
    END IF;
    PERFORM payment_private.assert_sandbox_preview(p_user_id,'recipient');
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION payment_private.recipient_ready(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT FROM payment_private.recipients r JOIN payment_private.configuration c ON c.mode=r.mode
    JOIN public.profiles p ON p.id=r.user_id CROSS JOIN payment_private.recipient_configuration rc
    WHERE r.user_id=p_user_id AND p.account_type='job_seeker' AND r.status='ready' AND r.account_ref IS NOT NULL
      AND r.requirement_count=0 AND r.has_payout_method AND r.details_submitted AND r.transfers_active AND r.payouts_enabled AND r.verified_at IS NOT NULL
      AND ((r.mode='local_simulation' AND payment_private.recipient_synthetic(r.user_id) AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=r.user_id))
        OR (r.mode='sandbox' AND rc.sandbox_adult_enabled AND p.country='DE'
          AND payment_private.sandbox_synthetic(r.user_id,'recipient') AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=r.user_id)
          AND r.verified_at>now()-interval '24 hours')));
$$;

CREATE OR REPLACE FUNCTION payment_private.recipient_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; c payment_private.configuration%ROWTYPE; rc payment_private.recipient_configuration%ROWTYPE;
  r payment_private.recipients%ROWTYPE; eligible text; can_start boolean; active boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
  SELECT * INTO c FROM payment_private.configuration;
  SELECT * INTO rc FROM payment_private.recipient_configuration;
  SELECT * INTO r FROM payment_private.recipients WHERE user_id=auth.uid() AND mode=c.mode;
  eligible:=CASE WHEN p.account_type IS DISTINCT FROM 'job_seeker' THEN 'ineligible'
    WHEN c.mode='local_simulation' AND payment_private.recipient_synthetic(p.id) THEN 'local_demo'
    WHEN p.birthdate IS NULL OR p.birthdate>(current_date-interval '18 years')::date THEN 'minor_review_required'
    ELSE 'adult' END;
  can_start:=CASE c.mode WHEN 'local_simulation' THEN eligible='local_demo' AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p.id)
    WHEN 'sandbox' THEN eligible='adult' AND rc.sandbox_adult_enabled AND payment_private.sandbox_synthetic(p.id,'recipient')
      AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p.id) ELSE false END;
  active:=payment_private.recipient_ready(auth.uid());
  RETURN jsonb_build_object('kind',CASE c.mode WHEN 'local_simulation' THEN 'local' WHEN 'sandbox' THEN 'sandbox' ELSE 'disabled' END,
    'featureEnabled',c.mode<>'disabled' AND rc.application_gate_enabled AND EXISTS(SELECT FROM payment_private.recipient_cohort WHERE user_id=p.id),
    'status',CASE WHEN r.id IS NULL THEN 'not_started' WHEN r.status='ready' AND NOT active THEN 'pending' ELSE r.status END,
    'canStart',can_start,'eligibility',eligible,'requirementCount',COALESCE(r.requirement_count,0),
    'hasPayoutMethod',COALESCE(r.has_payout_method,false),'detailsSubmitted',COALESCE(r.details_submitted,false),
    'transfersActive',COALESCE(r.transfers_active,false),'payoutsEnabled',COALESCE(r.payouts_enabled,false),'checkedAt',r.verified_at);
END; $$;

CREATE FUNCTION public.pay_enroll_sandbox_preview(p_user_id uuid,p_role text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.enroll_sandbox_preview(p_user_id,p_role); $$;
CREATE FUNCTION public.pay_assert_sandbox_preview(p_user_id uuid,p_role text)
RETURNS void LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.assert_sandbox_preview(p_user_id,p_role); $$;

REVOKE ALL ON FUNCTION payment_private.sandbox_synthetic(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION payment_private.enroll_sandbox_preview(uuid,text),payment_private.assert_sandbox_preview(uuid,text),public.pay_enroll_sandbox_preview(uuid,text),public.pay_assert_sandbox_preview(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.enroll_sandbox_preview(uuid,text),payment_private.assert_sandbox_preview(uuid,text),public.pay_enroll_sandbox_preview(uuid,text),public.pay_assert_sandbox_preview(uuid,text) TO service_role;

COMMIT;
