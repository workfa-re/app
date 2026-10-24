BEGIN;

-- Install last, after the entire family-purpose chain. A partial schema must
-- not expose minimal-parent registration to application clients.
DO $$
BEGIN
 IF to_regprocedure('public.get_guardian_application_access()') IS NULL
   OR to_regprocedure('public.get_guardian_access_context(text)') IS NULL
   OR to_regprocedure('public.complete_guardian_profile(text,date,boolean)') IS NULL
   OR to_regprocedure('public.create_family_invitation(text)') IS NULL
   OR to_regprocedure('public.redeem_family_invitation(text,boolean,text,text)') IS NULL
   OR to_regprocedure('public.approve_guardian_relationship(uuid,boolean,text,text)') IS NULL
   OR to_regprocedure('public.revoke_guardian_relationship(uuid)') IS NULL
   OR to_regprocedure('guardian_private.account_workspace()') IS NULL
   OR to_regclass('public.guardian_consents_one_approved_guardian_scope_idx') IS NULL
   OR to_regclass('public.guardian_consents_one_approved_per_child_idx') IS NOT NULL
   OR to_regclass('public.guardian_consents_one_approved_unlinked_child_idx') IS NOT NULL
   OR NOT EXISTS(SELECT FROM pg_catalog.pg_attribute a
     WHERE a.attrelid='public.profiles'::regclass AND a.attname='account_type' AND NOT a.attnotnull
       AND NOT EXISTS(SELECT FROM pg_catalog.pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum))
   OR position('target.account_type = ''job_provider''::public.account_type' IN
     pg_get_functiondef('public.complete_profile_onboarding(text,date,text,uuid,public.account_type,public.provider_kind,text,text,text)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'Complete guardian-purpose schema is required before activation';
 END IF;
END $$;

-- This reveals only a static deployment capability, never family/user data.
CREATE FUNCTION public.get_guardian_schema_readiness() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('ready',true,'release','workfare-guardian-purpose-v1','revision','20261024101749');
$$;
REVOKE ALL ON FUNCTION public.get_guardian_schema_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guardian_schema_readiness() TO anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
