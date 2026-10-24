BEGIN;

-- New identities are neutral until they choose their purpose. Existing rows
-- retain their role. Only guarded onboarding functions may write this column.
ALTER TABLE public.profiles ALTER COLUMN account_type DROP NOT NULL,
 ALTER COLUMN account_type DROP DEFAULT;

DO $$
DECLARE source text; modified text; signature text;
BEGIN
 source:=pg_get_functiondef('guardian_private.complete_profile(text,date,boolean)'::regprocedure);
 modified:=replace(source,
   'UPDATE public.profiles SET full_name=n,birthdate=p_birthdate,updated_at=now() WHERE id=actor;',
   'UPDATE public.profiles SET full_name=n,birthdate=p_birthdate,
     account_type=CASE WHEN p.account_type IS DISTINCT FROM ''job_provider''::public.account_type
       AND (p.birthdate IS NULL OR nullif(btrim(p.city),'''') IS NULL)
       AND NOT EXISTS(SELECT FROM public.applications WHERE user_id=actor)
       AND NOT EXISTS(SELECT FROM public.jobs WHERE posted_by=actor)
       THEN NULL ELSE p.account_type END,
     updated_at=now() WHERE id=actor;');
 IF source=modified THEN RAISE EXCEPTION 'Expected minimal guardian profile update was not found'; END IF;
 EXECUTE modified;

 -- These previous guards used SQL unknown on a role-less account. Preserve
 -- each existing workflow while explicitly rejecting missing roles.
 FOREACH signature IN ARRAY ARRAY['public.request_provider_verification(text,text,text,text,numeric,numeric)',
   'payment_private.assert_recipient(uuid,text)'] LOOP
   IF to_regprocedure(signature) IS NULL THEN CONTINUE; END IF;
   source:=pg_get_functiondef(to_regprocedure(signature));
   modified:=replace(source,'v_profile.account_type <> ''job_provider''','v_profile.account_type IS DISTINCT FROM ''job_provider''');
   modified:=replace(modified,'p.account_type<>''job_seeker''','p.account_type IS DISTINCT FROM ''job_seeker''');
   IF source=modified THEN RAISE EXCEPTION 'Expected role guard was not found in %',signature; END IF;
   EXECUTE modified;
 END LOOP;

 -- A family's optional preferences must not require a marketplace address.
 IF EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_update_own') THEN
   ALTER POLICY profiles_update_own ON public.profiles WITH CHECK (
     (SELECT auth.uid())=id AND (birthdate IS NULL OR (
       nullif(btrim(full_name),'') IS NOT NULL AND (nullif(btrim(city),'') IS NOT NULL OR (
         account_type IS NULL AND provider_kind IS NULL AND guardian_private.adult_eligible(id))))));
 END IF;
END $$;

-- A parent-purpose account can finish the existing private-provider onboarding
-- on the same identity. No date-of-birth rewrite, role switch, verification,
-- payment readiness, family relation or consent is implicitly granted.
DO $$
DECLARE source text; modified text;
BEGIN
 source:=pg_get_functiondef('public.complete_profile_onboarding(text,date,text,uuid,public.account_type,public.provider_kind,text,text,text)'::regprocedure);
 modified:=replace(source,'WHERE target.birthdate IS NULL',
 'WHERE target.birthdate IS NULL OR (
    target.account_type IS NULL AND target.provider_kind IS NULL
    AND target.birthdate = EXCLUDED.birthdate
    AND EXCLUDED.account_type = ''job_provider''::public.account_type
    AND EXCLUDED.provider_kind = ''private''::public.provider_kind
    AND EXCLUDED.market_id IS NOT NULL
    AND guardian_private.adult_eligible(target.id)
  )');
 IF source=modified THEN RAISE EXCEPTION 'Expected one-time onboarding guard was not found'; END IF;
 EXECUTE modified;
END $$;

CREATE FUNCTION guardian_private.account_workspace() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); p public.profiles%ROWTYPE; configured boolean; access text;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'GUARDIAN_PROFILE_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(nullif(encrypted_password,'') IS NOT NULL,false) INTO configured FROM auth.users WHERE id=actor;
 access:=CASE
   WHEN p.account_type::text='job_provider' AND nullif(btrim(p.full_name),'') IS NOT NULL
     AND p.birthdate IS NOT NULL AND nullif(btrim(p.city),'') IS NOT NULL THEN 'provider_complete'
   WHEN p.account_type::text='job_provider' THEN 'provider_incomplete'
   WHEN p.account_type::text='job_seeker' THEN 'child'
   WHEN p.account_type IS NULL AND p.provider_kind IS NULL AND guardian_private.adult_eligible(actor) THEN 'family_only'
   ELSE 'unconfigured' END;
 RETURN jsonb_build_object('access',access,
   'providerSetupHref','/onboarding?purpose=provider','passwordConfigured',configured);
END $$;
REVOKE ALL ON FUNCTION guardian_private.account_workspace() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION guardian_private.account_workspace() TO authenticated,service_role;

-- Authenticated and actor-bound. No password hash or unrelated-user lookup is
-- exposed. Password updates continue exclusively through Supabase Auth.
CREATE OR REPLACE FUNCTION public.get_guardian_access_context(p_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT guardian_private.context(p_token)||jsonb_build_object('workspace',guardian_private.account_workspace());
$$;
REVOKE ALL ON FUNCTION public.get_guardian_access_context(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_guardian_access_context(text) TO authenticated,service_role;

COMMIT;
