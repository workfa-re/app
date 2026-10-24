BEGIN;

-- The invoker keeps the existing actor/age/family-upgrade guards. A failed
-- address write rolls the profile completion back in the same statement.
CREATE FUNCTION public.complete_provider_onboarding(
 p_full_name text,
 p_birthdate date,
 p_city text,
 p_market_id uuid,
 p_provider_kind public.provider_kind,
 p_street text,
 p_house_number text,
 p_address_city text,
 p_zip text,
 p_lat numeric,
 p_lng numeric,
 p_company_name text DEFAULT NULL,
 p_company_contact_email text DEFAULT NULL,
 p_company_message text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE completed jsonb; saved jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;
 IF p_provider_kind IS NULL OR p_provider_kind NOT IN ('private','company') THEN
   RETURN jsonb_build_object('ok',false,'error','provider_kind_required');
 END IF;
 IF nullif(btrim(p_street),'') IS NULL OR char_length(btrim(p_street))>160
   OR nullif(btrim(p_house_number),'') IS NULL OR char_length(btrim(p_house_number))>24
   OR nullif(btrim(p_address_city),'') IS NULL OR char_length(btrim(p_address_city))<2 OR char_length(btrim(p_address_city))>120
   OR p_zip IS NULL OR btrim(p_zip)!~'^[0-9]{5}$' THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_address');
 END IF;
 IF p_lat IS NULL OR p_lng IS NULL OR p_lat::text IN ('NaN','Infinity','-Infinity')
   OR p_lng::text IN ('NaN','Infinity','-Infinity') OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_coordinates');
 END IF;
 completed:=public.complete_profile_onboarding(p_full_name,p_birthdate,p_city,p_market_id,
   'job_provider'::public.account_type,p_provider_kind,p_company_name,p_company_contact_email,p_company_message);
 IF NOT coalesce((completed->>'ok')::boolean,false) THEN
   -- A lost successful response may be retried; matching saved input is not a
   -- new role switch, a new profile or a way to rewrite immutable birthdates.
   IF completed->>'error'='profile_already_complete' AND EXISTS(
     SELECT FROM public.profiles p WHERE p.id=auth.uid()
       AND p.account_type='job_provider' AND p.provider_kind=p_provider_kind
       AND p.full_name=btrim(p_full_name) AND p.birthdate=p_birthdate
       AND p.market_id IS NOT DISTINCT FROM p_market_id
       AND p.company_name IS NOT DISTINCT FROM CASE WHEN p_provider_kind='company' THEN nullif(btrim(p_company_name),'') ELSE NULL END
       AND p.company_contact_email IS NOT DISTINCT FROM CASE WHEN p_provider_kind='company' THEN nullif(lower(btrim(p_company_contact_email)),'') ELSE NULL END
       AND p.company_message IS NOT DISTINCT FROM CASE WHEN p_provider_kind='company' THEN nullif(btrim(p_company_message),'') ELSE NULL END
       AND p.street=btrim(p_street) AND p.house_number=btrim(p_house_number)
       AND p.city=btrim(p_address_city) AND p.zip=btrim(p_zip)
       AND p.lat=p_lat::double precision AND p.lng=p_lng::double precision
   ) THEN RETURN jsonb_build_object('ok',true,'unchanged',true); END IF;
   RETURN completed;
 END IF;
 saved:=public.request_provider_verification(p_street,p_house_number,p_address_city,p_zip,p_lat,p_lng);
 IF NOT coalesce((saved->>'ok')::boolean,false) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='provider_onboarding_address_failed',DETAIL=coalesce(saved->>'error','invalid_address');
 END IF;
 RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
 IF SQLERRM<>'provider_onboarding_address_failed' THEN RAISE; END IF;
 RETURN jsonb_build_object('ok',false,'error','invalid_address');
END $$;
REVOKE ALL ON FUNCTION public.complete_provider_onboarding(text,date,text,uuid,public.provider_kind,text,text,text,text,numeric,numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_provider_onboarding(text,date,text,uuid,public.provider_kind,text,text,text,text,numeric,numeric,text,text,text) TO authenticated,service_role;

-- Existing recurring jobs and their appointments remain editable. New jobs
-- and later one-off-to-recurring conversions use the same one-time rule.
CREATE FUNCTION activity_private.enforce_one_time_job_creation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.job_kind IS DISTINCT FROM 'one_time' THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='one_time_jobs_only';
   END IF;
 ELSIF OLD.job_kind IS DISTINCT FROM 'recurring' AND NEW.job_kind='recurring' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='one_time_jobs_only';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION activity_private.enforce_one_time_job_creation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER enforce_one_time_job_creation BEFORE INSERT OR UPDATE OF job_kind ON public.jobs
FOR EACH ROW EXECUTE FUNCTION activity_private.enforce_one_time_job_creation();

COMMIT;
