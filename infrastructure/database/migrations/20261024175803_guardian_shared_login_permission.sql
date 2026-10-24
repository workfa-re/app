BEGIN;

-- Accountless permission is an email-confirmed declaration, not an Auth user,
-- family relationship, identity verification or Stripe guardian/KYC proof.
ALTER TABLE public.guardian_consent_links
 ADD COLUMN challenge_id uuid,
 ADD COLUMN challenge_code_hash text,
 ADD COLUMN challenge_email text,
 ADD COLUMN challenge_expires_at timestamptz,
 ADD COLUMN challenge_sent_at timestamptz,
 ADD COLUMN challenge_attempts smallint NOT NULL DEFAULT 0 CHECK(challenge_attempts BETWEEN 0 AND 6),
 ADD COLUMN challenge_send_count smallint NOT NULL DEFAULT 0 CHECK(challenge_send_count BETWEEN 0 AND 10),
 ADD COLUMN challenge_window timestamptz,
 ADD COLUMN receipt_hash text;
CREATE UNIQUE INDEX guardian_permission_receipt_hash_idx ON public.guardian_consent_links(receipt_hash) WHERE receipt_hash IS NOT NULL;
-- None of the challenge or receipt fields is browser-readable, including to children.
REVOKE ALL ON public.guardian_consent_links,public.guardian_consents FROM anon,authenticated;
CREATE UNIQUE INDEX guardian_consents_accountless_link_idx ON public.guardian_consents(link_id)
 WHERE status='approved' AND consent_scope='workfare_minor_jobs_accountless';

CREATE FUNCTION guardian_private.permission_context(p_token text,p_receipt text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.guardian_invitations%ROWTYPE; l public.guardian_consent_links%ROWTYPE; c public.guardian_consents%ROWTYPE;
BEGIN
 IF p_receipt IS NOT NULL THEN
  IF p_receipt !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false); END IF;
  SELECT * INTO l FROM public.guardian_consent_links WHERE receipt_hash=encode(extensions.digest(p_receipt,'sha256'),'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false); END IF;
  SELECT * INTO c FROM public.guardian_consents WHERE link_id=l.id AND consent_scope='workfare_minor_jobs_accountless' ORDER BY approved_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false); END IF;
  RETURN jsonb_build_object('ok',true,'direction','child_to_guardian','childName',(SELECT split_part(btrim(full_name),' ',1) FROM public.profiles WHERE id=l.child_id),
   'minorRequired',guardian_private.needs_consent(l.child_id),'status',CASE WHEN c.status='approved' AND c.revoked_at IS NULL AND l.status='redeemed' THEN 'approved' ELSE 'revoked' END,'expiresAt',NULL);
 END IF;
 IF p_token IS NULL OR char_length(p_token) NOT BETWEEN 16 AND 512 THEN RETURN jsonb_build_object('ok',false); END IF;
 SELECT * INTO i FROM public.guardian_invitations WHERE token=p_token AND status='active' AND expires_at>now();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false); END IF;
 RETURN jsonb_build_object('ok',true,'direction',i.direction,'childName',CASE WHEN i.direction='child_to_guardian' THEN (SELECT split_part(btrim(full_name),' ',1) FROM public.profiles WHERE id=i.child_id) ELSE NULL END,
  'minorRequired',CASE WHEN i.direction='child_to_guardian' THEN guardian_private.needs_consent(i.child_id) ELSE NULL END,
  'status',CASE WHEN EXISTS(SELECT FROM public.guardian_consent_links WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND status='redeemed') THEN 'approved' WHEN EXISTS(SELECT FROM public.guardian_consent_links WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND status='revoked') THEN 'revoked' ELSE 'available' END,'expiresAt',i.expires_at);
END $$;

CREATE FUNCTION guardian_private.prepare_permission(p_token text,p_email text,p_challenge uuid,p_code_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.guardian_invitations%ROWTYPE; l public.guardian_consent_links%ROWTYPE; v_email text:=lower(btrim(p_email)); h text;
BEGIN
 IF p_token IS NULL OR char_length(p_token) NOT BETWEEN 16 AND 512 OR p_challenge IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$'
  OR v_email IS NULL OR char_length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN jsonb_build_object('ok',false,'code','invalid_input'); END IF;
 SELECT * INTO i FROM public.guardian_invitations WHERE token=p_token;
 IF NOT FOUND OR i.direction<>'child_to_guardian' OR i.child_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid_or_expired_invitation'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=i.child_id FOR UPDATE;
 SELECT * INTO i FROM public.guardian_invitations WHERE id=i.id FOR UPDATE;
 IF i.status<>'active' OR i.expires_at<=now() OR NOT guardian_private.child_eligible(i.child_id) OR NOT guardian_private.needs_consent(i.child_id) THEN RETURN jsonb_build_object('ok',false,'code','invalid_or_expired_invitation'); END IF;
 IF EXISTS(SELECT FROM auth.users u WHERE u.id=i.child_id AND lower(u.email)=v_email) THEN RETURN jsonb_build_object('ok',false,'code','parent_email_required'); END IF;
 h:=encode(extensions.digest(p_token,'sha256'),'hex');
 INSERT INTO public.guardian_consent_links(child_id,token_hash,expires_at) VALUES(i.child_id,h,i.expires_at) ON CONFLICT(token_hash) DO NOTHING;
 SELECT * INTO l FROM public.guardian_consent_links WHERE token_hash=h FOR UPDATE;
 IF l.child_id<>i.child_id OR l.status<>'active' THEN RETURN jsonb_build_object('ok',false,'code','permission_already_recorded'); END IF;
 IF l.challenge_sent_at>now()-interval '60 seconds' OR (l.challenge_window>now()-interval '24 hours' AND l.challenge_send_count>=5) THEN RETURN jsonb_build_object('ok',false,'code','permission_rate_limited'); END IF;
 UPDATE public.guardian_consent_links SET challenge_id=p_challenge,challenge_code_hash=p_code_hash,challenge_email=v_email,
  challenge_expires_at=LEAST(now()+interval '10 minutes',i.expires_at),challenge_sent_at=now(),challenge_attempts=0,
  challenge_send_count=CASE WHEN l.challenge_window>now()-interval '24 hours' THEN l.challenge_send_count+1 ELSE 1 END,
  challenge_window=CASE WHEN l.challenge_window>now()-interval '24 hours' THEN l.challenge_window ELSE now() END,updated_at=now() WHERE id=l.id;
 RETURN jsonb_build_object('ok',true,'childName',(SELECT split_part(btrim(full_name),' ',1) FROM public.profiles WHERE id=i.child_id));
END $$;

CREATE FUNCTION guardian_private.submit_permission(p_token text,p_challenge uuid,p_code_hash text,p_name text,p_relationship text,p_accepted boolean,p_adult_confirmed boolean,p_version text,p_receipt_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.guardian_invitations%ROWTYPE; l public.guardian_consent_links%ROWTYPE; n text:=btrim(p_name);
BEGIN
 IF p_accepted IS DISTINCT FROM true OR p_adult_confirmed IS DISTINCT FROM true OR p_version IS DISTINCT FROM 'workfare-guardian-2026-10-24-v1'
  OR p_relationship IS NULL OR p_relationship NOT IN('mother','father','legal_guardian') OR n IS NULL OR char_length(n) NOT BETWEEN 3 AND 120
  OR n !~ '[[:alpha:]]' OR n ~ '[[:cntrl:]]' OR p_receipt_hash IS NULL OR p_receipt_hash !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','explicit_consent_required'); END IF;
 SELECT * INTO i FROM public.guardian_invitations WHERE token=p_token;
 IF NOT FOUND OR i.direction<>'child_to_guardian' THEN RETURN jsonb_build_object('ok',false,'code','invalid_or_expired_invitation'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=i.child_id FOR UPDATE;
 SELECT * INTO i FROM public.guardian_invitations WHERE id=i.id FOR UPDATE;
 SELECT * INTO l FROM public.guardian_consent_links WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') FOR UPDATE;
 IF FOUND AND l.child_id=i.child_id AND l.status='redeemed' AND l.receipt_hash=p_receipt_hash AND l.challenge_id=p_challenge
  AND EXISTS(SELECT FROM public.guardian_consents c WHERE c.link_id=l.id AND c.child_id=i.child_id AND c.status='approved' AND c.revoked_at IS NULL
   AND c.declaration_version='workfare-guardian-2026-10-24-v1' AND c.consent_scope='workfare_minor_jobs_accountless') THEN RETURN jsonb_build_object('ok',true,'reused',true); END IF;
 IF NOT FOUND OR l.child_id<>i.child_id OR l.status<>'active' OR i.status<>'active' OR i.expires_at<=now()
  OR NOT guardian_private.child_eligible(i.child_id) OR NOT guardian_private.needs_consent(i.child_id) THEN RETURN jsonb_build_object('ok',false,'code','invalid_or_expired_invitation'); END IF;
 IF l.challenge_id IS DISTINCT FROM p_challenge OR l.challenge_expires_at IS NULL OR l.challenge_expires_at<=now() OR l.challenge_attempts>=5 OR l.challenge_code_hash IS NULL THEN RETURN jsonb_build_object('ok',false,'code','permission_code_invalid'); END IF;
 UPDATE public.guardian_consent_links SET challenge_attempts=challenge_attempts+1,updated_at=now() WHERE id=l.id;
 IF p_code_hash IS NULL OR l.challenge_code_hash<>p_code_hash THEN RETURN jsonb_build_object('ok',false,'code','permission_code_invalid'); END IF;
 INSERT INTO public.guardian_consents(child_id,link_id,parent_name,parent_email,relationship_type,signature_name,declaration_version,declaration_text,
  consent_scope,email_verified_at,linked_guardian_id,affirmations,signature_method,revocation_notice)
 VALUES(i.child_id,l.id,n,l.challenge_email,p_relationship,n,p_version,
  'Ich bin für dieses Kind gesetzlich vertretungsberechtigt und stimme seiner Nutzung von Workfare sowie Bewerbungen und dem Kontakt zu Anbietern für altersgerechte, zulässige Tätigkeiten zu. Gesetzliche Grenzen und gegebenenfalls weitere erforderliche Einwilligungen bleiben bestehen. Diese Zustimmung umfasst weder eine Zahlungsfreigabe bei Stripe noch eine vollständige Einsicht in private Chats.',
  'workfare_minor_jobs_accountless',now(),NULL,'{"accepted":true,"adult_confirmed":true,"legal_authority":true,"email_confirmed":true}'::jsonb,'email_otp_typed_name',
  'Diese Zustimmung kann über den persönlichen Widerrufslink zurückgenommen werden. Die Zustimmung richtet kein Konto und keine Zahlungsfreigabe ein.');
 UPDATE public.guardian_consent_links SET status='redeemed',used_at=now(),challenge_code_hash=NULL,challenge_email=NULL,
  challenge_expires_at=NULL,receipt_hash=p_receipt_hash,updated_at=now() WHERE id=l.id;
 RETURN jsonb_build_object('ok',true,'parentEmail',l.challenge_email,'reused',false);
END $$;

CREATE OR REPLACE FUNCTION public.get_guardian_access_context(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT guardian_private.context(p_token)||jsonb_build_object('workspace',guardian_private.account_workspace(),
  'permission',jsonb_build_object('required',guardian_private.needs_consent(auth.uid()),'granted',guardian_private.can_apply(auth.uid())));
$$;

CREATE FUNCTION guardian_private.revoke_permission(p_receipt text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.guardian_consent_links%ROWTYPE;
BEGIN
 IF p_receipt IS NULL OR p_receipt !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','invalid_input'); END IF;
 SELECT * INTO l FROM public.guardian_consent_links WHERE receipt_hash=encode(extensions.digest(p_receipt,'sha256'),'hex');
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','invalid_input'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=l.child_id FOR UPDATE;
 UPDATE public.guardian_consents SET status='revoked',revoked_at=COALESCE(revoked_at,now()),updated_at=now()
  WHERE link_id=l.id AND consent_scope='workfare_minor_jobs_accountless' AND status='approved' AND linked_guardian_id IS NULL;
 UPDATE public.guardian_consent_links SET status='revoked',updated_at=now() WHERE id=l.id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION guardian_private.has_accountless_permission(p_child uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.guardian_consents c JOIN public.guardian_consent_links l ON l.id=c.link_id AND l.child_id=c.child_id
  WHERE c.child_id=p_child AND c.linked_guardian_id IS NULL AND c.status='approved' AND c.revoked_at IS NULL
   AND c.consent_scope='workfare_minor_jobs_accountless' AND c.declaration_version='workfare-guardian-2026-10-24-v1'
   AND c.signature_method='email_otp_typed_name' AND c.email_verified_at IS NOT NULL
   AND c.affirmations @> '{"accepted":true,"adult_confirmed":true,"legal_authority":true,"email_confirmed":true}'::jsonb
   AND l.status='redeemed' AND l.receipt_hash IS NOT NULL AND l.used_at IS NOT NULL);
$$;
CREATE OR REPLACE FUNCTION guardian_private.can_apply(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT guardian_private.in_scope(p_user) AND guardian_private.child_eligible(p_user)
  AND (NOT guardian_private.needs_consent(p_user) OR guardian_private.has_valid_guardian(p_user) OR guardian_private.has_accountless_permission(p_user));
$$;
-- Existing linked guardians, identity labels and Stripe proofs are deliberately unchanged.

-- A new durable parent relationship requires a chosen password; existing links
-- remain accessible so legacy OTP users can migrate through password recovery.
DO $$ DECLARE source text; modified text; BEGIN
 source:=pg_get_functiondef('guardian_private.redeem(text,boolean,text,text)'::regprocedure);
 modified:=replace(source,'minor:=guardian_private.needs_consent(v_child_id);',
 'IF NOT EXISTS(SELECT FROM auth.users WHERE id=v_parent_id AND nullif(encrypted_password,'''') IS NOT NULL)
  AND NOT EXISTS(SELECT FROM public.guardian_relationships WHERE child_id=v_child_id AND guardian_id=v_parent_id AND status IN(''active'',''pending'')) THEN
  RETURN jsonb_build_object(''success'',false,''error'',''password_required''); END IF;
 minor:=guardian_private.needs_consent(v_child_id);');
 IF modified=source THEN RAISE EXCEPTION 'Expected guardian redemption guard was not found'; END IF; EXECUTE modified;
 source:=pg_get_functiondef('guardian_private.create_invitation(text)'::regprocedure);
 modified:=replace(source,'IF p_direction NOT IN(''child_to_guardian'',''guardian_to_child'') THEN',
 'IF p_direction=''guardian_to_child'' AND NOT EXISTS(SELECT FROM auth.users WHERE id=actor AND nullif(encrypted_password,'''') IS NOT NULL) THEN
  RETURN jsonb_build_object(''error'',''password_required''); END IF;
 IF p_direction NOT IN(''child_to_guardian'',''guardian_to_child'') THEN');
 IF modified=source THEN RAISE EXCEPTION 'Expected guardian invitation guard was not found'; END IF; EXECUTE modified;
END $$;

CREATE FUNCTION public.get_guardian_permission_context(p_token text DEFAULT NULL,p_receipt text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.permission_context(p_token,p_receipt); $$;
CREATE FUNCTION public.prepare_guardian_permission(p_token text,p_email text,p_challenge uuid,p_code_hash text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.prepare_permission(p_token,p_email,p_challenge,p_code_hash); $$;
CREATE FUNCTION public.submit_guardian_permission(p_token text,p_challenge uuid,p_code_hash text,p_name text,p_relationship text,p_accepted boolean,p_adult_confirmed boolean,p_version text,p_receipt_hash text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.submit_permission(p_token,p_challenge,p_code_hash,p_name,p_relationship,p_accepted,p_adult_confirmed,p_version,p_receipt_hash); $$;
CREATE FUNCTION public.revoke_guardian_permission(p_receipt text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.revoke_permission(p_receipt); $$;
REVOKE ALL ON FUNCTION guardian_private.permission_context(text,text),guardian_private.prepare_permission(text,text,uuid,text),guardian_private.submit_permission(text,uuid,text,text,text,boolean,boolean,text,text),guardian_private.revoke_permission(text),guardian_private.has_accountless_permission(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION guardian_private.permission_context(text,text),guardian_private.prepare_permission(text,text,uuid,text),guardian_private.submit_permission(text,uuid,text,text,text,boolean,boolean,text,text),guardian_private.revoke_permission(text),guardian_private.has_accountless_permission(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_guardian_permission_context(text,text),public.prepare_guardian_permission(text,text,uuid,text),public.submit_guardian_permission(text,uuid,text,text,text,boolean,boolean,text,text),public.revoke_guardian_permission(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_guardian_permission_context(text,text),public.prepare_guardian_permission(text,text,uuid,text),public.submit_guardian_permission(text,uuid,text,text,text,boolean,boolean,text,text),public.revoke_guardian_permission(text) TO service_role;

CREATE FUNCTION public.get_guardian_permission_readiness() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT '{"ready":true,"release":"workfare-guardian-permission-v1","revision":"20261024173209"}'::jsonb; $$;
REVOKE ALL ON FUNCTION public.get_guardian_permission_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guardian_permission_readiness() TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
