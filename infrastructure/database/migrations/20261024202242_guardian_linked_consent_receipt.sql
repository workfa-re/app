BEGIN;

-- Reuse private consent links for receipts. No new family, Auth or payout data.
CREATE FUNCTION guardian_private.record_linked_receipt(p_child uuid,p_receipt_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); c public.guardian_consents%ROWTYPE;
 l public.guardian_consent_links%ROWTYPE; email text; child_name text;
BEGIN
 IF p_receipt_hash IS NULL OR p_receipt_hash !~ '^[a-f0-9]{64}$' OR actor=p_child THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_input'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_child FOR UPDATE;
 IF NOT guardian_private.in_scope(p_child) OR NOT guardian_private.adult_eligible(actor)
  OR NOT EXISTS(SELECT FROM public.guardian_relationships WHERE child_id=p_child AND guardian_id=actor AND status='active') THEN
  RETURN jsonb_build_object('ok',false,'code','relationship_unavailable'); END IF;
 SELECT * INTO c FROM public.guardian_consents WHERE child_id=p_child AND linked_guardian_id=actor
  AND consent_scope='workfare_minor_jobs' AND status='approved' AND revoked_at IS NULL
  AND declaration_version='workfare-guardian-2026-10-24-v1' AND email_verified_at IS NOT NULL
  ORDER BY approved_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','relationship_unavailable'); END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL;
 SELECT split_part(btrim(full_name),' ',1) INTO child_name FROM public.profiles WHERE id=p_child;
 IF c.link_id IS NOT NULL THEN
  SELECT * INTO l FROM public.guardian_consent_links WHERE id=c.link_id AND child_id=p_child;
  IF NOT FOUND OR l.receipt_hash IS DISTINCT FROM p_receipt_hash OR l.status<>'redeemed' THEN
   RETURN jsonb_build_object('ok',false,'code','receipt_already_recorded'); END IF;
  RETURN jsonb_build_object('ok',true,'reused',true,'childName',child_name,'parentEmail',email);
 END IF;
 INSERT INTO public.guardian_consent_links(child_id,token_hash,expires_at,status,used_at,receipt_hash)
 VALUES(p_child,encode(extensions.digest('linked-receipt:'||p_receipt_hash,'sha256'),'hex'),now()+interval '48 hours','redeemed',now(),p_receipt_hash)
 RETURNING * INTO l;
 UPDATE public.guardian_consents SET link_id=l.id,updated_at=now() WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'reused',false,'childName',child_name,'parentEmail',email);
END $$;

CREATE FUNCTION guardian_private.linked_receipt_context(p_receipt text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.guardian_consents%ROWTYPE; l public.guardian_consent_links%ROWTYPE;
BEGIN
 IF p_receipt IS NULL OR p_receipt !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO l FROM public.guardian_consent_links WHERE receipt_hash=encode(extensions.digest(p_receipt,'sha256'),'hex');
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.guardian_consents WHERE link_id=l.id AND child_id=l.child_id
  AND linked_guardian_id IS NOT NULL AND consent_scope='workfare_minor_jobs' ORDER BY approved_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('ok',true,'direction','child_to_guardian',
  'childName',(SELECT split_part(btrim(full_name),' ',1) FROM public.profiles WHERE id=c.child_id),
  'minorRequired',guardian_private.needs_consent(c.child_id),'accountLinked',true,
  'status',CASE WHEN c.status='approved' AND c.revoked_at IS NULL AND l.status='redeemed'
   AND EXISTS(SELECT FROM public.guardian_relationships WHERE child_id=c.child_id AND guardian_id=c.linked_guardian_id AND status='active')
   THEN 'approved' ELSE 'revoked' END,'expiresAt',NULL);
END $$;

CREATE FUNCTION guardian_private.revoke_linked_receipt(p_receipt text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.guardian_consents%ROWTYPE; l public.guardian_consent_links%ROWTYPE;
BEGIN
 IF p_receipt IS NULL OR p_receipt !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO l FROM public.guardian_consent_links WHERE receipt_hash=encode(extensions.digest(p_receipt,'sha256'),'hex');
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.guardian_consents WHERE link_id=l.id AND child_id=l.child_id
  AND linked_guardian_id IS NOT NULL AND consent_scope='workfare_minor_jobs' ORDER BY approved_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Same child-first order as grant, account revocation and reservations.
 PERFORM 1 FROM public.profiles WHERE id=c.child_id FOR UPDATE;
 PERFORM 1 FROM public.guardian_consents WHERE id=c.id FOR UPDATE;
 UPDATE public.guardian_consents SET status='revoked',revoked_at=COALESCE(revoked_at,now()),updated_at=now()
  WHERE id=c.id AND status='approved';
 UPDATE public.guardian_consent_links SET status='revoked',updated_at=now() WHERE id=l.id;
 -- Keep the family account and connection so the parent can manage a new approval.
 UPDATE public.guardian_relationships SET status='pending' WHERE child_id=c.child_id AND guardian_id=c.linked_guardian_id
  AND status='active' AND NOT EXISTS(SELECT FROM public.guardian_consents other WHERE other.child_id=c.child_id
   AND other.linked_guardian_id=c.linked_guardian_id AND other.status='approved' AND other.revoked_at IS NULL
   AND other.consent_scope='workfare_minor_jobs' AND other.declaration_version='workfare-guardian-2026-10-24-v1');
 UPDATE public.profiles SET guardian_status=CASE WHEN guardian_private.has_valid_guardian(c.child_id) THEN 'linked'::public.guardian_status
  WHEN EXISTS(SELECT FROM public.guardian_relationships WHERE child_id=c.child_id AND status='pending') THEN 'pending'::public.guardian_status
  ELSE 'none'::public.guardian_status END,
  guardian_id=(SELECT guardian_id FROM public.guardian_relationships WHERE child_id=c.child_id AND status='active' ORDER BY created_at,id LIMIT 1),
  updated_at=now() WHERE id=c.child_id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.record_my_guardian_consent_receipt(p_child uuid,p_receipt_hash text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT guardian_private.record_linked_receipt(p_child,p_receipt_hash); $$;
CREATE OR REPLACE FUNCTION public.get_guardian_permission_context(p_token text DEFAULT NULL,p_receipt text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT COALESCE(guardian_private.linked_receipt_context(p_receipt),guardian_private.permission_context(p_token,p_receipt));
$$;
CREATE OR REPLACE FUNCTION public.revoke_guardian_permission(p_receipt text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT COALESCE(guardian_private.revoke_linked_receipt(p_receipt),guardian_private.revoke_permission(p_receipt));
$$;
REVOKE ALL ON FUNCTION guardian_private.record_linked_receipt(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION guardian_private.record_linked_receipt(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_my_guardian_consent_receipt(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_my_guardian_consent_receipt(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION guardian_private.linked_receipt_context(text),guardian_private.revoke_linked_receipt(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION guardian_private.linked_receipt_context(text),guardian_private.revoke_linked_receipt(text) TO service_role;
-- Existing permission wrappers stay service-only; no receipt or consent table grant.
NOTIFY pgrst,'reload schema';
COMMIT;
