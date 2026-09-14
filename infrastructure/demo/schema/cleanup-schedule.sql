-- Only this isolated local demo. Retention is enforced by RLS immediately;
-- the persistent scheduler physically deletes expired visitor graphs every 5 minutes.
BEGIN;
DO $$ BEGIN
 IF current_setting('workfare.demo_target',true) IS DISTINCT FROM 'isolated-local-demo' THEN
  RAISE EXCEPTION 'Local demo target confirmation missing';
 END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('workfare-demo-expired-visits','*/5 * * * *',$job$
DO $cleanup$
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM demo_private.cleanup_expired_sessions(100);
END
$cleanup$;
$job$);
COMMIT;
