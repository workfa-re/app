BEGIN;

-- Old private-provider stubs with a known birthdate may finish their missing
-- city/market on the same identity. Complete profiles, companies, role changes
-- and birthdate changes remain blocked by the existing one-time guard.
DO $$
DECLARE source text; modified text;
BEGIN
 source:=pg_get_functiondef('public.complete_profile_onboarding(text,date,text,uuid,public.account_type,public.provider_kind,text,text,text)'::regprocedure);
 modified:=replace(source,
   'target.account_type IS NULL AND target.provider_kind IS NULL
    AND target.birthdate = EXCLUDED.birthdate',
   '((target.account_type IS NULL AND target.provider_kind IS NULL) OR (
      target.account_type = ''job_provider''::public.account_type
      AND target.provider_kind = ''private''::public.provider_kind
      AND nullif(btrim(target.city),'''') IS NULL))
    AND target.birthdate = EXCLUDED.birthdate');
 IF source=modified THEN RAISE EXCEPTION 'Expected purpose-account onboarding guard was not found'; END IF;
 EXECUTE modified;
END $$;

COMMIT;
