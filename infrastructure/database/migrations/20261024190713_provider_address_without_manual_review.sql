BEGIN;
-- Address submission is sufficient for the demo. Verification remains a separate
-- review signal; existing verified/rejected decisions and payment gates survive.
DO $migration$
DECLARE source text; modified text;
BEGIN
 source:=pg_get_functiondef('public.enforce_verified_provider_job_insert()'::regprocedure);
 modified:=replace(source,
 'AND provider.provider_verification_status = ''verified''::public.provider_verification_status
         AND provider.provider_verified_at IS NOT NULL',
 'AND provider.provider_verification_status <> ''rejected''::public.provider_verification_status
         AND nullif(btrim(provider.street), '''') IS NOT NULL
         AND nullif(btrim(provider.house_number), '''') IS NOT NULL
         AND nullif(btrim(provider.city), '''') IS NOT NULL
         AND nullif(btrim(provider.zip), '''') IS NOT NULL
         AND provider.lat BETWEEN -90 AND 90
         AND provider.lng BETWEEN -180 AND 180');
 IF source=modified THEN RAISE EXCEPTION 'Expected provider insert guard was not found'; END IF;
 modified:=replace(modified,'Jobs can only be created by a verified provider.','provider_address_required');
 EXECUTE modified;

 source:=pg_get_functiondef('payment_private.guard_job_publication()'::regprocedure);
 modified:=replace(source,
 'p.provider_verification_status=''verified'' AND p.provider_verified_at IS NOT NULL',
 'p.provider_verification_status<>''rejected'' AND nullif(btrim(p.street),'''') IS NOT NULL AND nullif(btrim(p.house_number),'''') IS NOT NULL AND nullif(btrim(p.city),'''') IS NOT NULL AND nullif(btrim(p.zip),'''') IS NOT NULL AND p.lat BETWEEN -90 AND 90 AND p.lng BETWEEN -180 AND 180');
 IF source=modified THEN RAISE EXCEPTION 'Expected payment publication address guard was not found'; END IF;
 modified:=replace(modified,'''provider_verification_required''','''provider_address_required''');
 EXECUTE modified;
END $migration$;
COMMIT;