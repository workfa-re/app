BEGIN;

-- Contact email can change on the same verified Workfare account. Preserve the
-- historical signed email only when an existing, actually accepted Stripe
-- representative agreement proves the exact same immutable family binding.
CREATE FUNCTION payment_private.guardian_contact_binding_proven(p_guardian_id uuid,p_child_id uuid,p_consent_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
   SELECT FROM payment_private.recipients recipient
   JOIN public.profiles child ON child.id=recipient.user_id
   JOIN public.profiles parent ON parent.id=p_guardian_id
   JOIN public.guardian_relationships family ON family.child_id=child.id AND family.guardian_id=parent.id
   JOIN public.guardian_consents consent ON consent.child_id=child.id AND consent.linked_guardian_id=parent.id
   JOIN payment_private.guardian_pay_acceptances accepted ON accepted.recipient_id=recipient.id
     AND accepted.account_ref=recipient.account_ref AND accepted.child_id=child.id AND accepted.guardian_id=parent.id
     AND accepted.consent_id=consent.id AND accepted.declaration_version='workfare-pay-guardian-2026-10-24-v1'
     AND date_trunc('second',accepted.accepted_at)=date_trunc('second',recipient.guardian_tos_accepted_at)
   WHERE child.id=p_child_id AND parent.id<>child.id AND consent.id=p_consent_id
     AND recipient.mode='live' AND recipient.livemode AND recipient.account_ref IS NOT NULL
     AND recipient.guardian_person_ref IS NOT NULL AND recipient.guardian_tos_accepted_at IS NOT NULL
     AND family.status='active' AND consent.status='approved' AND consent.revoked_at IS NULL
     AND consent.email_verified_at IS NOT NULL AND consent.signature_method='authenticated_email'
     AND consent.consent_scope='workfare_minor_jobs' AND consent.declaration_version='workfare-guardian-2026-10-24-v1'
     AND consent.signature_name=parent.full_name AND consent.parent_name=parent.full_name
     AND consent.affirmations @> '{"accepted":true,"adult_confirmed":true,"legal_authority":true}'::jsonb
     AND child.account_type='job_seeker' AND child.country='DE'
     AND child.birthdate<=(guardian_private.today()-interval '14 years')::date
     AND child.birthdate>(guardian_private.today()-interval '18 years')::date
     AND guardian_private.adult_eligible(parent.id)
     AND payment_private.live_identity(parent.id) AND payment_private.live_identity(child.id)
     AND recipient.claim_birthdate=child.birthdate AND recipient.claim_display_name=child.full_name
     AND recipient.minor_binding=jsonb_build_object('guardianId',parent.id,'consentId',consent.id,
       'childBirthdate',child.birthdate,'guardianBirthdate',parent.birthdate,
       'guardianEmail',lower(consent.parent_email),'guardianName',parent.full_name)
 );
$$;
REVOKE ALL ON FUNCTION payment_private.guardian_contact_binding_proven(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION payment_private.current_minor_binding(p_guardian_id uuid,p_child_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('guardianId',g.id,'consentId',c.id,'childBirthdate',child.birthdate,
   'guardianBirthdate',g.birthdate,'guardianEmail',lower(c.parent_email),'guardianName',g.full_name)
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
   AND c.parent_name=g.full_name
   AND (lower(c.parent_email)=lower(u.email)
     OR payment_private.guardian_contact_binding_proven(g.id,child.id,c.id))
   AND c.affirmations @> '{"accepted":true,"adult_confirmed":true,"legal_authority":true}'::jsonb
 ORDER BY c.created_at DESC,c.id LIMIT 1;
$$;

CREATE FUNCTION payment_private.assert_account_email_change(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT payment_private.live_identity(p_user_id) THEN
   RAISE EXCEPTION 'RECIPIENT_VERIFIED_ACCOUNT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM payment_private.recipients recipient
   JOIN public.guardian_relationships family ON family.child_id=recipient.user_id
     AND family.guardian_id=p_user_id AND family.status='active'
   JOIN public.profiles child ON child.id=recipient.user_id
   WHERE recipient.mode='live' AND recipient.minor_binding->>'guardianId'=p_user_id::text
     AND child.birthdate>(guardian_private.today()-interval '18 years')::date
     AND NOT EXISTS(SELECT FROM public.guardian_consents consent
       WHERE consent.child_id=child.id AND consent.linked_guardian_id=p_user_id
         AND consent.id::text=recipient.minor_binding->>'consentId'
         AND payment_private.guardian_contact_binding_proven(p_user_id,child.id,consent.id))) THEN
   RAISE EXCEPTION 'RECIPIENT_GUARDIAN_EMAIL_CHANGE_REQUIRES_REVIEW' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('allowed',true);
END; $$;
CREATE FUNCTION public.pay_assert_account_email_change(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.assert_account_email_change(p_user_id); $$;
REVOKE ALL ON FUNCTION payment_private.assert_account_email_change(uuid),public.pay_assert_account_email_change(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.assert_account_email_change(uuid),public.pay_assert_account_email_change(uuid) TO service_role;

-- Supabase confirms an email change later than the browser's preflight. Recheck
-- under the existing child locks at that actual Auth update, so a recipient
-- claim cannot create a newly broken binding between those two steps.
CREATE FUNCTION payment_private.guard_guardian_contact_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF lower(OLD.email) IS DISTINCT FROM lower(NEW.email) THEN
   PERFORM 1 FROM public.profiles child JOIN public.guardian_relationships family ON family.child_id=child.id
     WHERE family.guardian_id=OLD.id AND family.status='active'
     ORDER BY child.id FOR UPDATE OF child;
   IF EXISTS(SELECT FROM public.guardian_relationships family
     JOIN payment_private.recipients recipient ON recipient.user_id=family.child_id AND recipient.mode='live'
     JOIN public.profiles child ON child.id=family.child_id
     WHERE family.guardian_id=OLD.id AND family.status='active'
       AND recipient.minor_binding->>'guardianId'=OLD.id::text
       AND child.birthdate>(guardian_private.today()-interval '18 years')::date) THEN
     PERFORM payment_private.assert_account_email_change(OLD.id);
   END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION payment_private.guard_guardian_contact_email() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER workfare_guardian_contact_email BEFORE UPDATE OF email ON auth.users
 FOR EACH ROW EXECUTE FUNCTION payment_private.guard_guardian_contact_email();

-- Parent-only aggregate projection. No private chat, job location, invoice,
-- provider, PaymentIntent, bank account or raw agreement data leaves this RPC.
CREATE FUNCTION payment_private.guardian_recipient_earnings(p_guardian_id uuid,p_child_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE total bigint;
BEGIN
 IF NOT EXISTS(SELECT FROM payment_private.configuration WHERE mode='live') THEN
   RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501'; END IF;
 PERFORM payment_private.guardian_recipient_get(p_guardian_id,p_child_id);
 SELECT COALESCE(sum(earnings_cents::bigint),0) INTO total FROM payment_private.orders
   WHERE recipient_id=p_child_id AND mode='live' AND state='paid' AND refunded_cents=0;
 RETURN jsonb_build_object('ownerId',p_guardian_id,'childId',p_child_id,'currency','eur','confirmedCents',total);
END; $$;
CREATE FUNCTION public.pay_guardian_recipient_earnings(p_guardian_id uuid,p_child_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT payment_private.guardian_recipient_earnings(p_guardian_id,p_child_id); $$;
REVOKE ALL ON FUNCTION payment_private.guardian_recipient_earnings(uuid,uuid),public.pay_guardian_recipient_earnings(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.guardian_recipient_earnings(uuid,uuid),public.pay_guardian_recipient_earnings(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
