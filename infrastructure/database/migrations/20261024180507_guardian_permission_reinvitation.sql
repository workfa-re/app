BEGIN;

-- A withdrawn declaration must not leave its unused invitation reusable. Keep
-- existing accounts, family relationships and every other permission intact.
DO $$
DECLARE source text; modified text;
BEGIN
 source:=pg_get_functiondef('guardian_private.revoke_permission(text)'::regprocedure);
 modified:=replace(source,
  'UPDATE public.guardian_consent_links SET status=''revoked'',updated_at=now() WHERE id=l.id;',
  'UPDATE public.guardian_consent_links SET status=''revoked'',updated_at=now() WHERE id=l.id;
 UPDATE public.guardian_invitations SET status=''revoked'',updated_at=now()
  WHERE child_id=l.child_id AND direction=''child_to_guardian'' AND status=''active''
   AND encode(extensions.digest(token,''sha256''),''hex'')=l.token_hash;');
 IF modified=source THEN RAISE EXCEPTION 'Expected permission revocation implementation was not found'; END IF;
 EXECUTE modified;
END $$;

COMMIT;
