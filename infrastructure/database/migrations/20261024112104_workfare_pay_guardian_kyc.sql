BEGIN;

-- A parent may start a real youth-owned Stripe account. This records the
-- actual participants; it never grants a country model or fabricates Stripe
-- identity/terms evidence. Installation changes no existing recipient row.
ALTER TABLE payment_private.recipients ADD COLUMN claim_birthdate date,
  ADD COLUMN minor_binding jsonb,
  ADD COLUMN guardian_person_ref text,
  ADD COLUMN guardian_tos_accepted_at timestamptz,
  ADD COLUMN guardian_reason text CHECK(guardian_reason IS NULL OR guardian_reason IN(
    'guardian_kyc_required','guardian_identity_mismatch','guardian_terms_required',
    'recipient_country_model_unsupported','recipient_setup_required')),
  ADD CONSTRAINT recipient_minor_binding_shape CHECK(minor_binding IS NULL OR (
    mode='live' AND jsonb_typeof(minor_binding)='object'
    AND minor_binding ?& ARRAY['guardianId','consentId','childBirthdate','guardianBirthdate','guardianEmail','guardianName']
    AND (minor_binding-ARRAY['guardianId','consentId','childBirthdate','guardianBirthdate','guardianEmail','guardianName'])='{}'::jsonb
    AND jsonb_typeof(minor_binding->'guardianId')='string' AND jsonb_typeof(minor_binding->'consentId')='string'
    AND jsonb_typeof(minor_binding->'childBirthdate')='string' AND jsonb_typeof(minor_binding->'guardianBirthdate')='string'
    AND jsonb_typeof(minor_binding->'guardianEmail')='string' AND jsonb_typeof(minor_binding->'guardianName')='string'
    AND minor_binding->>'guardianId' ~ '^[0-9a-f-]{36}$' AND minor_binding->>'consentId' ~ '^[0-9a-f-]{36}$'
    AND minor_binding->>'childBirthdate' ~ '^\d{4}-\d{2}-\d{2}$' AND minor_binding->>'guardianBirthdate' ~ '^\d{4}-\d{2}-\d{2}$'
    AND char_length(minor_binding->>'guardianEmail') BETWEEN 3 AND 254
    AND char_length(minor_binding->>'guardianName') BETWEEN 3 AND 120)),
  ADD CONSTRAINT recipient_guardian_evidence_shape CHECK(
    (guardian_person_ref IS NULL AND guardian_tos_accepted_at IS NULL)
    OR (minor_binding IS NOT NULL AND guardian_person_ref ~ '^person_[a-zA-Z0-9]+$' AND guardian_tos_accepted_at IS NOT NULL));

CREATE FUNCTION payment_private.current_minor_binding(p_guardian_id uuid,p_child_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('guardianId',g.id,'consentId',c.id,'childBirthdate',child.birthdate,
   'guardianBirthdate',g.birthdate,'guardianEmail',lower(u.email),'guardianName',g.full_name)
 FROM public.profiles child JOIN public.guardian_relationships r ON r.child_id=child.id
 JOIN public.profiles g ON g.id=r.guardian_id JOIN auth.users u ON u.id=g.id
 JOIN public.guardian_consents c ON c.child_id=child.id AND c.linked_guardian_id=g.id
 WHERE child.id=p_child_id AND g.id=p_guardian_id AND child.id<>g.id
   AND child.account_type='job_seeker' AND child.country='DE'
   AND child.birthdate<=(guardian_private.today()-interval '14 years')::date
   AND child.birthdate>(guardian_private.today()-interval '18 years')::date
   AND r.status='active' AND guardian_private.adult_eligible(g.id)
   AND payment_private.live_identity(child.id) AND payment_private.live_identity(g.id)
   AND c.status='approved' AND c.revoked_at IS NULL AND c.email_verified_at IS NOT NULL
   AND c.consent_scope='workfare_minor_jobs' AND c.declaration_version='workfare-guardian-2026-10-24-v1'
   AND c.signature_method='authenticated_email' AND c.signature_name=g.full_name
   AND c.parent_name=g.full_name AND lower(c.parent_email)=lower(u.email)
   AND c.affirmations @> '{"accepted":true,"adult_confirmed":true,"legal_authority":true}'::jsonb
 ORDER BY c.created_at DESC,c.id LIMIT 1;
$$;

CREATE FUNCTION payment_private.minor_binding_current(p_child_id uuid,p_binding jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_binding IS NOT NULL AND EXISTS(SELECT FROM public.profiles g
   WHERE g.id::text=p_binding->>'guardianId'
     AND payment_private.current_minor_binding(g.id,p_child_id)=p_binding);
$$;

CREATE FUNCTION payment_private.preserve_minor_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.minor_binding IS DISTINCT FROM NEW.minor_binding OR OLD.claim_birthdate IS DISTINCT FROM NEW.claim_birthdate
   OR (OLD.mode='live' AND OLD.claim_display_name IS DISTINCT FROM NEW.claim_display_name)
   OR (OLD.minor_binding IS NOT NULL AND (OLD.claim_contact_email IS DISTINCT FROM NEW.claim_contact_email
      OR OLD.claim_display_name IS DISTINCT FROM NEW.claim_display_name)) THEN
   RAISE EXCEPTION 'RECIPIENT_BINDING_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER recipient_preserve_minor_binding BEFORE UPDATE ON payment_private.recipients
 FOR EACH ROW EXECUTE FUNCTION payment_private.preserve_minor_binding();

-- Preserve the independently guarded adult/local/sandbox implementation.
ALTER FUNCTION payment_private.assert_recipient(uuid,text) RENAME TO assert_recipient_adult_core;
CREATE FUNCTION payment_private.assert_recipient(p_user_id uuid,p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; binding jsonb;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF p_mode='live' AND p.account_type='job_seeker'
   AND p.birthdate<=(guardian_private.today()-interval '14 years')::date
   AND p.birthdate>(guardian_private.today()-interval '18 years')::date THEN
   IF NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode='live')
     OR NOT EXISTS(SELECT FROM payment_private.live_configuration WHERE enabled AND recipient_setup_enabled) THEN
     RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501'; END IF;
   SELECT minor_binding INTO binding FROM payment_private.recipients WHERE user_id=p_user_id AND mode='live';
   IF NOT payment_private.minor_binding_current(p_user_id,binding) THEN
     RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
   RETURN;
 END IF;
 PERFORM payment_private.assert_recipient_adult_core(p_user_id,p_mode);
END; $$;

CREATE OR REPLACE FUNCTION payment_private.recipient_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'userId',r.user_id,'mode',r.mode,'accountRef',r.account_ref,'generation',r.generation,'birthdate',r.claim_birthdate,'displayName',r.claim_display_name,
   'minorBinding',r.minor_binding,'guardianReason',r.guardian_reason)
 FROM payment_private.recipients r WHERE r.id=p_id;
$$;

CREATE OR REPLACE FUNCTION payment_private.recipient_claim(p_user_id uuid,p_mode text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; claimed boolean; email text; display_name text; birthdate date;
BEGIN
 PERFORM payment_private.assert_recipient(p_user_id,p_mode);
 IF p_mode='live' THEN
   SELECT u.email,p.full_name,p.birthdate INTO email,display_name,birthdate
     FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=p_user_id;
 END IF;
 INSERT INTO payment_private.recipients(user_id,mode,claim_operation,livemode,claim_contact_email,claim_display_name,claim_birthdate)
   VALUES(p_user_id,p_mode,p_operation_id,p_mode='live',email,display_name,birthdate) ON CONFLICT(user_id,mode) DO NOTHING;
 SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode=p_mode FOR UPDATE;
 claimed:=r.account_ref IS NULL AND (r.claim_operation=p_operation_id OR r.claim_expires_at<=now());
 IF claimed THEN UPDATE payment_private.recipients SET claim_operation=p_operation_id,claim_expires_at=now()+interval '2 minutes' WHERE id=r.id; END IF;
 RETURN jsonb_build_object('claimed',claimed,'accountRef',r.account_ref)
   || CASE WHEN p_mode='live' THEN jsonb_build_object('prefill',jsonb_strip_nulls(jsonb_build_object('contactEmail',r.claim_contact_email,'displayName',r.claim_display_name))) ELSE '{}'::jsonb END;
END; $$;

CREATE FUNCTION payment_private.guardian_recipient_context(p_guardian_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE children jsonb;
BEGIN
 IF p_guardian_id IS NULL OR NOT payment_private.live_identity(p_guardian_id)
   OR NOT guardian_private.adult_eligible(p_guardian_id) THEN
   RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode='live') THEN
   RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('childId',child.id,'name',child.full_name,
   'status',CASE WHEN r.id IS NULL THEN 'not_started' WHEN r.status='ready' AND NOT payment_private.recipient_ready(child.id) THEN 'pending' ELSE r.status END,
   'canStartPayout',EXISTS(SELECT FROM payment_private.live_configuration WHERE enabled AND recipient_setup_enabled)
     AND (r.id IS NULL OR (r.minor_binding=b.binding AND payment_private.minor_binding_current(child.id,r.minor_binding))),
   'reasonCode',CASE WHEN r.id IS NOT NULL AND r.minor_binding IS DISTINCT FROM b.binding THEN 'guardian_identity_mismatch'
     WHEN NOT EXISTS(SELECT FROM payment_private.live_configuration WHERE enabled AND recipient_setup_enabled) THEN 'recipient_setup_required'
     WHEN payment_private.recipient_ready(child.id) THEN NULL
     ELSE COALESCE(r.guardian_reason,CASE WHEN r.guardian_person_ref IS NULL THEN 'guardian_kyc_required' ELSE 'recipient_setup_required' END) END)
   ORDER BY child.full_name,child.id),'[]'::jsonb) INTO children
 FROM public.guardian_relationships family JOIN public.profiles child ON child.id=family.child_id
 CROSS JOIN LATERAL(SELECT payment_private.current_minor_binding(p_guardian_id,child.id) AS binding) b
 LEFT JOIN payment_private.recipients r ON r.user_id=child.id AND r.mode='live'
 WHERE family.guardian_id=p_guardian_id AND family.status='active' AND b.binding IS NOT NULL;
 RETURN jsonb_build_object('ownerId',p_guardian_id,'kind','live','children',children);
END; $$;

CREATE FUNCTION payment_private.guardian_recipient_claim(p_guardian_id uuid,p_child_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE binding jsonb; r payment_private.recipients%ROWTYPE; claimed boolean; email text; display_name text; birthdate date;
BEGIN
 IF p_operation_id IS NULL OR NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode='live')
   OR NOT EXISTS(SELECT FROM payment_private.live_configuration WHERE enabled AND recipient_setup_enabled) THEN
   RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501'; END IF;
 -- Consent/revoke/reservation share the child lock. The first valid claim
 -- freezes the actual child and actual consenting adult, not an adult account.
 PERFORM 1 FROM public.profiles WHERE id=p_child_id FOR UPDATE;
 binding:=payment_private.current_minor_binding(p_guardian_id,p_child_id);
 IF binding IS NULL THEN RAISE EXCEPTION 'RECIPIENT_GUARDIAN_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT u.email,p.full_name,p.birthdate INTO email,display_name,birthdate FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=p_child_id;
 INSERT INTO payment_private.recipients(user_id,mode,claim_operation,livemode,claim_contact_email,claim_display_name,claim_birthdate,minor_binding,guardian_reason)
 VALUES(p_child_id,'live',p_operation_id,true,email,display_name,birthdate,binding,'guardian_kyc_required') ON CONFLICT(user_id,mode) DO NOTHING;
 SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_child_id AND mode='live' FOR UPDATE;
 IF r.minor_binding IS DISTINCT FROM binding THEN RAISE EXCEPTION 'RECIPIENT_GUARDIAN_BINDING_MISMATCH' USING ERRCODE='42501'; END IF;
 claimed:=r.account_ref IS NULL AND (r.claim_operation=p_operation_id OR r.claim_expires_at<=now());
 IF claimed THEN UPDATE payment_private.recipients SET claim_operation=p_operation_id,claim_expires_at=now()+interval '2 minutes' WHERE id=r.id; END IF;
 RETURN jsonb_build_object('claimed',claimed,'accountRef',r.account_ref,'minorBinding',r.minor_binding,
   'prefill',jsonb_strip_nulls(jsonb_build_object('contactEmail',r.claim_contact_email,'displayName',r.claim_display_name)));
END; $$;

CREATE FUNCTION payment_private.guardian_recipient_get(p_guardian_id uuid,p_child_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; binding jsonb;
BEGIN
 binding:=payment_private.current_minor_binding(p_guardian_id,p_child_id);
 SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_child_id AND mode='live';
 IF binding IS NULL OR r.minor_binding IS DISTINCT FROM binding OR r.id IS NULL THEN
   RAISE EXCEPTION 'RECIPIENT_GUARDIAN_BINDING_MISMATCH' USING ERRCODE='42501'; END IF;
 RETURN payment_private.recipient_json(r.id);
END; $$;

ALTER FUNCTION payment_private.recipient_ready(uuid) RENAME TO recipient_ready_adult_core;
CREATE FUNCTION payment_private.recipient_ready(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (payment_private.recipient_ready_adult_core(p_user_id) AND NOT EXISTS(
   SELECT FROM payment_private.recipients adult JOIN public.profiles p ON p.id=adult.user_id
   JOIN payment_private.configuration c ON c.mode=adult.mode
   WHERE adult.user_id=p_user_id AND adult.mode='live' AND (adult.claim_birthdate IS NULL OR adult.claim_birthdate IS DISTINCT FROM p.birthdate))) OR EXISTS(
   SELECT FROM payment_private.recipients r JOIN public.profiles p ON p.id=r.user_id
   WHERE r.user_id=p_user_id AND r.mode='live' AND r.livemode AND r.minor_binding IS NOT NULL AND r.claim_birthdate=p.birthdate
     AND p.account_type='job_seeker' AND p.country='DE'
     AND p.birthdate<=(guardian_private.today()-interval '14 years')::date
     AND p.birthdate>(guardian_private.today()-interval '18 years')::date
     AND EXISTS(SELECT FROM payment_private.configuration WHERE mode='live')
     AND EXISTS(SELECT FROM payment_private.live_configuration WHERE enabled AND recipient_setup_enabled)
     AND payment_private.minor_binding_current(p_user_id,r.minor_binding)
     AND r.status='ready' AND r.account_ref IS NOT NULL AND r.requirement_count=0 AND r.has_payout_method
     AND r.details_submitted AND r.transfers_active AND r.payouts_enabled
     AND r.verified_at>now()-interval '24 hours' AND r.guardian_person_ref IS NOT NULL
     AND r.guardian_tos_accepted_at IS NOT NULL AND r.guardian_reason IS NULL);
$$;

ALTER FUNCTION payment_private.recipient_apply_sync(uuid,text,bigint,text,jsonb,boolean) RENAME TO recipient_apply_sync_core;
CREATE FUNCTION payment_private.recipient_apply_sync(p_user_id uuid,p_event_id text,p_generation bigint,p_account_ref text,p_state jsonb,p_livemode boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r payment_private.recipients%ROWTYPE; result jsonb; evidence jsonb; person text; accepted timestamptz; reason text;
BEGIN
 -- Keep the existing profile -> recipient lock order used by claim/revoke.
 PERFORM payment_private.assert_recipient(p_user_id,(SELECT mode FROM payment_private.configuration));
 SELECT * INTO r FROM payment_private.recipients WHERE user_id=p_user_id AND mode=(SELECT mode FROM payment_private.configuration) FOR UPDATE;
 IF r.minor_binding IS NOT NULL THEN
   evidence:=p_state->'guardianEvidence'; reason:=p_state->>'guardianReason';
   IF reason IS NOT NULL AND reason NOT IN('guardian_kyc_required','guardian_identity_mismatch','guardian_terms_required','recipient_country_model_unsupported','recipient_setup_required') THEN
     RAISE EXCEPTION 'RECIPIENT_INVALID_STATE' USING ERRCODE='22023'; END IF;
   IF evidence IS NOT NULL AND evidence<>'null'::jsonb THEN
     IF jsonb_typeof(evidence)<>'object' OR (evidence-ARRAY['personRef','tosAcceptedAt'])<>'{}'::jsonb
       OR NOT(evidence ?& ARRAY['personRef','tosAcceptedAt']) OR jsonb_typeof(evidence->'personRef')<>'string'
       OR jsonb_typeof(evidence->'tosAcceptedAt')<>'string' OR (evidence->>'personRef') !~ '^person_[a-zA-Z0-9]+$'
       OR (evidence->>'tosAcceptedAt') !~ '^\d{4}-\d{2}-\d{2}T' THEN
       RAISE EXCEPTION 'RECIPIENT_INVALID_GUARDIAN_EVIDENCE' USING ERRCODE='22023'; END IF;
     person:=evidence->>'personRef';
     BEGIN accepted:=(evidence->>'tosAcceptedAt')::timestamptz;
     EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'RECIPIENT_INVALID_GUARDIAN_EVIDENCE' USING ERRCODE='22023'; END;
     IF accepted<'2000-01-01'::timestamptz OR accepted>now()+interval '30 seconds' THEN
       RAISE EXCEPTION 'RECIPIENT_INVALID_GUARDIAN_EVIDENCE' USING ERRCODE='22023'; END IF;
   END IF;
   IF p_state->>'status'='ready' AND (person IS NULL OR accepted IS NULL OR reason IS NOT NULL
     OR NOT payment_private.minor_binding_current(p_user_id,r.minor_binding)) THEN
     RAISE EXCEPTION 'RECIPIENT_GUARDIAN_EVIDENCE_REQUIRED' USING ERRCODE='42501'; END IF;
   result:=payment_private.recipient_apply_sync_core(p_user_id,p_event_id,p_generation,p_account_ref,p_state-ARRAY['guardianEvidence','guardianReason'],p_livemode);
   IF (result->>'applied')::boolean THEN
     UPDATE payment_private.recipients SET guardian_person_ref=COALESCE(person,guardian_person_ref),
       guardian_tos_accepted_at=COALESCE(accepted,guardian_tos_accepted_at),guardian_reason=reason WHERE id=r.id;
   END IF;
   RETURN result;
 END IF;
 -- Adult/local callers retain the exact six-field state contract.
 RETURN payment_private.recipient_apply_sync_core(p_user_id,p_event_id,p_generation,p_account_ref,p_state,p_livemode);
END; $$;

CREATE FUNCTION public.pay_guardian_recipient_context(p_guardian_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.guardian_recipient_context(p_guardian_id); $$;
CREATE FUNCTION public.pay_guardian_recipient_claim(p_guardian_id uuid,p_child_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.guardian_recipient_claim(p_guardian_id,p_child_id,p_operation_id); $$;
CREATE FUNCTION public.pay_guardian_recipient_get(p_guardian_id uuid,p_child_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.guardian_recipient_get(p_guardian_id,p_child_id); $$;

REVOKE ALL ON FUNCTION payment_private.current_minor_binding(uuid,uuid),payment_private.minor_binding_current(uuid,jsonb),
 payment_private.preserve_minor_binding(),payment_private.assert_recipient(uuid,text),payment_private.recipient_ready(uuid),
 payment_private.recipient_apply_sync(uuid,text,bigint,text,jsonb,boolean),payment_private.guardian_recipient_context(uuid),
 payment_private.guardian_recipient_claim(uuid,uuid,uuid),payment_private.guardian_recipient_get(uuid,uuid),
 public.pay_guardian_recipient_context(uuid),public.pay_guardian_recipient_claim(uuid,uuid,uuid),public.pay_guardian_recipient_get(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.assert_recipient(uuid,text),payment_private.recipient_ready(uuid),
 payment_private.recipient_apply_sync(uuid,text,bigint,text,jsonb,boolean),payment_private.guardian_recipient_context(uuid),
 payment_private.guardian_recipient_claim(uuid,uuid,uuid),payment_private.guardian_recipient_get(uuid,uuid),
 public.pay_guardian_recipient_context(uuid),public.pay_guardian_recipient_claim(uuid,uuid,uuid),public.pay_guardian_recipient_get(uuid,uuid)
 TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
