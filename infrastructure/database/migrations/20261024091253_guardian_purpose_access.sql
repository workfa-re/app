BEGIN;

-- Authenticated, purpose-limited family access. No payment/KYC status is changed.
CREATE SCHEMA IF NOT EXISTS guardian_private;
REVOKE ALL ON SCHEMA guardian_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA guardian_private TO authenticated,service_role;

ALTER TABLE public.guardian_invitations ALTER COLUMN child_id DROP NOT NULL;
ALTER TABLE public.guardian_invitations ADD COLUMN inviter_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN direction text NOT NULL DEFAULT 'child_to_guardian'
    CHECK(direction IN('child_to_guardian','guardian_to_child'));
UPDATE public.guardian_invitations SET inviter_id=child_id WHERE inviter_id IS NULL;
CREATE INDEX guardian_invitation_owner_active ON public.guardian_invitations(inviter_id,direction,expires_at)
  WHERE status='active';
ALTER TABLE public.guardian_relationships ADD COLUMN consent_scope text NOT NULL DEFAULT 'legacy_family';
CREATE UNIQUE INDEX guardian_consent_current_once ON public.guardian_consents(child_id,linked_guardian_id,consent_scope)
  WHERE status='approved' AND declaration_version='workfare-guardian-2026-10-24-v1';

CREATE FUNCTION guardian_private.today() RETURNS date LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (statement_timestamp() AT TIME ZONE 'Europe/Berlin')::date;
$$;
CREATE FUNCTION guardian_private.in_scope(p_user uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE allowed boolean;
BEGIN
 IF to_regprocedure('demo_private.same_visit(uuid)') IS NOT NULL THEN
   EXECUTE 'SELECT demo_private.same_visit($1)' INTO allowed USING p_user;
   RETURN COALESCE(allowed,false);
 END IF;
 RETURN p_user IS NOT NULL;
END $$;
CREATE FUNCTION guardian_private.verified_user() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT guardian_private.in_scope(actor) OR NOT EXISTS(
   SELECT FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL AND nullif(email,'') IS NOT NULL
 ) THEN RAISE EXCEPTION 'GUARDIAN_AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION guardian_private.adult_eligible(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.id=p_user AND u.email_confirmed_at IS NOT NULL AND char_length(btrim(p.full_name)) BETWEEN 3 AND 120
   AND p.birthdate<= (guardian_private.today()-interval '18 years')::date
   AND p.birthdate>= (guardian_private.today()-interval '120 years')::date
   AND COALESCE(p.provider_kind::text,'private')<>'company');
$$;
CREATE FUNCTION guardian_private.child_eligible(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.profiles p WHERE p.id=p_user AND p.account_type::text='job_seeker'
  AND p.birthdate<=(guardian_private.today()-interval '14 years')::date
  AND p.birthdate>(guardian_private.today()-interval '21 years')::date);
$$;
CREATE FUNCTION guardian_private.needs_consent(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.profiles WHERE id=p_user
   AND birthdate>(guardian_private.today()-interval '18 years')::date);
$$;
CREATE FUNCTION guardian_private.relationship_approved(p_user uuid,p_guardian uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT guardian_private.in_scope(p_user) AND guardian_private.in_scope(p_guardian) AND EXISTS(
   SELECT FROM public.guardian_relationships r JOIN public.guardian_consents c
     ON c.child_id=r.child_id AND c.linked_guardian_id=r.guardian_id
   WHERE r.child_id=p_user AND r.guardian_id=p_guardian AND r.status='active' AND c.status='approved' AND c.revoked_at IS NULL
     AND c.email_verified_at IS NOT NULL AND guardian_private.adult_eligible(r.guardian_id)
     AND c.consent_scope IN('workfare_minor_jobs','jobbridge_basis_verification')
 );
$$;
CREATE FUNCTION guardian_private.has_valid_guardian(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.guardian_relationships r WHERE r.child_id=p_user AND r.status='active'
   AND guardian_private.relationship_approved(p_user,r.guardian_id));
$$;
CREATE FUNCTION guardian_private.can_apply(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT guardian_private.in_scope(p_user) AND guardian_private.child_eligible(p_user) AND (NOT guardian_private.needs_consent(p_user) OR guardian_private.has_valid_guardian(p_user));
$$;

-- Replace the old full-provider prerequisite without conferring a provider role.
CREATE OR REPLACE FUNCTION public.enforce_eligible_guardian_relationship() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 NEW.status:=COALESCE(NEW.status,'active');
 IF NEW.status IN('active','pending') AND (NEW.child_id IS NULL OR NEW.guardian_id IS NULL
   OR NEW.child_id=NEW.guardian_id OR NOT guardian_private.adult_eligible(NEW.guardian_id)
   OR NOT guardian_private.child_eligible(NEW.child_id)) THEN
   RAISE EXCEPTION 'Eligible distinct family participants required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.protect_active_guardian_eligibility() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT FROM public.guardian_relationships WHERE guardian_id=OLD.id AND status IN('active','pending'))
  AND (NEW.birthdate IS NULL OR NEW.birthdate>(guardian_private.today()-interval '18 years')::date
    OR NEW.birthdate<(guardian_private.today()-interval '120 years')::date
    OR nullif(btrim(NEW.full_name),'') IS NULL OR COALESCE(NEW.provider_kind::text,'private')='company') THEN
  RAISE EXCEPTION 'An active guardian must remain an adult individual' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guardian_private.complete_profile(p_name text,p_birthdate date,p_adult_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); p public.profiles%ROWTYPE; n text:=btrim(p_name);
BEGIN
 IF p_adult_confirmed IS DISTINCT FROM true OR char_length(n) NOT BETWEEN 3 AND 120
    OR n !~ '[[:alpha:]]' OR n ~ '[[:cntrl:]]' OR p_birthdate IS NULL
    OR p_birthdate>(guardian_private.today()-interval '18 years')::date
    OR p_birthdate<(guardian_private.today()-interval '120 years')::date THEN
  RETURN jsonb_build_object('ok',false,'code','guardian_must_be_adult');
 END IF;
 SELECT * INTO p FROM public.profiles WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','profile_unavailable'); END IF;
 IF p.provider_kind::text='company' THEN RETURN jsonb_build_object('ok',false,'code','guardian_account_ineligible'); END IF;
 IF p.birthdate IS NOT NULL AND p.birthdate IS DISTINCT FROM p_birthdate THEN
  RETURN jsonb_build_object('ok',false,'code','birthdate_mismatch');
 END IF;
 UPDATE public.profiles SET full_name=n,birthdate=p_birthdate,updated_at=now() WHERE id=actor;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION guardian_private.create_invitation(p_direction text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); existing public.guardian_invitations%ROWTYPE;
 raw_token text; expires timestamptz:=now()+interval '48 hours';
BEGIN
 IF p_direction NOT IN('child_to_guardian','guardian_to_child') THEN
   RETURN jsonb_build_object('error','invalid_direction'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=actor FOR UPDATE;
 IF (p_direction='child_to_guardian' AND NOT guardian_private.child_eligible(actor)) OR
    (p_direction='guardian_to_child' AND NOT guardian_private.adult_eligible(actor)) THEN
   RETURN jsonb_build_object('error','inviter_ineligible'); END IF;
 -- Serialize retries on the creator. Reuse exactly their own short-lived link.
 UPDATE public.guardian_invitations SET status='expired',updated_at=now()
  WHERE inviter_id=actor AND status='active' AND expires_at<=now();
 SELECT * INTO existing FROM public.guardian_invitations
 WHERE inviter_id=actor AND direction=p_direction AND status='active' AND purpose='guardian_account_link'
   AND expires_at>now() ORDER BY created_at DESC,id LIMIT 1;
 IF FOUND AND existing.expires_at<=now()+interval '48 hours' THEN
  RETURN jsonb_build_object('token',existing.token,'expires_at',existing.expires_at,'reused',true,'direction',p_direction);
 END IF;
 UPDATE public.guardian_invitations SET status='revoked',updated_at=now()
  WHERE inviter_id=actor AND direction=p_direction AND status='active';
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO public.guardian_invitations(child_id,inviter_id,direction,token,expires_at,purpose)
 VALUES(CASE WHEN p_direction='child_to_guardian' THEN actor ELSE NULL END,actor,p_direction,raw_token,expires,'guardian_account_link');
 RETURN jsonb_build_object('token',raw_token,'expires_at',expires,'reused',false,'direction',p_direction);
END $$;

CREATE FUNCTION guardian_private.approve(p_child uuid,p_accepted boolean,p_version text,p_relationship text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); child public.profiles%ROWTYPE;
 guardian public.profiles%ROWTYPE; email text; email_confirmed timestamptz; minor boolean; consent_id uuid;
BEGIN
 IF p_accepted IS DISTINCT FROM true OR p_version IS DISTINCT FROM 'workfare-guardian-2026-10-24-v1'
   OR p_relationship NOT IN('mother','father','legal_guardian') THEN
  RETURN jsonb_build_object('success',false,'error','explicit_consent_required'); END IF;
 IF actor=p_child THEN RETURN jsonb_build_object('success',false,'error','self_link_not_allowed'); END IF;
 IF NOT guardian_private.in_scope(p_child) OR NOT guardian_private.adult_eligible(actor) THEN
  RETURN jsonb_build_object('success',false,'error','guardian_profile_ineligible'); END IF;
 SELECT * INTO child FROM public.profiles WHERE id=p_child FOR UPDATE;
 IF NOT guardian_private.child_eligible(p_child) OR NOT EXISTS(SELECT FROM public.guardian_relationships
   WHERE child_id=p_child AND guardian_id=actor AND status IN('pending','active')) THEN
  RETURN jsonb_build_object('success',false,'error','relationship_unavailable'); END IF;
 SELECT * INTO guardian FROM public.profiles WHERE id=actor;
 SELECT u.email,u.email_confirmed_at INTO email,email_confirmed FROM auth.users u
  WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','authentication_required'); END IF;
 minor:=guardian_private.needs_consent(p_child);
 IF minor THEN
  SELECT id INTO consent_id FROM public.guardian_consents WHERE child_id=p_child AND linked_guardian_id=actor
    AND consent_scope='workfare_minor_jobs' AND status='approved' AND revoked_at IS NULL
    AND declaration_version=p_version LIMIT 1;
  IF consent_id IS NULL THEN
   INSERT INTO public.guardian_consents(child_id,parent_name,parent_email,relationship_type,signature_name,
    declaration_version,declaration_text,consent_scope,email_verified_at,linked_guardian_id,affirmations,signature_method)
   VALUES(p_child,guardian.full_name,email,p_relationship,guardian.full_name,p_version,
    'Ich bin für dieses Kind gesetzlich vertretungsberechtigt und stimme seiner Nutzung von Workfare sowie Bewerbungen und dem Kontakt zu Anbietern für altersgerechte, zulässige Tätigkeiten zu. Gesetzliche Grenzen und gegebenenfalls weitere erforderliche Einwilligungen bleiben bestehen. Diese Zustimmung umfasst weder eine Zahlungsfreigabe bei Stripe noch eine vollständige Einsicht in private Chats.',
    'workfare_minor_jobs',email_confirmed,actor,'{"accepted":true,"adult_confirmed":true,"legal_authority":true}'::jsonb,'authenticated_email');
  END IF;
 END IF;
 UPDATE public.guardian_relationships SET status='active',consent_scope=CASE WHEN minor THEN 'workfare_minor_jobs' ELSE 'workfare_optional_family' END
  WHERE child_id=p_child AND guardian_id=actor;
 UPDATE public.profiles SET guardian_status='linked',guardian_id=COALESCE(guardian_id,actor),
   guardian_verified_at=COALESCE(guardian_verified_at,now()),updated_at=now() WHERE id=p_child;
 RETURN jsonb_build_object('success',true,'state','linked','childId',p_child,'consentRequired',minor);
END $$;

CREATE FUNCTION guardian_private.redeem(p_token text,p_accepted boolean,p_version text,p_relationship text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); invitation public.guardian_invitations%ROWTYPE;
 v_child_id uuid; v_parent_id uuid; minor boolean; result jsonb;
BEGIN
 IF p_accepted IS DISTINCT FROM true OR p_version IS DISTINCT FROM 'workfare-guardian-2026-10-24-v1'
  OR p_relationship NOT IN('mother','father','legal_guardian') THEN
  RETURN jsonb_build_object('success',false,'error','explicit_consent_required'); END IF;
 IF p_token IS NULL OR char_length(p_token) NOT BETWEEN 16 AND 512 THEN
  RETURN jsonb_build_object('success',false,'error','invalid_or_expired_invitation'); END IF;
 SELECT * INTO invitation FROM public.guardian_invitations WHERE token=p_token;
 IF NOT FOUND OR NOT guardian_private.in_scope(invitation.inviter_id) OR invitation.inviter_id=actor THEN
  RETURN jsonb_build_object('success',false,'error','invalid_or_expired_invitation'); END IF;
 v_child_id:=CASE WHEN invitation.direction='child_to_guardian' THEN invitation.child_id ELSE actor END;
 -- Creator, approval, revoke and reservation all lock the child before the invitation.
 PERFORM 1 FROM public.profiles WHERE id=v_child_id FOR UPDATE;
 SELECT * INTO invitation FROM public.guardian_invitations WHERE id=invitation.id FOR UPDATE;
 -- Only the original recipient can retry an already consumed link; never reactivate it.
 IF invitation.status='redeemed' AND invitation.redeemed_by=actor THEN
  SELECT r.child_id INTO v_child_id FROM public.guardian_relationships r
   WHERE r.child_id=invitation.child_id AND r.guardian_id=CASE WHEN invitation.direction='child_to_guardian' THEN actor ELSE invitation.inviter_id END
    AND r.status IN('active','pending');
  IF v_child_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','relationship_unavailable'); END IF;
  RETURN jsonb_build_object('success',true,'state',CASE WHEN EXISTS(SELECT FROM public.guardian_relationships r2 WHERE r2.child_id=v_child_id AND r2.guardian_id=CASE WHEN invitation.direction='child_to_guardian' THEN actor ELSE invitation.inviter_id END AND r2.status='active') THEN 'linked' ELSE 'pending_guardian_confirmation' END,
    'childId',v_child_id,'consentRequired',guardian_private.needs_consent(v_child_id));
 END IF;
 IF invitation.status<>'active' OR invitation.expires_at<=now() THEN
  RETURN jsonb_build_object('success',false,'error','invalid_or_expired_invitation'); END IF;
 v_child_id:=CASE WHEN invitation.direction='child_to_guardian' THEN invitation.child_id ELSE actor END;
 v_parent_id:=CASE WHEN invitation.direction='child_to_guardian' THEN actor ELSE invitation.inviter_id END;
 IF v_child_id=v_parent_id OR NOT guardian_private.child_eligible(v_child_id) OR NOT guardian_private.adult_eligible(v_parent_id)
   OR NOT guardian_private.in_scope(v_child_id) OR NOT guardian_private.in_scope(v_parent_id) THEN
  RETURN jsonb_build_object('success',false,'error','participants_ineligible'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=v_child_id FOR UPDATE;
 minor:=guardian_private.needs_consent(v_child_id);
 INSERT INTO public.guardian_relationships(child_id,guardian_id,status,consent_scope)
 VALUES(v_child_id,v_parent_id,CASE WHEN minor THEN 'pending' ELSE 'active' END,CASE WHEN minor THEN 'workfare_minor_jobs' ELSE 'workfare_optional_family' END)
 ON CONFLICT(child_id,guardian_id) DO UPDATE SET
   status=CASE WHEN public.guardian_relationships.status='revoked' THEN EXCLUDED.status ELSE public.guardian_relationships.status END,
   consent_scope=EXCLUDED.consent_scope;
 IF invitation.direction='child_to_guardian' THEN
  result:=guardian_private.approve(v_child_id,p_accepted,p_version,p_relationship);
  IF result->>'success'<>'true' THEN RETURN result; END IF;
 END IF;
 UPDATE public.guardian_invitations SET child_id=v_child_id,status='redeemed',redeemed_by=actor,used_at=now(),updated_at=now()
  WHERE id=invitation.id;
 RETURN jsonb_build_object('success',true,'state',CASE WHEN minor AND invitation.direction='guardian_to_child' THEN 'pending_guardian_confirmation' ELSE 'linked' END,
   'childId',v_child_id,'consentRequired',minor);
END $$;

CREATE FUNCTION guardian_private.context(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); p public.profiles%ROWTYPE;
 invitation public.guardian_invitations%ROWTYPE; preview jsonb:=NULL; connections jsonb;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=actor;
 IF p_token IS NOT NULL AND char_length(p_token) BETWEEN 16 AND 512 THEN
  SELECT * INTO invitation FROM public.guardian_invitations WHERE token=p_token
   AND guardian_private.in_scope(inviter_id) AND (status='active' OR redeemed_by=actor);
  IF FOUND THEN
   preview:=jsonb_build_object('direction',invitation.direction,'inviterName',(SELECT full_name FROM public.profiles WHERE id=invitation.inviter_id),
    'childName',CASE WHEN invitation.child_id IS NOT NULL THEN (SELECT full_name FROM public.profiles WHERE id=invitation.child_id)
      WHEN invitation.direction='guardian_to_child' AND guardian_private.child_eligible(actor) THEN p.full_name ELSE NULL END,
    'minorRequired',CASE WHEN invitation.child_id IS NOT NULL THEN guardian_private.needs_consent(invitation.child_id)
      WHEN invitation.direction='guardian_to_child' AND guardian_private.child_eligible(actor) THEN guardian_private.needs_consent(actor) ELSE NULL END,
    'status',CASE WHEN invitation.status='active' AND invitation.expires_at<=now() THEN 'expired' ELSE invitation.status END,'expiresAt',invitation.expires_at);
  END IF;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'childId',r.child_id,'guardianId',r.guardian_id,
  'name',CASE WHEN r.guardian_id=actor THEN c.full_name ELSE g.full_name END,
  'actorRole',CASE WHEN r.guardian_id=actor THEN 'guardian' ELSE 'child' END,'status',r.status,
  'consentRequired',guardian_private.needs_consent(r.child_id),'consented',r.status='active' AND (NOT guardian_private.needs_consent(r.child_id) OR guardian_private.relationship_approved(r.child_id,r.guardian_id))) ORDER BY r.created_at DESC,r.id),'[]'::jsonb)
 INTO connections FROM public.guardian_relationships r JOIN public.profiles c ON c.id=r.child_id JOIN public.profiles g ON g.id=r.guardian_id
 WHERE (r.guardian_id=actor OR r.child_id=actor) AND guardian_private.in_scope(r.child_id) AND guardian_private.in_scope(r.guardian_id);
 RETURN jsonb_build_object('authenticated',true,'userId',actor,'email',(SELECT email FROM auth.users WHERE id=actor),
  'viewer',CASE WHEN p.account_type::text='job_seeker' THEN 'child' WHEN guardian_private.adult_eligible(actor) THEN 'guardian' ELSE 'unconfigured' END,
  'profile',jsonb_build_object('fullName',p.full_name,'birthdate',p.birthdate,'accountType',p.account_type,'adultEligible',guardian_private.adult_eligible(actor)),
  'invitation',preview,'relationships',connections);
END $$;

CREATE FUNCTION guardian_private.application_access() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); minor boolean:=guardian_private.needs_consent(actor);
 eligible boolean:=guardian_private.can_apply(actor); linked boolean; waiting boolean;
BEGIN
 IF NOT guardian_private.child_eligible(actor) THEN
  RETURN jsonb_build_object('guardianStatus','none','hasActiveGuardian',false,'canApply',false,'isVerified',false); END IF;
 linked:=CASE WHEN minor THEN guardian_private.has_valid_guardian(actor) ELSE EXISTS(
  SELECT FROM public.guardian_relationships WHERE child_id=actor AND status='active' AND guardian_private.adult_eligible(guardian_id)) END;
 waiting:=EXISTS(SELECT FROM public.guardian_relationships WHERE child_id=actor AND status IN('active','pending'));
 RETURN jsonb_build_object('guardianStatus',CASE WHEN linked THEN 'linked' WHEN waiting THEN 'pending' ELSE 'none' END,
  'hasActiveGuardian',linked,'canApply',eligible,'isVerified',minor AND linked AND eligible);
END $$;

CREATE FUNCTION guardian_private.revoke(p_relationship uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); r public.guardian_relationships%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.guardian_relationships WHERE id=p_relationship AND (child_id=actor OR guardian_id=actor);
 IF NOT FOUND OR NOT guardian_private.in_scope(r.child_id) OR NOT guardian_private.in_scope(r.guardian_id) THEN
  RETURN jsonb_build_object('ok',false,'code','relationship_unavailable'); END IF;
 -- Same child lock as approvals and new reservations, even for repeated revocation.
 PERFORM 1 FROM public.profiles WHERE id=r.child_id FOR UPDATE;
 PERFORM 1 FROM public.guardian_relationships WHERE id=p_relationship FOR UPDATE;
 UPDATE public.guardian_consents SET status='revoked',revoked_at=COALESCE(revoked_at,now()),updated_at=now()
  WHERE child_id=r.child_id AND linked_guardian_id=r.guardian_id AND status='approved';
 UPDATE public.guardian_relationships SET status='revoked' WHERE id=p_relationship;
 UPDATE public.profiles SET guardian_status=CASE WHEN guardian_private.can_apply(r.child_id) AND EXISTS(
  SELECT FROM public.guardian_relationships WHERE child_id=r.child_id AND status='active') THEN 'linked'::public.guardian_status ELSE 'none'::public.guardian_status END,
  guardian_id=(SELECT guardian_id FROM public.guardian_relationships WHERE child_id=r.child_id AND status='active' ORDER BY created_at,id LIMIT 1),
  updated_at=now() WHERE id=r.child_id;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Public wrappers carry no elevated permissions; identity is established inside private workflows.
CREATE FUNCTION public.get_guardian_access_context(p_token text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.context(p_token); $$;
CREATE FUNCTION public.get_guardian_application_access() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.application_access(); $$;
CREATE FUNCTION public.complete_guardian_profile(p_name text,p_birthdate date,p_adult_confirmed boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.complete_profile(p_name,p_birthdate,p_adult_confirmed); $$;
CREATE FUNCTION public.create_family_invitation(p_direction text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.create_invitation(p_direction); $$;
CREATE FUNCTION public.redeem_family_invitation(p_token text,p_accepted boolean,p_version text,p_relationship text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.redeem(p_token,p_accepted,p_version,p_relationship); $$;
CREATE FUNCTION public.approve_guardian_relationship(p_child uuid,p_accepted boolean,p_version text,p_relationship text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.approve(p_child,p_accepted,p_version,p_relationship); $$;
CREATE FUNCTION public.revoke_guardian_relationship(p_relationship uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.revoke(p_relationship); $$;
CREATE OR REPLACE FUNCTION public.create_guardian_invitation(p_invited_email text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.create_invitation('child_to_guardian'); $$;
-- The former implicit-consent endpoint cannot authorize a new relationship.
CREATE OR REPLACE FUNCTION public.redeem_guardian_invitation(token_input text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT jsonb_build_object('success',false,'error','explicit_consent_required'); $$;
CREATE OR REPLACE FUNCTION public.get_guardian_invitation_info(token_input text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN result:=guardian_private.context(token_input)->'invitation';RETURN jsonb_build_object('valid',result IS NOT NULL,'invitation',result);END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guardian_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA guardian_private TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_guardian_application_access(),public.get_guardian_access_context(text),public.complete_guardian_profile(text,date,boolean),
 public.create_family_invitation(text),public.redeem_family_invitation(text,boolean,text,text),public.approve_guardian_relationship(uuid,boolean,text,text),public.revoke_guardian_relationship(uuid),
 public.create_guardian_invitation(text),public.redeem_guardian_invitation(text),public.get_guardian_invitation_info(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_guardian_application_access(),public.get_guardian_access_context(text),public.complete_guardian_profile(text,date,boolean),
 public.create_family_invitation(text),public.redeem_family_invitation(text,boolean,text,text),public.approve_guardian_relationship(uuid,boolean,text,text),public.revoke_guardian_relationship(uuid),
 public.create_guardian_invitation(text),public.redeem_guardian_invitation(text),public.get_guardian_invitation_info(text) TO authenticated,service_role;
-- Invitation tokens and consent evidence are returned only by narrow owner-scoped functions.
REVOKE ALL ON public.guardian_invitations,public.guardian_consents,public.guardian_consent_links FROM anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='demo_executor') THEN
 GRANT USAGE ON SCHEMA guardian_private TO demo_executor;
 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA guardian_private TO demo_executor;
END IF; END $$;

-- Age-dependent job eligibility without copying or altering payment business functions.
DO $$ DECLARE source text; modified text;
BEGIN
 source:=pg_get_functiondef('activity_private.submit_job_application(uuid,text)'::regprocedure);
 modified:=regexp_replace(source,
  'IF NOT EXISTS \(\s*SELECT 1 FROM public.guardian_relationships relationship\s*WHERE relationship.child_id = v_user_id\s*AND relationship.status = ''active''\s*\)',
  'IF NOT guardian_private.can_apply(v_user_id)');
 IF source=modified THEN RAISE EXCEPTION 'Expected guardian eligibility guard was not found'; END IF;
 EXECUTE modified;
END $$;

CREATE FUNCTION guardian_private.guard_application() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status::text IN('submitted','negotiating','accepted') AND COALESCE(NEW.conversation_state,'open')='open'
  AND (TG_OP='INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.status IS DISTINCT FROM OLD.status OR NEW.conversation_state IS DISTINCT FROM OLD.conversation_state) THEN
  PERFORM 1 FROM public.profiles WHERE id=NEW.user_id FOR UPDATE;
  IF NOT guardian_private.can_apply(NEW.user_id) THEN RAISE EXCEPTION 'GUARDIAN_CONSENT_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guardian_private.guard_application() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guardian_require_before_reservation BEFORE INSERT OR UPDATE OF user_id,status,conversation_state ON public.applications
 FOR EACH ROW EXECUTE FUNCTION guardian_private.guard_application();

NOTIFY pgrst,'reload schema';
COMMIT;
