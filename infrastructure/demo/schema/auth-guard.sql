-- Local demo only. Apply after isolation.sql/service-api.sql and Auth baseline triggers.
BEGIN;
DO $$ BEGIN
 IF current_setting('workfare.demo_target',true) IS DISTINCT FROM 'isolated-local-demo' THEN
   RAISE EXCEPTION 'Local demo target confirmation missing';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION demo_private.guard_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_visit_id uuid; v_alias text; v_email text; v_parts text[];
BEGIN
 -- GoTrue AdminCreate first INSERTs provider metadata, then writes custom
 -- app_metadata in the same transaction. Validate the issued address now and
 -- require the final administrator-only binding at transaction commit below.
 v_parts := regexp_match(lower(COALESCE(NEW.email,'')),
   '^demo\+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(seeker|private-provider|company|guardian|peer-seeker)@example\.test$');
 IF v_parts IS NULL THEN
   RAISE EXCEPTION 'Only issued demo email identities are allowed' USING ERRCODE='42501';
 END IF;
 v_visit_id := v_parts[1]::uuid; v_alias := v_parts[2]; v_email := lower(NEW.email);
 IF NULLIF(NEW.phone,'') IS NOT NULL OR NULLIF(NEW.phone_change,'') IS NOT NULL
    OR (NULLIF(NEW.email_change,'') IS NOT NULL AND lower(NEW.email_change)<>v_email) THEN
   RAISE EXCEPTION 'Demo accounts cannot use external contact identities' USING ERRCODE='42501';
 END IF;
 IF (NEW.raw_app_meta_data ? 'demo_session_id' OR NEW.raw_app_meta_data ? 'demo_identity')
    AND (NEW.raw_app_meta_data->>'demo_session_id' IS DISTINCT FROM v_visit_id::text
      OR NEW.raw_app_meta_data->>'demo_identity' IS DISTINCT FROM v_alias) THEN
   RAISE EXCEPTION 'Invalid demo identity binding' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND (
     NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email
     OR ((OLD.raw_app_meta_data ? 'demo_session_id' OR OLD.raw_app_meta_data ? 'demo_identity')
       AND (NEW.raw_app_meta_data->>'demo_session_id' IS DISTINCT FROM OLD.raw_app_meta_data->>'demo_session_id'
         OR NEW.raw_app_meta_data->>'demo_identity' IS DISTINCT FROM OLD.raw_app_meta_data->>'demo_identity'))
   ) THEN
   RAISE EXCEPTION 'Demo identity bindings are immutable' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM demo_private.visits WHERE id=v_visit_id AND revoked_at IS NULL
     AND expires_at>statement_timestamp()) THEN
   RAISE EXCEPTION 'Active demo visit required' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION demo_private.guard_auth_user() FROM PUBLIC,anon,authenticated,demo_executor;
GRANT EXECUTE ON FUNCTION demo_private.guard_auth_user() TO service_role,supabase_auth_admin;
DROP TRIGGER IF EXISTS demo_guard_auth_user ON auth.users;
CREATE TRIGGER demo_guard_auth_user BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION demo_private.guard_auth_user();

CREATE OR REPLACE FUNCTION demo_private.require_final_auth_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user auth.users%ROWTYPE;
BEGIN
 SELECT * INTO v_user FROM auth.users WHERE id=NEW.id;
 -- A user inserted and deleted inside the same transaction leaves no account.
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT FROM demo_private.visits v
     WHERE v.id::text=v_user.raw_app_meta_data->>'demo_session_id'
       AND v.revoked_at IS NULL AND v.expires_at>statement_timestamp()
       AND v_user.raw_app_meta_data->>'demo_identity' IN ('seeker','private-provider','company','guardian','peer-seeker')
       AND lower(v_user.email)='demo+'||v.id::text||'.'||(v_user.raw_app_meta_data->>'demo_identity')||'@example.test') THEN
   RAISE EXCEPTION 'Final administrator-issued demo binding required' USING ERRCODE='42501';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION demo_private.require_final_auth_binding() FROM PUBLIC,anon,authenticated,demo_executor;
GRANT EXECUTE ON FUNCTION demo_private.require_final_auth_binding() TO service_role,supabase_auth_admin;
DROP TRIGGER IF EXISTS demo_require_final_auth_binding ON auth.users;
CREATE CONSTRAINT TRIGGER demo_require_final_auth_binding AFTER INSERT OR UPDATE ON auth.users
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION demo_private.require_final_auth_binding();

-- Defense in depth if an OAuth/manual-link provider is accidentally enabled later.
CREATE OR REPLACE FUNCTION demo_private.guard_auth_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text;
BEGIN
 SELECT lower(email) INTO v_email FROM auth.users WHERE id=NEW.user_id;
 IF NEW.provider IS DISTINCT FROM 'email' OR v_email IS NULL
    OR lower(COALESCE(NEW.identity_data->>'email',''))<>v_email THEN
   RAISE EXCEPTION 'Only the issued demo email identity may be linked' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.provider IS DISTINCT FROM OLD.provider) THEN
   RAISE EXCEPTION 'Demo identity ownership is immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION demo_private.guard_auth_identity() FROM PUBLIC,anon,authenticated,demo_executor;
GRANT EXECUTE ON FUNCTION demo_private.guard_auth_identity() TO service_role,supabase_auth_admin;
DROP TRIGGER IF EXISTS demo_guard_auth_identity ON auth.identities;
CREATE TRIGGER demo_guard_auth_identity BEFORE INSERT OR UPDATE ON auth.identities
  FOR EACH ROW EXECUTE FUNCTION demo_private.guard_auth_identity();
COMMIT;
