BEGIN;

-- Existing quotes have no historical description/note evidence. Keep that
-- absence explicit rather than backfilling today's mutable source text.
ALTER TABLE payment_private.orders
  ADD COLUMN scope_snapshot jsonb CHECK(scope_snapshot IS NULL OR
    (jsonb_typeof(scope_snapshot)='object' AND scope_snapshot->>'version'='1')),
  ADD COLUMN fingerprint_version text NOT NULL DEFAULT 'legacy-session-v1'
    CHECK(fingerprint_version IN('legacy-session-v1','utc-v2'));
ALTER TABLE payment_private.orders ALTER COLUMN fingerprint_version SET DEFAULT 'utc-v2';

CREATE FUNCTION payment_private.order_capture_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE description text; appointment_note text;
BEGIN
  -- order_create already holds application/job/engagement/appointment locks.
  -- No caller-supplied snapshot is accepted, including privileged inserts.
  SELECT j.description,a.note INTO description,appointment_note
  FROM public.job_appointments a
  JOIN public.job_engagements e ON e.id=a.engagement_id
  JOIN public.jobs j ON j.id=e.job_id
  WHERE a.id=NEW.appointment_id AND e.id=NEW.engagement_id
    AND e.application_id=NEW.application_id AND j.id=NEW.job_id
    AND e.provider_id=NEW.provider_id AND e.seeker_id=NEW.recipient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_ORDER_SOURCE_REQUIRED' USING ERRCODE='22023'; END IF;
  NEW.scope_snapshot:=jsonb_build_object('version',1,'description',description,'appointmentNote',appointment_note);
  NEW.fingerprint_version:='utc-v2';
  RETURN NEW;
END; $$;
CREATE TRIGGER payment_order_capture_scope BEFORE INSERT ON payment_private.orders
  FOR EACH ROW EXECUTE FUNCTION payment_private.order_capture_scope();
-- The existing immutable-quote trigger covers both new columns automatically.

CREATE FUNCTION payment_private.order_utc_fingerprint(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
  SELECT md5(jsonb_build_array(a.starts_at,a.ends_at,a.timezone,a.note)::text)
  FROM public.job_appointments a WHERE a.id=p_id;
$$;

CREATE OR REPLACE FUNCTION payment_private.order_fingerprint(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  -- Preserve the pre-migration behavior for any still-active legacy quote.
  -- New/replacement quotes always use UTC, independent of the RPC timezone.
  SELECT CASE WHEN EXISTS(SELECT FROM payment_private.orders o
      WHERE o.appointment_id=p_id AND o.fingerprint_version='legacy-session-v1'
        AND o.state NOT IN('canceled','refunded'))
    THEN (SELECT md5(jsonb_build_array(a.starts_at,a.ends_at,a.timezone,a.note)::text)
      FROM public.job_appointments a WHERE a.id=p_id)
    ELSE payment_private.order_utc_fingerprint(p_id) END;
$$;

REVOKE ALL ON FUNCTION payment_private.order_capture_scope(),payment_private.order_utc_fingerprint(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION payment_private.order_fingerprint(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION payment_private.order_fingerprint(uuid) TO service_role;

COMMIT;
