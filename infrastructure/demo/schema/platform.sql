


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."account_type" AS ENUM (
    'job_seeker',
    'job_provider'
);


ALTER TYPE "public"."account_type" OWNER TO "postgres";


CREATE TYPE "public"."account_type_legacy" AS ENUM (
    'teen',
    'parent',
    'provider',
    'org'
);


ALTER TYPE "public"."account_type_legacy" OWNER TO "postgres";


CREATE TYPE "public"."application_status" AS ENUM (
    'submitted',
    'withdrawn',
    'accepted',
    'rejected',
    'auto_rejected',
    'completed',
    'cancelled',
    'negotiating',
    'waitlisted'
);


ALTER TYPE "public"."application_status" OWNER TO "postgres";


CREATE TYPE "public"."guardian_status" AS ENUM (
    'none',
    'pending',
    'linked'
);


ALTER TYPE "public"."guardian_status" OWNER TO "postgres";


CREATE TYPE "public"."hiring_mode" AS ENUM (
    'open_pool',
    'first_come',
    'direct_hire'
);


ALTER TYPE "public"."hiring_mode" OWNER TO "postgres";


CREATE TYPE "public"."job_status" AS ENUM (
    'draft',
    'open',
    'closed',
    'reviewing',
    'reserved',
    'filled'
);


ALTER TYPE "public"."job_status" OWNER TO "postgres";


CREATE TYPE "public"."provider_kind" AS ENUM (
    'private',
    'company'
);


ALTER TYPE "public"."provider_kind" OWNER TO "postgres";


CREATE TYPE "public"."provider_verification_status" AS ENUM (
    'none',
    'pending',
    'verified',
    'rejected'
);


ALTER TYPE "public"."provider_verification_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_activity_close_application"("p_application_id" "uuid", "p_actor_id" "uuid", "p_action" "text", "p_reason" "text", "p_status" "public"."application_status") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_app record;
  v_rebalance jsonb := NULL;
BEGIN
  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.status,
    a.is_primary,
    a.conversation_state,
    a.closed_by,
    a.close_action,
    j.posted_by,
    j.title,
    j.status AS job_status,
    j.filled_by
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;

  IF v_app.conversation_state = 'closed'
     AND v_app.closed_by = p_actor_id
     AND v_app.close_action = p_action THEN
    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'job_id', v_app.job_id,
      'job_title', v_app.title,
      'seeker_id', v_app.user_id,
      'provider_id', v_app.posted_by
    );
  END IF;

  IF v_app.conversation_state = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieses Gespräch ist bereits geschlossen.');
  END IF;

  UPDATE public.applications
  SET status = p_status,
      rejection_reason = p_reason,
      conversation_state = 'closed',
      closed_by = p_actor_id,
      closed_at = now(),
      closed_reason = p_reason,
      close_action = p_action,
      closed_from_status = v_app.status,
      was_primary_before_close = v_app.is_primary,
      closure_version = closure_version + 1,
      is_primary = false,
      reopened_at = NULL,
      reopened_by = NULL,
      updated_at = now()
  WHERE id = p_application_id;

  UPDATE public.job_engagements
  SET status = 'cancelled',
      cancelled_at = now(),
      closed_by = p_actor_id,
      close_reason = p_reason,
      updated_at = now()
  WHERE application_id = p_application_id
    AND status = 'active';

  UPDATE public.job_appointments appointment
  SET status = 'cancelled',
      updated_at = now()
  FROM public.job_engagements engagement
  WHERE engagement.application_id = p_application_id
    AND appointment.engagement_id = engagement.id
    AND appointment.status = 'scheduled';

  UPDATE public.job_agreements
  SET status = 'cancelled',
      updated_at = now()
  WHERE application_id = p_application_id
    AND status = 'confirmed';

  IF v_app.filled_by = v_app.user_id THEN
    UPDATE public.jobs
    SET status = 'open',
        filled_by = NULL,
        filled_at = NULL,
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_app.job_id;
  END IF;

  INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
  VALUES (
    p_application_id,
    p_actor_id,
    p_action,
    p_reason,
    jsonb_build_object(
      'previous_status', v_app.status,
      'was_primary', v_app.is_primary,
      'job_id', v_app.job_id
    )
  );

  IF v_app.is_primary OR v_app.status = 'accepted' THEN
    v_rebalance := public._activity_rebalance_job(v_app.job_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_app.job_id,
    'job_title', v_app.title,
    'seeker_id', v_app.user_id,
    'provider_id', v_app.posted_by,
    'was_primary', v_app.is_primary,
    'rebalance', v_rebalance
  );
END;
$$;


ALTER FUNCTION "public"."_activity_close_application"("p_application_id" "uuid", "p_actor_id" "uuid", "p_action" "text", "p_reason" "text", "p_status" "public"."application_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_activity_rebalance_job"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_primary record;
  v_candidate record;
BEGIN
  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job nicht gefunden.');
  END IF;

  IF v_job.status = 'filled' AND v_job.filled_by IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'action', 'assigned');
  END IF;

  SELECT a.id, a.user_id, a.status
  INTO v_primary
  FROM public.applications a
  WHERE a.job_id = p_job_id
    AND a.is_primary
    AND a.conversation_state = 'open'
    AND a.status IN ('submitted', 'negotiating', 'accepted')
  ORDER BY a.queue_position, a.created_at, a.id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.jobs
    SET status = CASE WHEN v_primary.status = 'accepted' THEN 'filled'::public.job_status ELSE 'reserved'::public.job_status END,
        filled_by = CASE WHEN v_primary.status = 'accepted' THEN v_primary.user_id ELSE NULL END,
        filled_at = CASE WHEN v_primary.status = 'accepted' THEN COALESCE(filled_at, now()) ELSE NULL END,
        completed_at = NULL,
        updated_at = now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object('ok', true, 'action', 'primary_kept', 'application_id', v_primary.id);
  END IF;

  SELECT a.id, a.user_id, COALESCE(NULLIF(btrim(p.full_name), ''), 'Eine Person') AS display_name
  INTO v_candidate
  FROM public.applications a
  JOIN public.profiles p ON p.id = a.user_id
  WHERE a.job_id = p_job_id
    AND a.status = 'waitlisted'
    AND a.conversation_state = 'open'
  ORDER BY a.queue_position, a.created_at, a.id
  LIMIT 1
  FOR UPDATE OF a;

  IF FOUND THEN
    UPDATE public.applications
    SET status = 'negotiating',
        is_primary = true,
        promoted_at = now(),
        promoted_by = NULL,
        promotion_reason = 'Automatisch nach frei gewordenem Gespräch nachgerückt.',
        updated_at = now()
    WHERE id = v_candidate.id;

    UPDATE public.jobs
    SET status = 'reserved',
        filled_by = NULL,
        filled_at = NULL,
        completed_at = NULL,
        updated_at = now()
    WHERE id = p_job_id;

    INSERT INTO public.application_events (application_id, event_type, reason, metadata)
    VALUES (
      v_candidate.id,
      'queue_promoted_automatically',
      'Automatisch aus der Warteliste nachgerückt.',
      jsonb_build_object('job_id', p_job_id)
    );

    INSERT INTO public.messages (application_id, sender_id, content, kind)
    VALUES (
      v_candidate.id,
      v_job.posted_by,
      'Du bist aus der Warteliste nachgerückt. Dieses Gespräch ist jetzt geöffnet.',
      'system'
    );

    INSERT INTO public.notifications (user_id, type, title, body, data, category)
    VALUES (
      v_candidate.user_id,
      'application_status',
      'Du bist nachgerückt',
      'Für „' || v_job.title || '“ ist das Gespräch jetzt für dich geöffnet.',
      jsonb_build_object(
        'route', '/app-home/activities?conversation=' || v_candidate.id::text,
        'application_id', v_candidate.id,
        'job_id', p_job_id
      ),
      'waitlist'
    );

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'promoted',
      'application_id', v_candidate.id,
      'user_id', v_candidate.user_id,
      'display_name', v_candidate.display_name
    );
  END IF;

  UPDATE public.jobs
  SET status = 'open',
      filled_by = NULL,
      filled_at = NULL,
      completed_at = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND status IN ('reserved', 'reviewing', 'filled');

  RETURN jsonb_build_object('ok', true, 'action', 'job_reopened');
END;
$$;


ALTER FUNCTION "public"."_activity_rebalance_job"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_activity_reopen_application"("p_application_id" "uuid", "p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_app record;
  v_has_other_primary boolean;
  v_new_status public.application_status;
  v_new_primary boolean;
BEGIN
  SELECT
    a.*,
    j.posted_by,
    j.title AS job_title,
    j.status AS job_status,
    j.filled_by
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.conversation_state = 'open' THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'application', to_jsonb(v_app));
  END IF;
  IF v_app.closed_by IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur die Person, die das Gespräch geschlossen hat, kann es wieder öffnen.');
  END IF;
  IF v_app.close_action NOT IN ('provider_rejected', 'seeker_withdrew', 'engagement_completed', 'engagement_cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Schließung kann nicht rückgängig gemacht werden.');
  END IF;
  IF v_app.filled_by IS NOT NULL AND v_app.filled_by <> v_app.user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Job ist inzwischen verbindlich anderweitig vergeben.');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.applications other
    WHERE other.job_id = v_app.job_id
      AND other.id <> p_application_id
      AND other.is_primary
      AND other.conversation_state = 'open'
      AND other.status IN ('submitted', 'negotiating', 'accepted')
  ) INTO v_has_other_primary;

  IF v_app.close_action = 'engagement_completed' THEN
    IF v_has_other_primary THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Der Platz ist inzwischen anderweitig belegt.');
    END IF;

    UPDATE public.job_engagements
    SET status = 'active',
        completed_at = NULL,
        cancelled_at = NULL,
        closed_by = NULL,
        close_reason = NULL,
        updated_at = now()
    WHERE application_id = p_application_id;

    v_new_status := 'accepted';
    v_new_primary := true;
  ELSIF v_app.filled_by = v_app.user_id THEN
    v_new_status := 'accepted';
    v_new_primary := true;
  ELSIF NOT v_has_other_primary THEN
    v_new_status := 'negotiating';
    v_new_primary := true;
  ELSE
    v_new_status := 'waitlisted';
    v_new_primary := false;
  END IF;

  UPDATE public.applications
  SET status = v_new_status,
      conversation_state = 'open',
      is_primary = v_new_primary,
      rejection_reason = NULL,
      reopened_at = now(),
      reopened_by = p_actor_id,
      closed_by = NULL,
      closed_at = NULL,
      closed_reason = NULL,
      close_action = NULL,
      closed_from_status = NULL,
      was_primary_before_close = false,
      updated_at = now()
  WHERE id = p_application_id;

  IF v_new_status = 'accepted' THEN
    UPDATE public.jobs
    SET status = 'filled',
        filled_by = v_app.user_id,
        filled_at = COALESCE(filled_at, now()),
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_app.job_id;
  ELSIF v_new_primary THEN
    UPDATE public.jobs
    SET status = 'reserved',
        filled_by = NULL,
        filled_at = NULL,
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_app.job_id;
  END IF;

  UPDATE public.conversation_reopen_requests
  SET status = 'accepted',
      resolved_at = now(),
      resolved_by = p_actor_id
  WHERE application_id = p_application_id
    AND closure_version = v_app.closure_version
    AND recipient_id = p_actor_id
    AND status = 'pending';

  INSERT INTO public.application_events (application_id, actor_id, event_type, metadata)
  VALUES (
    p_application_id,
    p_actor_id,
    'conversation_reopened',
    jsonb_build_object(
      'previous_action', v_app.close_action,
      'restored_status', v_new_status,
      'restored_as_primary', v_new_primary,
      'closure_version', v_app.closure_version
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', p_application_id,
    'job_id', v_app.job_id,
    'job_title', v_app.job_title,
    'seeker_id', v_app.user_id,
    'provider_id', v_app.posted_by,
    'status', v_new_status,
    'is_primary', v_new_primary
  );
END;
$$;


ALTER FUNCTION "public"."_activity_reopen_application"("p_application_id" "uuid", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_rebalance_job_after_application_exit"("p_job_id" "uuid", "p_exiting_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_job record;
  v_active record;
  v_waitlisted record;
BEGIN
  SELECT id, title, status, posted_by, filled_by
  INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.status NOT IN ('reserved', 'filled') THEN
    RETURN jsonb_build_object('ok', true, 'action', 'unchanged');
  END IF;

  IF v_job.status = 'filled' AND v_job.filled_by IS DISTINCT FROM p_exiting_user_id THEN
    RETURN jsonb_build_object('ok', true, 'action', 'unchanged_other_assignment');
  END IF;

  SELECT id, user_id
  INTO v_active
  FROM public.applications
  WHERE job_id = p_job_id
    AND user_id IS DISTINCT FROM p_exiting_user_id
    AND status = 'accepted'
  ORDER BY created_at, id
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.jobs
    SET status = 'filled', filled_by = v_active.user_id, filled_at = COALESCE(filled_at, now())
    WHERE id = p_job_id;
    RETURN jsonb_build_object('ok', true, 'action', 'kept_filled');
  END IF;

  SELECT id, user_id
  INTO v_active
  FROM public.applications
  WHERE job_id = p_job_id
    AND user_id IS DISTINCT FROM p_exiting_user_id
    AND status = 'negotiating'
  ORDER BY created_at, id
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.jobs
    SET status = 'reserved', filled_by = NULL, filled_at = NULL
    WHERE id = p_job_id;
    RETURN jsonb_build_object('ok', true, 'action', 'kept_reserved');
  END IF;

  SELECT id, user_id
  INTO v_waitlisted
  FROM public.applications
  WHERE job_id = p_job_id
    AND status = 'waitlisted'
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.applications
    SET status = 'negotiating'
    WHERE id = v_waitlisted.id;

    UPDATE public.jobs
    SET status = 'reserved', filled_by = NULL, filled_at = NULL
    WHERE id = p_job_id;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_waitlisted.user_id,
      'info',
      'Platz im Gespräch frei',
      'Deine Bewerbung für „' || v_job.title || '“ ist jetzt aktiv.',
      jsonb_build_object(
        'route', '/app-home/activities?conversation=' || v_waitlisted.id::text,
        'application_id', v_waitlisted.id,
        'job_id', p_job_id
      )
    );

    RETURN jsonb_build_object('ok', true, 'action', 'promoted_waitlist', 'application_id', v_waitlisted.id);
  END IF;

  UPDATE public.jobs
  SET status = 'open', filled_by = NULL, filled_at = NULL
  WHERE id = p_job_id
    AND status IN ('reserved', 'filled');

  RETURN jsonb_build_object('ok', true, 'action', 'reopened');
END;
$$;


ALTER FUNCTION "public"."_rebalance_job_after_application_exit"("p_job_id" "uuid", "p_exiting_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_distance"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) RETURNS double precision
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    R float := 6371;
    dLat float := radians(lat2 - lat1);
    dLon float := radians(lon2 - lon1);
    a float := sin(dLat / 2) * sin(dLat / 2) +
               cos(radians(lat1)) * cos(radians(lat2)) *
               sin(dLon / 2) * sin(dLon / 2);
    c float := 2 * atan2(sqrt(a), sqrt(1 - a));
BEGIN
    RETURN R * c;
END;
$$;


ALTER FUNCTION "public"."calculate_distance"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_job_engagement"("p_application_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'Zusammenarbeit abgeschlossen.');
  v_app record;
  v_engagement public.job_engagements%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Abschlussgrund darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.status,
    a.is_primary,
    a.conversation_state,
    j.posted_by,
    j.title,
    j.job_kind
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.posted_by <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Anbieter kann die Zusammenarbeit abschließen.');
  END IF;
  IF v_app.status = 'completed' AND v_app.conversation_state = 'closed' THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;
  IF v_app.status <> 'accepted' OR v_app.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Es gibt keine aktive Zusammenarbeit zum Abschließen.');
  END IF;

  UPDATE public.job_engagements
  SET status = 'completed',
      completed_at = now(),
      cancelled_at = NULL,
      closed_by = v_user_id,
      close_reason = v_reason,
      updated_at = now()
  WHERE application_id = p_application_id
    AND status = 'active'
  RETURNING * INTO v_engagement;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Zusammenarbeit wurde nicht gefunden.');
  END IF;

  UPDATE public.job_appointments
  SET status = CASE WHEN starts_at <= now() THEN 'completed' ELSE 'cancelled' END,
      updated_at = now()
  WHERE engagement_id = v_engagement.id
    AND status = 'scheduled';

  UPDATE public.job_agreements
  SET status = 'completed', updated_at = now()
  WHERE application_id = p_application_id;

  UPDATE public.applications
  SET status = 'completed',
      conversation_state = 'closed',
      closed_by = v_user_id,
      closed_at = now(),
      closed_reason = v_reason,
      close_action = 'engagement_completed',
      closed_from_status = v_app.status,
      was_primary_before_close = v_app.is_primary,
      closure_version = closure_version + 1,
      is_primary = false,
      updated_at = now()
  WHERE id = p_application_id;

  UPDATE public.jobs
  SET status = 'closed',
      completed_at = now(),
      updated_at = now()
  WHERE id = v_app.job_id;

  INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
  VALUES (
    p_application_id,
    v_user_id,
    'engagement_completed',
    v_reason,
    jsonb_build_object('engagement_id', v_engagement.id, 'job_kind', v_app.job_kind)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_app.user_id,
    'application_status',
    'Zusammenarbeit abgeschlossen',
    'Die Zusammenarbeit zu „' || v_app.title || '“ wurde als abgeschlossen markiert.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_app.job_id,
      'engagement_id', v_engagement.id
    )
  );

  RETURN jsonb_build_object('ok', true, 'engagement', to_jsonb(v_engagement));
END;
$$;


ALTER FUNCTION "public"."complete_job_engagement"("p_application_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_profile_onboarding"("p_full_name" "text", "p_birthdate" "date", "p_city" "text", "p_market_id" "uuid", "p_account_type" "public"."account_type", "p_provider_kind" "public"."provider_kind", "p_company_name" "text", "p_company_contact_email" "text", "p_company_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_full_name text := nullif(btrim(p_full_name), '');
  v_city text := nullif(btrim(p_city), '');
  v_company_name text := nullif(btrim(p_company_name), '');
  v_company_contact_email text := nullif(lower(btrim(p_company_contact_email)), '');
  v_company_message text := nullif(btrim(p_company_message), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF v_full_name IS NULL
     OR char_length(v_full_name) < 2
     OR char_length(v_full_name) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_full_name');
  END IF;
  IF v_city IS NULL OR char_length(v_city) < 2 OR char_length(v_city) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_city');
  END IF;
  IF p_birthdate IS NULL
     OR p_birthdate > current_date
     OR p_birthdate < (current_date - interval '120 years')::date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_birthdate');
  END IF;
  IF p_account_type IS NULL
     OR p_account_type NOT IN (
       'job_seeker'::public.account_type,
       'job_provider'::public.account_type
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_account_type');
  END IF;
  IF p_market_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.regions_live region
       WHERE region.id = p_market_id
         AND region.is_live IS TRUE
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_market');
  END IF;

  IF p_account_type = 'job_seeker'::public.account_type
     AND (
       p_birthdate > (current_date - interval '14 years')::date
       OR p_birthdate <= (current_date - interval '21 years')::date
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seeker_age_out_of_range');
  END IF;
  IF p_account_type = 'job_provider'::public.account_type
     AND p_birthdate > (current_date - interval '18 years')::date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_must_be_adult');
  END IF;
  IF p_account_type = 'job_provider'::public.account_type
     AND p_provider_kind IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_kind_required');
  END IF;
  IF p_account_type = 'job_seeker'::public.account_type
     AND p_provider_kind IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_provider_kind');
  END IF;

  IF p_provider_kind = 'company'::public.provider_kind
     AND (v_company_name IS NULL OR char_length(v_company_name) > 160) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_name_required');
  END IF;
  IF v_company_contact_email IS NOT NULL
     AND (
       char_length(v_company_contact_email) > 254
       OR v_company_contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_company_email');
  END IF;
  IF v_company_message IS NOT NULL AND char_length(v_company_message) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_message_too_long');
  END IF;

  -- birthdate is not directly writable and therefore acts as an irreversible,
  -- race-safe onboarding sentinel. A completed profile cannot be reopened.
  INSERT INTO public.profiles AS target (
    id,
    full_name,
    birthdate,
    city,
    market_id,
    account_type,
    provider_kind,
    company_name,
    company_contact_email,
    company_message,
    provider_verification_status,
    provider_verified_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_full_name,
    p_birthdate,
    v_city,
    p_market_id,
    p_account_type,
    CASE
      WHEN p_account_type = 'job_provider'::public.account_type THEN p_provider_kind
      ELSE NULL
    END,
    CASE WHEN p_provider_kind = 'company'::public.provider_kind THEN v_company_name ELSE NULL END,
    CASE WHEN p_provider_kind = 'company'::public.provider_kind THEN v_company_contact_email ELSE NULL END,
    CASE WHEN p_provider_kind = 'company'::public.provider_kind THEN v_company_message ELSE NULL END,
    'none'::public.provider_verification_status,
    NULL,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      birthdate = EXCLUDED.birthdate,
      city = EXCLUDED.city,
      market_id = EXCLUDED.market_id,
      account_type = EXCLUDED.account_type,
      provider_kind = EXCLUDED.provider_kind,
      company_name = EXCLUDED.company_name,
      company_contact_email = EXCLUDED.company_contact_email,
      company_message = EXCLUDED.company_message,
      provider_verification_status = 'none'::public.provider_verification_status,
      provider_verified_at = NULL,
      updated_at = now()
  WHERE target.birthdate IS NULL
  RETURNING target.* INTO v_profile;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profile_already_complete');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$_$;


ALTER FUNCTION "public"."complete_profile_onboarding"("p_full_name" "text", "p_birthdate" "date", "p_city" "text", "p_market_id" "uuid", "p_account_type" "public"."account_type", "p_provider_kind" "public"."provider_kind", "p_company_name" "text", "p_company_contact_email" "text", "p_company_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_job_engagement"("p_application_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_timezone" "text" DEFAULT 'Europe/Berlin'::"text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_timezone text := COALESCE(NULLIF(btrim(p_timezone), ''), 'Europe/Berlin');
  v_note text := NULLIF(btrim(p_note), '');
  v_app record;
  v_engagement public.job_engagements%ROWTYPE;
  v_appointment public.job_appointments%ROWTYPE;
  v_existing_appointment public.job_appointments%ROWTYPE;
  v_closed_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF p_starts_at IS NULL OR p_starts_at < now() - interval '1 minute' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Termin muss in der Zukunft liegen.');
  END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Das Ende muss nach dem Beginn liegen.');
  END IF;
  IF char_length(v_timezone) > 80 OR char_length(COALESCE(v_note, '')) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Termindaten sind zu lang.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_timezone) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unbekannte Zeitzone.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.status,
    a.is_primary,
    a.conversation_state,
    j.posted_by,
    j.title,
    j.status AS job_status,
    j.filled_by,
    j.job_kind
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.posted_by <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Anbieter kann einen Termin festlegen.');
  END IF;
  IF v_app.conversation_state <> 'open'
     OR NOT v_app.is_primary
     OR v_app.status NOT IN ('submitted', 'negotiating', 'accepted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur die aktive Bewerbung auf Platz 1 kann verbindlich vereinbart werden.');
  END IF;
  IF v_app.job_status = 'filled' AND v_app.filled_by IS DISTINCT FROM v_app.user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Job ist bereits anderweitig vergeben.');
  END IF;
  IF v_app.job_status NOT IN ('open', 'reviewing', 'reserved', 'filled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieser Job kann nicht mehr vereinbart werden.');
  END IF;

  INSERT INTO public.job_engagements (
    application_id,
    job_id,
    provider_id,
    seeker_id,
    engagement_type,
    status,
    started_at
  ) VALUES (
    p_application_id,
    v_app.job_id,
    v_app.posted_by,
    v_app.user_id,
    v_app.job_kind,
    'active',
    now()
  )
  ON CONFLICT (application_id) DO UPDATE
  SET job_id = EXCLUDED.job_id,
      provider_id = EXCLUDED.provider_id,
      seeker_id = EXCLUDED.seeker_id,
      engagement_type = EXCLUDED.engagement_type,
      status = 'active',
      completed_at = NULL,
      cancelled_at = NULL,
      closed_by = NULL,
      close_reason = NULL,
      updated_at = now()
  RETURNING * INTO v_engagement;

  IF v_app.job_kind = 'one_time' THEN
    SELECT * INTO v_existing_appointment
    FROM public.job_appointments
    WHERE engagement_id = v_engagement.id
      AND status = 'scheduled'
    ORDER BY starts_at, id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_existing_appointment.id IS NOT NULL THEN
    UPDATE public.job_appointments
    SET starts_at = p_starts_at,
        ends_at = p_ends_at,
        timezone = v_timezone,
        note = v_note,
        status = 'scheduled',
        created_by = v_user_id,
        updated_at = now()
    WHERE id = v_existing_appointment.id
    RETURNING * INTO v_appointment;
  ELSE
    INSERT INTO public.job_appointments (
      engagement_id,
      starts_at,
      ends_at,
      timezone,
      note,
      status,
      created_by
    ) VALUES (
      v_engagement.id,
      p_starts_at,
      p_ends_at,
      v_timezone,
      v_note,
      'scheduled',
      v_user_id
    )
    RETURNING * INTO v_appointment;
  END IF;

  INSERT INTO public.job_agreements (
    application_id,
    job_id,
    provider_id,
    seeker_id,
    starts_at,
    ends_at,
    timezone,
    note,
    status
  ) VALUES (
    p_application_id,
    v_app.job_id,
    v_app.posted_by,
    v_app.user_id,
    p_starts_at,
    p_ends_at,
    v_timezone,
    v_note,
    'confirmed'
  )
  ON CONFLICT (application_id) DO UPDATE
  SET starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      timezone = EXCLUDED.timezone,
      note = EXCLUDED.note,
      status = 'confirmed',
      updated_at = now();

  UPDATE public.applications
  SET status = 'accepted',
      is_primary = true,
      conversation_state = 'open',
      rejection_reason = NULL,
      updated_at = now()
  WHERE id = p_application_id;

  WITH closed AS (
    UPDATE public.applications other
    SET closed_from_status = other.status,
        status = 'auto_rejected',
        rejection_reason = 'Der Job wurde verbindlich vergeben.',
        conversation_state = 'closed',
        closed_by = NULL,
        closed_at = now(),
        closed_reason = 'Der Job wurde verbindlich vergeben.',
        close_action = 'job_assigned',
        was_primary_before_close = other.is_primary,
        closure_version = other.closure_version + 1,
        is_primary = false,
        updated_at = now()
    WHERE other.job_id = v_app.job_id
      AND other.id <> p_application_id
      AND other.conversation_state = 'open'
      AND other.status IN ('submitted', 'negotiating', 'waitlisted')
    RETURNING other.id, other.user_id, other.closed_from_status
  ), logged AS (
    INSERT INTO public.application_events (application_id, event_type, reason, metadata)
    SELECT
      closed.id,
      'job_assigned_elsewhere',
      'Der Job wurde verbindlich vergeben.',
      jsonb_build_object('selected_application_id', p_application_id, 'previous_status', closed.closed_from_status)
    FROM closed
    RETURNING application_id
  )
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    closed.user_id,
    'application_status',
    'Job verbindlich vergeben',
    'Der Job „' || v_app.title || '“ wurde verbindlich an eine andere Person vergeben.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || closed.id::text,
      'application_id', closed.id,
      'job_id', v_app.job_id
    )
  FROM closed;
  GET DIAGNOSTICS v_closed_count = ROW_COUNT;

  UPDATE public.jobs
  SET status = 'filled',
      filled_by = v_app.user_id,
      filled_at = COALESCE(filled_at, now()),
      completed_at = NULL,
      updated_at = now()
  WHERE id = v_app.job_id;

  INSERT INTO public.messages (application_id, sender_id, content, kind)
  VALUES (
    p_application_id,
    v_user_id,
    CASE
      WHEN v_app.job_kind = 'recurring' THEN 'Ein weiterer Termin wurde verbindlich vereinbart.'
      ELSE 'Der Termin wurde verbindlich vereinbart.'
    END,
    'system'
  );

  INSERT INTO public.application_events (application_id, actor_id, event_type, metadata)
  VALUES (
    p_application_id,
    v_user_id,
    'appointment_scheduled',
    jsonb_build_object(
      'engagement_id', v_engagement.id,
      'appointment_id', v_appointment.id,
      'starts_at', p_starts_at,
      'job_kind', v_app.job_kind,
      'closed_other_applications', v_closed_count
    )
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_app.user_id,
    'success',
    CASE WHEN v_app.job_kind = 'recurring' THEN 'Termin zur Zusammenarbeit gespeichert' ELSE 'Termin vereinbart' END,
    'Der Termin für „' || v_app.title || '“ wurde verbindlich gespeichert.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_app.job_id,
      'engagement_id', v_engagement.id,
      'appointment_id', v_appointment.id,
      'starts_at', p_starts_at
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'engagement', to_jsonb(v_engagement),
    'appointment', to_jsonb(v_appointment),
    'scheduled_for', v_appointment.starts_at,
    'agreed_at', v_appointment.updated_at,
    'closed_other_applications', v_closed_count
  );
END;
$$;


ALTER FUNCTION "public"."confirm_job_engagement"("p_application_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_timezone" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_guardian_invitation"("p_invited_email" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_child_id uuid := auth.uid();
  v_existing_invitation record;
  v_token text;
  v_expires_at timestamptz := now() + interval '7 days';
begin
  if v_child_id is null then
    return jsonb_build_object('error', 'Nicht authentifiziert');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('guardian_invitation:' || v_child_id::text, 0)
  );

  if not exists (select 1 from public.profiles where id = v_child_id) then
    return jsonb_build_object('error', 'Profil nicht gefunden. Bitte lade die Seite neu.');
  end if;

  update public.guardian_invitations
  set status = 'expired', updated_at = now()
  where child_id = v_child_id
    and status = 'active'
    and purpose = 'guardian_account_link'
    and expires_at <= now();

  select id, token, expires_at into v_existing_invitation
  from public.guardian_invitations
  where child_id = v_child_id
    and status = 'active'
    and purpose = 'guardian_account_link'
    and expires_at > now()
  order by expires_at desc, created_at desc, id desc
  limit 1;

  if found then
    update public.profiles
    set guardian_status = 'pending', updated_at = now()
    where id = v_child_id and guardian_status <> 'linked';

    return jsonb_build_object(
      'token', v_existing_invitation.token,
      'expires_at', v_existing_invitation.expires_at,
      'purpose', 'guardian_account_link',
      'reused', true
    );
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.guardian_invitations (child_id, token, status, expires_at, purpose)
  values (v_child_id, v_token, 'active', v_expires_at, 'guardian_account_link');

  update public.profiles
  set guardian_status = 'pending', updated_at = now()
  where id = v_child_id and guardian_status <> 'linked';

  return jsonb_build_object(
    'token', v_token,
    'expires_at', v_expires_at,
    'purpose', 'guardian_account_link',
    'reused', false
  );
exception
  when unique_violation then
    select id, token, expires_at into v_existing_invitation
    from public.guardian_invitations
    where child_id = v_child_id
      and status = 'active'
      and purpose = 'guardian_account_link'
      and expires_at > now()
    order by expires_at desc, created_at desc, id desc
    limit 1;

    if found then
      return jsonb_build_object(
        'token', v_existing_invitation.token,
        'expires_at', v_existing_invitation.expires_at,
        'purpose', 'guardian_account_link',
        'reused', true
      );
    end if;

    raise;
end;
$$;


ALTER FUNCTION "public"."create_guardian_invitation"("p_invited_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_job_v2"("p_market_id" "uuid", "p_title" "text", "p_description" "text", "p_wage" numeric, "p_category" "text", "p_payment_type" "text" DEFAULT 'hourly'::"text", "p_status" "public"."job_status" DEFAULT 'open'::"public"."job_status", "p_address_reveal_policy" "text" DEFAULT 'after_accept'::"text", "p_public_location_label" "text" DEFAULT ''::"text", "p_public_lat" double precision DEFAULT NULL::double precision, "p_public_lng" double precision DEFAULT NULL::double precision, "p_reach" "text" DEFAULT 'internal_rheinbach'::"text", "p_job_kind" "text" DEFAULT 'one_time'::"text", "p_recurrence_rule" "text" DEFAULT NULL::"text", "p_continuity_preferred" boolean DEFAULT false, "p_address_full" "text" DEFAULT NULL::"text", "p_private_lat" double precision DEFAULT NULL::double precision, "p_private_lng" double precision DEFAULT NULL::double precision, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_title text := btrim(COALESCE(p_title, ''));
  v_description text := btrim(COALESCE(p_description, ''));
  v_job public.jobs%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.account_type::text = 'job_provider'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur Jobanbieter können Jobs erstellen.');
  END IF;
  IF p_status NOT IN ('draft', 'open') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ein neuer Job kann nur als Entwurf oder offen angelegt werden.');
  END IF;
  IF char_length(v_title) NOT BETWEEN 5 AND 140 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Titel muss zwischen 5 und 140 Zeichen lang sein.');
  END IF;
  IF char_length(v_description) NOT BETWEEN 10 AND 5000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Beschreibung muss zwischen 10 und 5.000 Zeichen lang sein.');
  END IF;
  IF p_wage IS NULL OR p_wage <= 0 OR p_wage > 100000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte gib eine gültige Vergütung an.');
  END IF;
  IF p_payment_type IS NULL OR p_payment_type NOT IN ('hourly', 'fixed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unbekannte Zahlungsart.');
  END IF;
  IF p_reach IS NULL OR p_reach NOT IN ('internal_rheinbach', 'extended') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unbekannte Reichweite.');
  END IF;
  IF p_job_kind IS NULL OR p_job_kind NOT IN ('one_time', 'recurring') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unbekannte Jobart.');
  END IF;
  IF p_job_kind = 'recurring'
     AND (p_recurrence_rule IS NULL OR p_recurrence_rule NOT IN ('weekly', 'biweekly', 'monthly', 'flexible')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte wähle eine Häufigkeit für den regelmäßigen Job.');
  END IF;
  IF p_job_kind = 'one_time' AND p_recurrence_rule IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ein einmaliger Job benötigt keine Wiederholung.');
  END IF;
  IF char_length(COALESCE(p_address_full, '')) > 500
     OR char_length(COALESCE(p_notes, '')) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Private Ortsangaben sind zu lang.');
  END IF;

  INSERT INTO public.jobs (
    posted_by,
    market_id,
    title,
    description,
    wage_hourly,
    status,
    category,
    payment_type,
    address_reveal_policy,
    public_location_label,
    public_lat,
    public_lng,
    reach,
    hiring_mode,
    job_kind,
    recurrence_rule,
    continuity_preferred
  ) VALUES (
    v_user_id,
    p_market_id,
    v_title,
    v_description,
    p_wage,
    p_status,
    p_category,
    p_payment_type,
    p_address_reveal_policy,
    p_public_location_label,
    p_public_lat,
    p_public_lng,
    p_reach,
    'first_come',
    p_job_kind,
    CASE WHEN p_job_kind = 'recurring' THEN p_recurrence_rule ELSE NULL END,
    p_job_kind = 'recurring' AND p_continuity_preferred
  )
  RETURNING * INTO v_job;

  INSERT INTO public.job_private_details (
    job_id,
    address_full,
    private_lat,
    private_lng,
    notes
  ) VALUES (
    v_job.id,
    NULLIF(btrim(p_address_full), ''),
    p_private_lat,
    p_private_lng,
    NULLIF(btrim(p_notes), '')
  );

  RETURN jsonb_build_object('ok', true, 'job', to_jsonb(v_job), 'job_id', v_job.id);
END;
$$;


ALTER FUNCTION "public"."create_job_v2"("p_market_id" "uuid", "p_title" "text", "p_description" "text", "p_wage" numeric, "p_category" "text", "p_payment_type" "text", "p_status" "public"."job_status", "p_address_reveal_policy" "text", "p_public_location_label" "text", "p_public_lat" double precision, "p_public_lng" double precision, "p_reach" "text", "p_job_kind" "text", "p_recurrence_rule" "text", "p_continuity_preferred" boolean, "p_address_full" "text", "p_private_lat" double precision, "p_private_lng" double precision, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_eligible_guardian_relationship"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.status := COALESCE(NEW.status, 'active');

  IF NEW.status = 'active' THEN
    IF NEW.child_id IS NULL
       OR NEW.guardian_id IS NULL
       OR NEW.child_id = NEW.guardian_id THEN
      RAISE EXCEPTION 'An active guardian relationship requires two distinct profiles.'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles guardian
      WHERE guardian.id = NEW.guardian_id
        AND guardian.account_type = 'job_provider'::public.account_type
        AND guardian.provider_kind = 'private'::public.provider_kind
        AND guardian.birthdate IS NOT NULL
        AND guardian.birthdate <= (current_date - interval '18 years')::date
        AND guardian.birthdate >= (current_date - interval '120 years')::date
        AND nullif(btrim(guardian.full_name), '') IS NOT NULL
        AND nullif(btrim(guardian.city), '') IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'The guardian must be a complete private adult provider profile.'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles child_profile
      WHERE child_profile.id = NEW.child_id
        AND child_profile.account_type = 'job_seeker'::public.account_type
    ) THEN
      RAISE EXCEPTION 'The linked child must have a seeker profile.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_eligible_guardian_relationship"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_verified_provider_job_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NEW.posted_by IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles provider
       WHERE provider.id = NEW.posted_by
         AND provider.account_type = 'job_provider'::public.account_type
         AND provider.provider_verification_status = 'verified'::public.provider_verification_status
         AND provider.provider_verified_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Jobs can only be created by a verified provider.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_verified_provider_job_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_activity_inbox_summaries"() RETURNS TABLE("application_id" "uuid", "last_message_preview" "text", "last_message_at" timestamp with time zone, "unread_count" bigint, "pending_reopen_count" bigint, "last_activity_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  WITH permitted AS (
    SELECT a.id, a.last_activity_at
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.user_id = auth.uid() OR j.posted_by = auth.uid()
  ), unread AS (
    SELECT m.application_id, count(*)::bigint AS count
    FROM public.messages m
    JOIN permitted p ON p.id = m.application_id
    WHERE m.sender_id <> auth.uid()
      AND m.read_at IS NULL
    GROUP BY m.application_id
  ), pending AS (
    SELECT request.application_id, count(*)::bigint AS count
    FROM public.conversation_reopen_requests request
    JOIN permitted p ON p.id = request.application_id
    WHERE request.recipient_id = auth.uid()
      AND request.status = 'pending'
    GROUP BY request.application_id
  )
  SELECT
    p.id,
    latest.content,
    latest.created_at,
    COALESCE(unread.count, 0),
    COALESCE(pending.count, 0),
    p.last_activity_at
  FROM permitted p
  LEFT JOIN LATERAL (
    SELECT m.content, m.created_at
    FROM public.messages m
    WHERE m.application_id = p.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN unread ON unread.application_id = p.id
  LEFT JOIN pending ON pending.application_id = p.id;
$$;


ALTER FUNCTION "public"."get_activity_inbox_summaries"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_activity_partner_profiles"("p_application_ids" "uuid"[]) RETURNS TABLE("application_id" "uuid", "profile_id" "uuid", "full_name" "text", "company_name" "text", "account_type" "public"."account_type", "avatar_url" "text", "bio" "text", "city" "text", "country" "text", "skills" "text", "interests" "text", "created_at" timestamp with time zone, "provider_verification_status" "public"."provider_verification_status", "age_years" integer, "is_staff" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_requested_count integer := cardinality(COALESCE(p_application_ids, ARRAY[]::uuid[]));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required.';
  END IF;

  IF v_requested_count > 100 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'At most 100 application IDs may be requested.';
  END IF;

  RETURN QUERY
  WITH requested_applications AS (
    SELECT DISTINCT requested_application_id
    FROM unnest(COALESCE(p_application_ids, ARRAY[]::uuid[])) AS requested(requested_application_id)
    WHERE requested_application_id IS NOT NULL
  )
  SELECT
    application.id,
    partner.id,
    partner.full_name,
    partner.company_name,
    partner.account_type,
    partner.avatar_url,
    partner.bio,
    partner.city,
    partner.country,
    partner.skills,
    partner.interests,
    partner.created_at,
    partner.provider_verification_status,
    CASE
      WHEN partner.birthdate IS NULL OR partner.birthdate > CURRENT_DATE THEN NULL
      ELSE EXTRACT(YEAR FROM age(CURRENT_DATE, partner.birthdate))::integer
    END AS age_years,
    EXISTS (
      SELECT 1
      FROM public.user_system_roles user_role
      JOIN public.system_roles system_role ON system_role.id = user_role.role_id
      WHERE user_role.user_id = partner.id
        AND system_role.name IN ('admin', 'moderator', 'analyst')
    ) AS is_staff
  FROM requested_applications requested
  JOIN public.applications application ON application.id = requested.requested_application_id
  JOIN public.jobs job ON job.id = application.job_id
  JOIN public.profiles partner
    ON partner.id = CASE
      WHEN application.user_id = v_user_id THEN job.posted_by
      ELSE application.user_id
    END
  WHERE application.user_id = v_user_id
     OR job.posted_by = v_user_id
  ORDER BY application.id;
END;
$$;


ALTER FUNCTION "public"."get_activity_partner_profiles"("p_application_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_activity_partner_profiles"("p_application_ids" "uuid"[]) IS 'Minimal counterpart profiles for requested applications shared with the authenticated caller.';



CREATE OR REPLACE FUNCTION "public"."get_authorized_job_location"("p_job_id" "uuid") RETURNS TABLE("address_full" "text", "private_lat" numeric, "private_lng" numeric, "notes" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT details.address_full,
         details.private_lat::numeric,
         details.private_lng::numeric,
         details.notes
  FROM public.job_private_details details
  JOIN public.jobs job ON job.id = details.job_id
  WHERE job.id = p_job_id
    AND auth.uid() IS NOT NULL
    AND (
      job.posted_by = auth.uid()
      OR (
        job.status IN (
          'reserved'::public.job_status,
          'filled'::public.job_status,
          'closed'::public.job_status
        )
        AND (
          EXISTS (
            SELECT 1
            FROM public.applications application
            WHERE application.job_id = job.id
              AND application.user_id = auth.uid()
              AND application.status IN (
                'accepted'::public.application_status,
                'completed'::public.application_status
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.job_engagements engagement
            WHERE engagement.job_id = job.id
              AND engagement.seeker_id = auth.uid()
              AND engagement.status IN ('active', 'completed')
          )
        )
      )
    );
$$;


ALTER FUNCTION "public"."get_authorized_job_location"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_guardian_invitation_info"("token_input" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  invitation_record record;
  child_profile record;
begin
  select * into invitation_record
  from public.guardian_invitations
  where token = token_input
    and status = 'active'
    and expires_at > now();

  if not found then
    return jsonb_build_object('valid', false, 'error', 'Invalid or expired token');
  end if;

  select full_name into child_profile
  from public.profiles
  where id = invitation_record.child_id;

  return jsonb_build_object(
    'valid', true,
    'child_name', child_profile.full_name,
    'expires_at', invitation_record.expires_at,
    'purpose', invitation_record.purpose,
    'basis_consent_link_id', invitation_record.basis_consent_link_id
  );
end;
$$;


ALTER FUNCTION "public"."get_guardian_invitation_info"("token_input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_security_events"("p_limit" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "event_type" "text", "ip_address" "inet", "user_agent" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT event.id,
         event.event_type,
         event.ip_address,
         event.user_agent,
         event.created_at
  FROM public.security_events event
  WHERE auth.uid() IS NOT NULL
    AND event.user_id = auth.uid()
  ORDER BY event.created_at DESC, event.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);
$$;


ALTER FUNCTION "public"."get_my_security_events"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_visible_job_creator_summaries"("p_job_ids" "uuid"[]) RETURNS TABLE("job_id" "uuid", "creator_id" "uuid", "full_name" "text", "company_name" "text", "account_type" "public"."account_type", "avatar_url" "text", "bio" "text", "city" "text", "country" "text", "created_at" timestamp with time zone, "provider_verification_status" "public"."provider_verification_status", "is_staff" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_requested_count integer := cardinality(COALESCE(p_job_ids, ARRAY[]::uuid[]));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required.';
  END IF;

  IF v_requested_count > 100 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'At most 100 job IDs may be requested.';
  END IF;

  RETURN QUERY
  WITH requested_jobs AS (
    SELECT DISTINCT requested_job_id
    FROM unnest(COALESCE(p_job_ids, ARRAY[]::uuid[])) AS requested(requested_job_id)
    WHERE requested_job_id IS NOT NULL
  )
  SELECT
    job.id,
    profile.id,
    profile.full_name,
    profile.company_name,
    profile.account_type,
    profile.avatar_url,
    profile.bio,
    profile.city,
    profile.country,
    profile.created_at,
    profile.provider_verification_status,
    EXISTS (
      SELECT 1
      FROM public.user_system_roles user_role
      JOIN public.system_roles system_role ON system_role.id = user_role.role_id
      WHERE user_role.user_id = profile.id
        AND system_role.name IN ('admin', 'moderator', 'analyst')
    ) AS is_staff
  FROM requested_jobs requested
  JOIN public.jobs job ON job.id = requested.requested_job_id
  JOIN public.profiles profile ON profile.id = job.posted_by
  WHERE
    job.status IN ('open'::public.job_status, 'reserved'::public.job_status)
    OR job.posted_by = v_user_id
    OR EXISTS (
      SELECT 1
      FROM public.applications application
      WHERE application.job_id = job.id
        AND application.user_id = v_user_id
    )
  ORDER BY job.id;
END;
$$;


ALTER FUNCTION "public"."get_visible_job_creator_summaries"("p_job_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_visible_job_creator_summaries"("p_job_ids" "uuid"[]) IS 'Minimal creator profiles for requested jobs already visible to the authenticated caller.';



CREATE OR REPLACE FUNCTION "public"."get_waitlist_job_summaries"("p_job_ids" "uuid"[]) RETURNS TABLE("job_id" "uuid", "waitlist_count" bigint, "next_position" bigint, "conversation_active" boolean, "my_waitlist_position" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT
    job.id,
    COALESCE(queue_summary.waitlist_count, 0)::bigint,
    (COALESCE(queue_summary.waitlist_count, 0) + 1)::bigint,
    EXISTS (
      SELECT 1
      FROM public.applications primary_application
      WHERE primary_application.job_id = job.id
        AND primary_application.is_primary
        AND primary_application.conversation_state = 'open'
        AND primary_application.status IN ('submitted', 'negotiating', 'accepted')
    ),
    own_queue.position::bigint
  FROM public.jobs job
  LEFT JOIN LATERAL (
    SELECT count(*)::bigint AS waitlist_count
    FROM public.applications waitlisted_application
    WHERE waitlisted_application.job_id = job.id
      AND waitlisted_application.status = 'waitlisted'
      AND waitlisted_application.conversation_state = 'open'
  ) queue_summary ON true
  LEFT JOIN LATERAL (
    SELECT ranked.position
    FROM (
      SELECT
        waitlisted_application.user_id,
        row_number() OVER (
          ORDER BY
            waitlisted_application.queue_position,
            waitlisted_application.created_at,
            waitlisted_application.id
        ) AS position
      FROM public.applications waitlisted_application
      WHERE waitlisted_application.job_id = job.id
        AND waitlisted_application.status = 'waitlisted'
        AND waitlisted_application.conversation_state = 'open'
    ) ranked
    WHERE ranked.user_id = auth.uid()
    LIMIT 1
  ) own_queue ON true
  WHERE auth.uid() IS NOT NULL
    AND job.id = ANY(COALESCE(p_job_ids, ARRAY[]::uuid[]))
    AND (
      job.status IN ('open'::public.job_status, 'reserved'::public.job_status)
      OR job.posted_by = auth.uid()
      OR public.is_activity_job_participant(job.id)
    );
$$;


ALTER FUNCTION "public"."get_waitlist_job_summaries"("p_job_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, user_type, city, market_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'youth',
    NEW.raw_user_meta_data->>'city',
    NULLIF(NEW.raw_user_meta_data->>'market_id', '')::UUID
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_system_role"("user_id" "uuid", "required_role" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  return exists (
    select 1
    from public.user_system_roles usr
    join public.system_roles sr on usr.role_id = sr.id
    where usr.user_id = has_system_role.user_id
      and sr.name = required_role
  );
end;
$$;


ALTER FUNCTION "public"."has_system_role"("user_id" "uuid", "required_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."humanize_activity_system_message_copy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_content text := lower(COALESCE(NEW.content, ''));
BEGIN
  IF NEW.kind = 'system'
     AND (
       v_content LIKE '%aus der warteliste nachgerückt%'
       OR (
         v_content LIKE '%nachgerückt%'
         AND v_content LIKE '%gespräch%geöffnet%'
       )
     ) THEN
    NEW.content := 'Du bist automatisch nachgerückt. Das Gespräch ist jetzt geöffnet.';
  ELSIF NEW.kind = 'system'
        AND (
          v_content LIKE '%platz 1%'
          OR v_content LIKE '%hauptbewerbung%'
        ) THEN
    NEW.content := 'Gespräch geöffnet. Du kannst jetzt schreiben.';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."humanize_activity_system_message_copy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."humanize_application_notification_copy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_title_and_body text := lower(
    COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, '')
  );
  v_applicant_name text;
  v_job_title text;
BEGIN
  IF NEW.type = 'application_new'
     AND (
       lower(COALESCE(NEW.data->>'is_primary', 'false')) = 'true'
       OR lower(COALESCE(NEW.title, '')) LIKE '%platz 1%'
       OR v_title_and_body LIKE '%hauptbewerbung%'
     ) THEN
    SELECT
      split_part(
        COALESCE(NULLIF(btrim(profile.full_name), ''), 'Eine Person'),
        ' ',
        1
      ),
      job.title
    INTO v_applicant_name, v_job_title
    FROM public.applications application
    JOIN public.profiles profile ON profile.id = application.user_id
    JOIN public.jobs job ON job.id = application.job_id
    WHERE application.id::text = COALESCE(NEW.data, '{}'::jsonb)->>'application_id';

    NEW.title := 'Neue Bewerbung';
    NEW.body := CASE
      WHEN FOUND THEN
        v_applicant_name || ' hat sich auf „' || v_job_title || '“ beworben. Das Gespräch ist geöffnet.'
      ELSE
        'Eine neue Bewerbung ist eingegangen. Das Gespräch ist geöffnet.'
    END;
  ELSIF NEW.type = 'application_status'
        AND NEW.title IN ('Du bist jetzt auf Platz 1', 'Du bist jetzt im Gespräch') THEN
    NEW.title := 'Gespräch geöffnet';
    NEW.body := 'Deine Bewerbung wurde vorgezogen. Du kannst jetzt schreiben.';
  ELSIF NEW.type = 'application_status'
        AND NEW.title IN ('Du bist nachgerückt', 'Du bist automatisch nachgerückt') THEN
    NEW.title := 'Automatisch nachgerückt';
    NEW.body := 'Deine Bewerbung ist automatisch nachgerückt. Das Gespräch ist geöffnet.';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."humanize_application_notification_copy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invalidate_provider_verification_on_address_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF OLD.account_type = 'job_provider'::public.account_type
     AND (
       OLD.provider_verification_status = 'verified'::public.provider_verification_status
       OR OLD.provider_verified_at IS NOT NULL
     )
     AND (
       OLD.street IS DISTINCT FROM NEW.street
       OR OLD.house_number IS DISTINCT FROM NEW.house_number
       OR OLD.city IS DISTINCT FROM NEW.city
       OR OLD.zip IS DISTINCT FROM NEW.zip
       OR OLD.country IS DISTINCT FROM NEW.country
       OR OLD.lat IS DISTINCT FROM NEW.lat
       OR OLD.lng IS DISTINCT FROM NEW.lng
     ) THEN
    NEW.provider_verification_status := 'pending'::public.provider_verification_status;
    NEW.provider_verified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."invalidate_provider_verification_on_address_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_activity_job_participant"("p_job_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.job_id = p_job_id
      AND (a.user_id = auth.uid() OR j.posted_by = auth.uid())
  );
$$;


ALTER FUNCTION "public"."is_activity_job_participant"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.user_system_roles usr
    join public.system_roles r on r.id = usr.role_id
    where usr.user_id = auth.uid()
      and r.name = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_application_participant"("p_application_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = p_application_id
      AND (a.user_id = p_user_id OR j.posted_by = p_user_id)
  );
$$;


ALTER FUNCTION "public"."is_application_participant"("p_application_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.user_system_roles usr
    join public.system_roles r on r.id = usr.role_id
    where usr.user_id = auth.uid()
      and r.name in ('admin','moderator','analyst')
  );
$$;


ALTER FUNCTION "public"."is_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff"("p_uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.user_system_roles usr
    join public.system_roles sr on sr.id = usr.role_id
    where usr.user_id = p_uid
      and sr.name in ('admin','moderator','analyst')
  );
$$;


ALTER FUNCTION "public"."is_staff"("p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_launch_waitlist"("p_email" "text", "p_city" "text", "p_federal_state" "text", "p_country" "text", "p_role" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
  v_email text := nullif(lower(btrim(p_email)), '');
  v_city text := nullif(btrim(p_city), '');
  v_federal_state text := nullif(btrim(p_federal_state), '');
  v_country text := nullif(upper(btrim(p_country)), '');
  v_role text := nullif(lower(btrim(p_role)), '');
BEGIN
  IF v_email IS NULL
     OR char_length(v_email) < 3
     OR char_length(v_email) > 320
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('launch_waitlist:' || v_email, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.waitlist entry
    WHERE lower(btrim(entry.email)) = v_email
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_joined', true);
  END IF;

  IF v_city IS NULL OR char_length(v_city) < 2 OR char_length(v_city) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_city');
  END IF;
  IF v_federal_state IS NOT NULL
     AND (char_length(v_federal_state) < 2 OR char_length(v_federal_state) > 120) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_federal_state');
  END IF;
  IF v_country IS NOT NULL
     AND (char_length(v_country) < 2 OR char_length(v_country) > 80) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_country');
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('youth', 'parent', 'client', 'company') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_role');
  END IF;

  INSERT INTO public.waitlist (email, city, federal_state, country, role)
  VALUES (v_email, v_city, v_federal_state, v_country, v_role);

  RETURN jsonb_build_object('ok', true, 'already_joined', false);
END;
$_$;


ALTER FUNCTION "public"."join_launch_waitlist"("p_email" "text", "p_city" "text", "p_federal_state" "text", "p_country" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_all_notifications_read"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;

  UPDATE public.notifications
  SET read_at = now()
  WHERE user_id = v_user_id
    AND read_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated_count', v_updated);
END;
$$;


ALTER FUNCTION "public"."mark_all_notifications_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_application_messages_read"("p_application_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF NOT public.is_application_participant(p_application_id, v_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht berechtigt.');
  END IF;

  UPDATE public.messages
  SET read_at = now()
  WHERE application_id = p_application_id
    AND sender_id <> v_user_id
    AND read_at IS NULL;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated_count', v_updated_count);
END;
$$;


ALTER FUNCTION "public"."mark_application_messages_read"("p_application_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;

  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id
    AND user_id = v_user_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', v_updated > 0, 'updated_count', v_updated);
END;
$$;


ALTER FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_provider_on_automatic_promotion"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_provider_id uuid;
  v_job_title text;
  v_dedupe_key text;
BEGIN
  SELECT job.posted_by, job.title
  INTO v_provider_id, v_job_title
  FROM public.jobs job
  WHERE job.id = NEW.job_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_dedupe_key := 'provider:auto-promotion:'
    || NEW.id::text
    || ':'
    || NEW.promoted_at::text;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    body,
    data,
    category,
    dedupe_key
  ) VALUES (
    v_provider_id,
    'job_status',
    'Automatisch nachgerückt',
    'Für „' || v_job_title || '“ ist die nächste Bewerbung automatisch nachgerückt. Das Gespräch ist geöffnet.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || NEW.id::text,
      'application_id', NEW.id,
      'job_id', NEW.job_id,
      'automatic_promotion', true
    ),
    'jobs',
    v_dedupe_key
  )
  ON CONFLICT (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_provider_on_automatic_promotion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_notification_delivery"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_preferences public.notification_preferences%ROWTYPE;
  v_applicant_name text;
  v_job_title text;
BEGIN
  -- Normalize legacy lifecycle copy at the single delivery boundary. This
  -- keeps provider notifications human-readable without exposing applicants
  -- to unrelated seekers.
  IF NEW.type = 'application_new' AND COALESCE(NEW.data, '{}'::jsonb) ? 'application_id' THEN
    SELECT
      split_part(COALESCE(NULLIF(btrim(profile.full_name), ''), 'Eine Person'), ' ', 1),
      job.title
    INTO v_applicant_name, v_job_title
    FROM public.applications application
    JOIN public.profiles profile ON profile.id = application.user_id
    JOIN public.jobs job ON job.id = application.job_id
    WHERE application.id = (NEW.data->>'application_id')::uuid;

    IF FOUND THEN
      IF COALESCE((NEW.data->>'is_primary')::boolean, false) THEN
        NEW.title := 'Neue Bewerbung';
        NEW.body := v_applicant_name || ' hat sich auf „' || v_job_title || '“ beworben. Das Gespräch ist geöffnet.';
      ELSE
        NEW.title := 'Neue Person auf der Warteliste';
        NEW.body := v_applicant_name || ' hat sich für „' || v_job_title || '“ auf die Warteliste gesetzt.';
      END IF;
    END IF;
  ELSIF NEW.title = 'Du bist jetzt auf Platz 1' THEN
    NEW.title := 'Du bist jetzt im Gespräch';
    NEW.body := 'Deine Bewerbung wurde vorgezogen. Der Chat ist jetzt geöffnet.';
  END IF;

  IF NEW.category IS NULL OR NEW.category = 'system' THEN
    NEW.category := CASE
      WHEN NEW.type = 'message' THEN 'messages'
      WHEN COALESCE(NEW.data, '{}'::jsonb) ? 'appointment_id' THEN 'appointments'
      WHEN lower(COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, '')) ~ '(warteliste|nachgerückt|platz im gespräch)' THEN 'waitlist'
      WHEN COALESCE(NEW.data, '{}'::jsonb) ? 'application_id' THEN 'applications'
      WHEN COALESCE(NEW.data, '{}'::jsonb) ? 'job_id' THEN 'jobs'
      ELSE 'system'
    END;
  END IF;

  SELECT * INTO v_preferences
  FROM public.notification_preferences
  WHERE user_id = NEW.user_id;

  IF FOUND AND NEW.category <> 'system' THEN
    IF NOT v_preferences.in_app_enabled THEN
      RETURN NULL;
    END IF;

    IF NEW.category = 'messages' AND NOT v_preferences.in_app_messages THEN
      RETURN NULL;
    ELSIF NEW.category = 'applications' AND NOT v_preferences.in_app_application_updates THEN
      RETURN NULL;
    ELSIF NEW.category = 'waitlist' AND NOT v_preferences.in_app_waitlist_updates THEN
      RETURN NULL;
    ELSIF NEW.category = 'appointments' AND NOT v_preferences.in_app_appointments THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prepare_notification_delivery"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_waitlisted_application"("p_application_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_target record;
  v_current record;
  v_displaced_application_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_reason) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte begründe die Ausnahme nachvollziehbar mit mindestens 20 Zeichen.');
  END IF;
  IF char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Grund darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.status,
    a.conversation_state,
    j.posted_by,
    j.title,
    j.status AS job_status,
    j.filled_by
  INTO v_target
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a, j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_target.posted_by <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Anbieter kann die Reihenfolge ändern.');
  END IF;
  IF v_target.status <> 'waitlisted' OR v_target.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur eine aktive Wartelisten-Bewerbung kann vorgezogen werden.');
  END IF;
  IF v_target.job_status = 'filled' OR v_target.filled_by IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Job ist bereits verbindlich vergeben.');
  END IF;

  SELECT a.id, a.user_id, a.status
  INTO v_current
  FROM public.applications a
  WHERE a.job_id = v_target.job_id
    AND a.id <> p_application_id
    AND a.is_primary
    AND a.conversation_state = 'open'
    AND a.status IN ('submitted', 'negotiating')
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_displaced_application_id := v_current.id;
    UPDATE public.applications
    SET status = 'waitlisted',
        is_primary = false,
        updated_at = now()
    WHERE id = v_current.id;

    INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
    VALUES (
      v_current.id,
      v_user_id,
      'queue_primary_displaced',
      v_reason,
      jsonb_build_object('promoted_application_id', p_application_id)
    );

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_current.user_id,
      'application_status',
      'Bewerbung auf die Warteliste verschoben',
      'Der Anbieter hat ausnahmsweise eine andere Bewerbung vorgezogen. Deine Bewerbung bleibt auf der Warteliste.',
      jsonb_build_object(
        'route', '/app-home/activities?conversation=' || v_current.id::text,
        'application_id', v_current.id,
        'job_id', v_target.job_id,
        'reason', v_reason
      )
    );
  END IF;

  UPDATE public.applications
  SET status = 'negotiating',
      is_primary = true,
      promoted_at = now(),
      promoted_by = v_user_id,
      promotion_reason = v_reason,
      updated_at = now()
  WHERE id = p_application_id;

  UPDATE public.jobs
  SET status = 'reserved',
      filled_by = NULL,
      filled_at = NULL,
      updated_at = now()
  WHERE id = v_target.job_id;

  INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
  VALUES (
    p_application_id,
    v_user_id,
      'queue_promoted_by_provider',
      v_reason,
      jsonb_build_object('displaced_application_id', v_displaced_application_id, 'job_id', v_target.job_id)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_target.user_id,
    'application_status',
    'Du bist jetzt auf Platz 1',
    'Der Anbieter hat deine Bewerbung vorgezogen. Der Chat ist jetzt geöffnet.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_target.job_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', p_application_id,
    'displaced_application_id', v_displaced_application_id,
    'reason', v_reason
  );
END;
$$;


ALTER FUNCTION "public"."promote_waitlisted_application"("p_application_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_active_guardian_eligibility"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM public.guardian_relationships relationship
       WHERE relationship.guardian_id = OLD.id
         AND COALESCE(relationship.status, 'active') = 'active'
     )
     AND NOT COALESCE((
       NEW.account_type = 'job_provider'::public.account_type
       AND NEW.provider_kind = 'private'::public.provider_kind
       AND NEW.birthdate IS NOT NULL
       AND NEW.birthdate <= (current_date - interval '18 years')::date
       AND NEW.birthdate >= (current_date - interval '120 years')::date
       AND nullif(btrim(NEW.full_name), '') IS NOT NULL
       AND nullif(btrim(NEW.city), '') IS NOT NULL
     ), false) THEN
    RAISE EXCEPTION 'An active guardian profile must remain a complete private adult provider.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."protect_active_guardian_eligibility"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redeem_guardian_invitation"("token_input" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_guardian_id uuid := auth.uid();
  v_token text := nullif(btrim(token_input), '');
  v_invitation public.guardian_invitations%ROWTYPE;
  v_guardian public.profiles%ROWTYPE;
  v_child public.profiles%ROWTYPE;
  v_already_linked boolean := false;
  v_already_redeemed boolean := false;
BEGIN
  IF v_guardian_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF v_token IS NULL OR char_length(v_token) > 512 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired_invitation');
  END IF;

  SELECT invitation.*
  INTO v_invitation
  FROM public.guardian_invitations invitation
  WHERE invitation.token = v_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired_invitation');
  END IF;

  IF v_invitation.status = 'redeemed' AND v_invitation.redeemed_by = v_guardian_id THEN
    v_already_redeemed := true;
  ELSIF v_invitation.status <> 'active' OR v_invitation.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired_invitation');
  END IF;

  IF v_guardian_id = v_invitation.child_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'self_link_not_allowed');
  END IF;

  SELECT profile.*
  INTO v_guardian
  FROM public.profiles profile
  WHERE profile.id = v_guardian_id;

  IF NOT FOUND
     OR v_guardian.account_type <> 'job_provider'::public.account_type
     OR v_guardian.provider_kind <> 'private'::public.provider_kind
     OR v_guardian.birthdate IS NULL
     OR v_guardian.birthdate > (current_date - interval '18 years')::date
     OR v_guardian.birthdate < (current_date - interval '120 years')::date
     OR nullif(btrim(v_guardian.full_name), '') IS NULL
     OR nullif(btrim(v_guardian.city), '') IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'guardian_profile_ineligible'
    );
  END IF;

  SELECT profile.*
  INTO v_child
  FROM public.profiles profile
  WHERE profile.id = v_invitation.child_id
  FOR UPDATE;

  IF NOT FOUND OR v_child.account_type <> 'job_seeker'::public.account_type THEN
    RETURN jsonb_build_object('success', false, 'error', 'child_profile_unavailable');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.guardian_relationships relationship
    WHERE relationship.child_id = v_invitation.child_id
      AND relationship.guardian_id = v_guardian_id
      AND COALESCE(relationship.status, 'active') = 'active'
  ) INTO v_already_linked;

  INSERT INTO public.guardian_relationships (child_id, guardian_id, status)
  VALUES (v_invitation.child_id, v_guardian_id, 'active')
  ON CONFLICT (child_id, guardian_id) DO UPDATE
  SET status = 'active';

  IF NOT v_already_redeemed THEN
    UPDATE public.guardian_invitations
    SET status = 'redeemed',
        used_at = now(),
        redeemed_by = v_guardian_id,
        updated_at = now()
    WHERE id = v_invitation.id;
  END IF;

  UPDATE public.profiles
  SET guardian_status = 'linked'::public.guardian_status,
      guardian_verified_at = COALESCE(guardian_verified_at, now()),
      guardian_id = COALESCE(guardian_id, v_guardian_id),
      updated_at = now()
  WHERE id = v_invitation.child_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', CASE
      WHEN v_already_linked OR v_already_redeemed THEN 'already_linked'
      ELSE 'guardian_linked'
    END,
    'requires_basis_consent', v_invitation.purpose = 'basis_account_link',
    'purpose', v_invitation.purpose
  );
END;
$$;


ALTER FUNCTION "public"."redeem_guardian_invitation"("token_input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_application"("p_application_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_app record;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_reason) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte gib einen nachvollziehbaren Grund an.');
  END IF;
  IF char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Grund darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT a.status, a.conversation_state, a.closed_by, a.close_action, j.posted_by
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.posted_by <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Anbieter kann diese Bewerbung ablehnen.');
  END IF;
  IF v_app.status = 'rejected'
     AND v_app.conversation_state = 'closed'
     AND v_app.closed_by = v_user_id
     AND v_app.close_action = 'provider_rejected' THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;
  IF v_app.status NOT IN ('submitted', 'negotiating', 'waitlisted', 'accepted')
     OR v_app.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Bewerbung kann nicht abgelehnt werden.');
  END IF;

  v_result := public._activity_close_application(
    p_application_id,
    v_user_id,
    'provider_rejected',
    v_reason,
    'rejected'
  );
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RETURN v_result;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    (v_result->>'seeker_id')::uuid,
    'application_status',
    'Bewerbung abgelehnt',
    'Deine Bewerbung wurde geschlossen. Grund: ' || v_reason,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', (v_result->>'job_id')::uuid
    )
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."reject_application"("p_application_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reopen_application"("p_application_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_recipient_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;

  v_result := public._activity_reopen_application(p_application_id, v_user_id);
  IF NOT COALESCE((v_result->>'ok')::boolean, false)
     OR COALESCE((v_result->>'unchanged')::boolean, false) THEN
    RETURN v_result;
  END IF;

  v_recipient_id := CASE
    WHEN v_user_id = (v_result->>'provider_id')::uuid THEN (v_result->>'seeker_id')::uuid
    ELSE (v_result->>'provider_id')::uuid
  END;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_recipient_id,
    'application_status',
    'Gespräch wieder geöffnet',
    'Das Gespräch zu „' || COALESCE(v_result->>'job_title', 'deinem Job') || '“ ist wieder geöffnet.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', (v_result->>'job_id')::uuid
    )
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."reopen_application"("p_application_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_activity_item"("p_application_id" "uuid", "p_reason_code" "text", "p_details" "text" DEFAULT NULL::"text", "p_reported_user_id" "uuid" DEFAULT NULL::"uuid", "p_message_id" "uuid" DEFAULT NULL::"uuid", "p_reopen_request_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason_code text := lower(btrim(COALESCE(p_reason_code, '')));
  v_details text := NULLIF(btrim(p_details), '');
  v_app record;
  v_target_type text;
  v_target_id uuid;
  v_reported_user_id uuid;
  v_message record;
  v_request record;
  v_conversation jsonb := '[]'::jsonb;
  v_target_evidence jsonb := NULL;
  v_evidence jsonb;
  v_report public.reports%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF v_reason_code NOT IN ('harassment', 'fraud', 'safety', 'inappropriate', 'spam', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte wähle einen gültigen Meldegrund.');
  END IF;
  IF char_length(COALESCE(v_details, '')) > 1500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Beschreibung darf höchstens 1.500 Zeichen lang sein.');
  END IF;
  IF p_message_id IS NOT NULL AND p_reopen_request_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte melde nur ein Element gleichzeitig.');
  END IF;

  SELECT
    application.user_id,
    job.posted_by,
    application.job_id,
    job.title AS job_title
  INTO v_app
  FROM public.applications application
  JOIN public.jobs job ON job.id = application.job_id
  WHERE application.id = p_application_id;

  IF NOT FOUND OR (v_user_id <> v_app.user_id AND v_user_id <> v_app.posted_by) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht berechtigt.');
  END IF;

  IF p_reopen_request_id IS NOT NULL THEN
    SELECT requested_by, message, created_at
    INTO v_request
    FROM public.conversation_reopen_requests
    WHERE id = p_reopen_request_id
      AND application_id = p_application_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Öffnungsanfrage nicht gefunden.');
    END IF;
    v_target_type := 'reopen_request';
    v_target_id := p_reopen_request_id;
    v_reported_user_id := v_request.requested_by;
    v_target_evidence := jsonb_build_object(
      'id', p_reopen_request_id,
      'requested_by', v_request.requested_by,
      'message', v_request.message,
      'created_at', v_request.created_at
    );
  ELSIF p_message_id IS NOT NULL THEN
    SELECT sender_id, kind, content, created_at
    INTO v_message
    FROM public.messages
    WHERE id = p_message_id
      AND application_id = p_application_id;

    IF NOT FOUND OR v_message.kind = 'system' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Nachricht nicht gefunden oder nicht meldbar.');
    END IF;
    v_target_type := 'message';
    v_target_id := p_message_id;
    v_reported_user_id := v_message.sender_id;
    v_target_evidence := jsonb_build_object(
      'id', p_message_id,
      'sender_id', v_message.sender_id,
      'kind', v_message.kind,
      'content', v_message.content,
      'created_at', v_message.created_at
    );
  ELSE
    v_reported_user_id := COALESCE(
      p_reported_user_id,
      CASE WHEN v_user_id = v_app.user_id THEN v_app.posted_by ELSE v_app.user_id END
    );
    v_target_type := 'user';
    v_target_id := v_reported_user_id;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', recent_message.id,
        'sender_id', recent_message.sender_id,
        'kind', recent_message.kind,
        'content', recent_message.content,
        'created_at', recent_message.created_at
      ) ORDER BY recent_message.created_at, recent_message.id
    ), '[]'::jsonb)
    INTO v_conversation
    FROM (
      SELECT message.id, message.sender_id, message.kind, message.content, message.created_at
      FROM public.messages message
      WHERE message.application_id = p_application_id
        AND message.deleted_at IS NULL
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT 20
    ) recent_message;
  END IF;

  IF v_reported_user_id IS NULL
     OR v_reported_user_id = v_user_id
     OR v_reported_user_id NOT IN (v_app.user_id, v_app.posted_by) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Person kann in diesem Gespräch nicht gemeldet werden.');
  END IF;
  IF p_reported_user_id IS NOT NULL AND p_reported_user_id <> v_reported_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Das gemeldete Element gehört nicht zu dieser Person.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reports report
    WHERE report.reporter_user_id = v_user_id
      AND report.target_type = v_target_type
      AND report.target_id = v_target_id
      AND report.status = 'open'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieses Element wurde bereits gemeldet und wird geprüft.');
  END IF;

  v_evidence := jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'target_type', v_target_type,
    'application_id', p_application_id,
    'job_id', v_app.job_id,
    'job_title', v_app.job_title,
    'reporter_user_id', v_user_id,
    'reported_user_id', v_reported_user_id,
    'message', CASE WHEN v_target_type = 'message' THEN v_target_evidence ELSE NULL END,
    'reopen_request', CASE WHEN v_target_type = 'reopen_request' THEN v_target_evidence ELSE NULL END,
    'conversation', CASE WHEN v_target_type = 'user' THEN v_conversation ELSE NULL END
  ));

  INSERT INTO public.reports (
    reporter_user_id,
    target_type,
    target_id,
    reason_code,
    details,
    status,
    application_id,
    reported_user_id,
    message_id,
    reopen_request_id,
    evidence_snapshot,
    evidence_captured_at
  ) VALUES (
    v_user_id,
    v_target_type,
    v_target_id,
    v_reason_code,
    v_details,
    'open',
    p_application_id,
    v_reported_user_id,
    p_message_id,
    p_reopen_request_id,
    v_evidence,
    now()
  )
  RETURNING * INTO v_report;

  INSERT INTO public.application_events (application_id, actor_id, event_type, metadata)
  VALUES (
    p_application_id,
    v_user_id,
    'activity_report_created',
    jsonb_build_object(
      'report_id', v_report.id,
      'target_type', v_target_type,
      'target_id', v_target_id,
      'evidence_version', 1
    )
  );

  RETURN jsonb_build_object('ok', true, 'report_id', v_report.id);
END;
$$;


ALTER FUNCTION "public"."report_activity_item"("p_application_id" "uuid", "p_reason_code" "text", "p_details" "text", "p_reported_user_id" "uuid", "p_message_id" "uuid", "p_reopen_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_conversation_reopen"("p_application_id" "uuid", "p_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_message text := btrim(COALESCE(p_message, ''));
  v_app record;
  v_request public.conversation_reopen_requests%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_message) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte beschreibe die Anfrage in mindestens 10 Zeichen.');
  END IF;
  IF char_length(v_message) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Anfrage darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.job_id,
    a.conversation_state,
    a.closed_by,
    a.close_action,
    a.closure_version,
    j.posted_by,
    j.title
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_user_id <> v_app.user_id AND v_user_id <> v_app.posted_by THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht berechtigt.');
  END IF;
  IF v_app.conversation_state <> 'closed' OR v_app.closed_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Für dieses Gespräch ist keine Öffnungsanfrage möglich.');
  END IF;
  IF v_user_id = v_app.closed_by THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Du kannst das Gespräch direkt wieder öffnen.');
  END IF;
  IF v_app.close_action NOT IN ('provider_rejected', 'seeker_withdrew', 'engagement_completed', 'engagement_cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese systemseitige Schließung kann nicht angefragt werden.');
  END IF;

  INSERT INTO public.conversation_reopen_requests (
    application_id,
    closure_version,
    requested_by,
    recipient_id,
    message
  ) VALUES (
    p_application_id,
    v_app.closure_version,
    v_user_id,
    v_app.closed_by,
    v_message
  )
  RETURNING * INTO v_request;

  INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
  VALUES (
    p_application_id,
    v_user_id,
    'conversation_reopen_requested',
    v_message,
    jsonb_build_object('request_id', v_request.id, 'closure_version', v_app.closure_version)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_app.closed_by,
    'message',
    'Anfrage zum geschlossenen Gespräch',
    'Du hast eine einmalige Öffnungsanfrage zu „' || v_app.title || '“ erhalten.',
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_app.job_id,
      'reopen_request_id', v_request.id
    )
  );

  RETURN jsonb_build_object('ok', true, 'request', to_jsonb(v_request));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Für diese Schließung wurde bereits eine Anfrage gesendet.');
END;
$$;


ALTER FUNCTION "public"."request_conversation_reopen"("p_application_id" "uuid", "p_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_provider_verification"("p_street" "text", "p_house_number" "text", "p_city" "text", "p_zip" "text", "p_lat" numeric, "p_lng" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_street text := nullif(btrim(p_street), '');
  v_house_number text := nullif(btrim(p_house_number), '');
  v_city text := nullif(btrim(p_city), '');
  v_zip text := nullif(btrim(p_zip), '');
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF v_street IS NULL OR char_length(v_street) > 160
     OR v_house_number IS NULL OR char_length(v_house_number) > 24
     OR v_city IS NULL OR char_length(v_city) < 2 OR char_length(v_city) > 120
     OR v_zip IS NULL OR char_length(v_zip) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_address');
  END IF;
  IF p_lat IS NULL
     OR p_lat::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_lat < -90
     OR p_lat > 90
     OR p_lng IS NULL
     OR p_lng::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_lng < -180
     OR p_lng > 180 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_coordinates');
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM public.profiles profile
  WHERE profile.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_profile.account_type <> 'job_provider'::public.account_type THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_required');
  END IF;
  IF v_profile.birthdate IS NULL
     OR v_profile.birthdate > (current_date - interval '18 years')::date
     OR nullif(btrim(v_profile.full_name), '') IS NULL
     OR nullif(btrim(v_profile.city), '') IS NULL
     OR v_profile.provider_kind IS NULL
     OR (
       v_profile.provider_kind = 'company'::public.provider_kind
       AND nullif(btrim(v_profile.company_name), '') IS NULL
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'incomplete_provider_profile');
  END IF;

  IF v_profile.provider_verification_status IN (
       'pending'::public.provider_verification_status,
       'verified'::public.provider_verification_status
     )
     AND v_profile.street IS NOT DISTINCT FROM v_street
     AND v_profile.house_number IS NOT DISTINCT FROM v_house_number
     AND v_profile.city IS NOT DISTINCT FROM v_city
     AND v_profile.zip IS NOT DISTINCT FROM v_zip
     AND v_profile.lat IS NOT DISTINCT FROM p_lat::double precision
     AND v_profile.lng IS NOT DISTINCT FROM p_lng::double precision THEN
    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'status', v_profile.provider_verification_status::text
    );
  END IF;

  UPDATE public.profiles
  SET street = v_street,
      house_number = v_house_number,
      city = v_city,
      zip = v_zip,
      lat = p_lat::double precision,
      lng = p_lng::double precision,
      provider_verification_status = 'pending'::public.provider_verification_status,
      provider_verified_at = NULL,
      updated_at = now()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'status', 'pending');
END;
$$;


ALTER FUNCTION "public"."request_provider_verification"("p_street" "text", "p_house_number" "text", "p_city" "text", "p_zip" "text", "p_lat" numeric, "p_lng" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_to_conversation_reopen_request"("p_request_id" "uuid", "p_accept" boolean, "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := NULLIF(btrim(p_reason), '');
  v_request public.conversation_reopen_requests%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(COALESCE(v_reason, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Antwort darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT * INTO v_request
  FROM public.conversation_reopen_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Anfrage nicht gefunden.');
  END IF;
  IF v_request.recipient_id <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Empfänger kann diese Anfrage beantworten.');
  END IF;
  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Anfrage wurde bereits beantwortet.');
  END IF;

  IF p_accept THEN
    v_result := public._activity_reopen_application(v_request.application_id, v_user_id);
    IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
      RETURN v_result;
    END IF;
  ELSE
    UPDATE public.conversation_reopen_requests
    SET status = 'declined',
        response_reason = v_reason,
        resolved_at = now(),
        resolved_by = v_user_id
    WHERE id = p_request_id;

    INSERT INTO public.application_events (application_id, actor_id, event_type, reason, metadata)
    VALUES (
      v_request.application_id,
      v_user_id,
      'conversation_reopen_declined',
      v_reason,
      jsonb_build_object('request_id', p_request_id, 'closure_version', v_request.closure_version)
    );

    v_result := jsonb_build_object('ok', true, 'accepted', false);
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_request.requested_by,
    'application_status',
    CASE WHEN p_accept THEN 'Gespräch wieder geöffnet' ELSE 'Öffnungsanfrage beantwortet' END,
    CASE
      WHEN p_accept THEN 'Deine Anfrage wurde angenommen. Du kannst wieder schreiben.'
      ELSE 'Deine Anfrage wurde abgelehnt.' || CASE WHEN v_reason IS NULL THEN '' ELSE ' Grund: ' || v_reason END
    END,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || v_request.application_id::text,
      'application_id', v_request.application_id,
      'reopen_request_id', p_request_id
    )
  );

  RETURN v_result || jsonb_build_object('request_id', p_request_id, 'accepted', p_accept);
END;
$$;


ALTER FUNCTION "public"."respond_to_conversation_reopen_request"("p_request_id" "uuid", "p_accept" boolean, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_application_message"("p_application_id" "uuid", "p_content" "text", "p_client_nonce" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_app record;
  v_message public.messages%ROWTYPE;
  v_recipient_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_content) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nachricht darf nicht leer sein.');
  END IF;
  IF char_length(v_content) > 1200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Nachricht darf höchstens 1.200 Zeichen lang sein.');
  END IF;

  SELECT
    a.id,
    a.user_id,
    a.status,
    a.job_id,
    a.is_primary,
    a.conversation_state,
    j.posted_by,
    j.title
  INTO v_app
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_user_id <> v_app.user_id AND v_user_id <> v_app.posted_by THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht berechtigt.');
  END IF;
  IF v_app.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieses Gespräch ist geschlossen.');
  END IF;
  IF NOT v_app.is_primary OR v_app.status = 'waitlisted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Auf der Warteliste ist nur die Bewerbungsnachricht möglich. Der Chat wird auf Platz 1 freigeschaltet.');
  END IF;
  IF v_app.status NOT IN ('submitted', 'negotiating', 'accepted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieses Gespräch ist nicht für neue Nachrichten geöffnet.');
  END IF;

  IF p_client_nonce IS NOT NULL THEN
    SELECT * INTO v_message
    FROM public.messages
    WHERE sender_id = v_user_id
      AND client_nonce = p_client_nonce;

    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'message', to_jsonb(v_message), 'unchanged', true);
    END IF;
  END IF;

  IF v_user_id = v_app.posted_by AND v_app.status = 'submitted' THEN
    UPDATE public.applications
    SET status = 'negotiating', updated_at = now()
    WHERE id = p_application_id;
  END IF;

  INSERT INTO public.messages (application_id, sender_id, content, kind, client_nonce)
  VALUES (p_application_id, v_user_id, v_content, 'chat', p_client_nonce)
  RETURNING * INTO v_message;

  v_recipient_id := CASE WHEN v_user_id = v_app.user_id THEN v_app.posted_by ELSE v_app.user_id END;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_recipient_id,
    'message',
    'Neue Nachricht zu „' || v_app.title || '“',
    CASE WHEN v_user_id = v_app.user_id
      THEN 'Du hast eine neue Nachricht von einem Bewerber erhalten.'
      ELSE 'Du hast eine neue Nachricht von einem Anbieter erhalten.'
    END,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || p_application_id::text,
      'application_id', p_application_id,
      'job_id', v_app.job_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'message', to_jsonb(v_message));
END;
$$;


ALTER FUNCTION "public"."send_application_message"("p_application_id" "uuid", "p_content" "text", "p_client_nonce" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_application_activity_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := now();
  IF ROW(
    NEW.status,
    NEW.conversation_state,
    NEW.is_primary,
    NEW.closed_at,
    NEW.reopened_at,
    NEW.promoted_at
  ) IS DISTINCT FROM ROW(
    OLD.status,
    OLD.conversation_state,
    OLD.is_primary,
    OLD.closed_at,
    OLD.reopened_at,
    OLD.promoted_at
  ) THEN
    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_application_activity_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_row_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_row_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_job_application"("p_job_id" "uuid", "p_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_message_text text := btrim(COALESCE(p_message, ''));
  v_job public.jobs%ROWTYPE;
  v_queue_position integer;
  v_is_primary boolean;
  v_status public.application_status;
  v_application public.applications%ROWTYPE;
  v_message public.messages%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_message_text) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bitte schreibe eine kurze Bewerbungsnachricht.');
  END IF;
  IF char_length(v_message_text) > 1200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Die Bewerbungsnachricht darf höchstens 1.200 Zeichen lang sein.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
      AND p.account_type::text = 'job_seeker'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur Jobsuchende können sich bewerben.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_relationships relationship
    WHERE relationship.child_id = v_user_id
      AND relationship.status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vor der Bewerbung fehlt die aktive Elternbestätigung.');
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job nicht gefunden.');
  END IF;
  IF v_job.posted_by = v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Du kannst dich nicht auf deinen eigenen Job bewerben.');
  END IF;
  IF v_job.status NOT IN ('open', 'reserved') OR (v_job.expires_at IS NOT NULL AND v_job.expires_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Dieser Job nimmt derzeit keine Bewerbungen an.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.applications a
    WHERE a.job_id = p_job_id AND a.user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Du hast dich bereits auf diesen Job beworben. Öffne die Bewerbung unter Aktivitäten.');
  END IF;

  SELECT COALESCE(max(a.queue_position), 0) + 1
  INTO v_queue_position
  FROM public.applications a
  WHERE a.job_id = p_job_id;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.job_id = p_job_id
      AND a.is_primary
      AND a.conversation_state = 'open'
      AND a.status IN ('submitted', 'negotiating', 'accepted')
  ) INTO v_is_primary;

  v_status := CASE WHEN v_is_primary THEN 'negotiating'::public.application_status ELSE 'waitlisted'::public.application_status END;

  INSERT INTO public.applications (
    job_id,
    user_id,
    message,
    status,
    queue_position,
    is_primary,
    conversation_state,
    last_activity_at,
    updated_at
  ) VALUES (
    p_job_id,
    v_user_id,
    v_message_text,
    v_status,
    v_queue_position,
    v_is_primary,
    'open',
    now(),
    now()
  )
  RETURNING * INTO v_application;

  INSERT INTO public.messages (application_id, sender_id, content, kind)
  VALUES (v_application.id, v_user_id, v_message_text, 'application')
  RETURNING * INTO v_message;

  IF v_is_primary THEN
    UPDATE public.jobs
    SET status = 'reserved',
        hiring_mode = 'first_come',
        updated_at = now()
    WHERE id = p_job_id;
  END IF;

  INSERT INTO public.application_events (application_id, actor_id, event_type, metadata)
  VALUES (
    v_application.id,
    v_user_id,
    'application_submitted',
    jsonb_build_object(
      'queue_position', v_queue_position,
      'is_primary', v_is_primary,
      'job_id', p_job_id
    )
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_job.posted_by,
    'application_new',
    CASE WHEN v_is_primary THEN 'Neue Bewerbung auf Platz 1' ELSE 'Neuer Wartelisten-Eintrag' END,
    CASE
      WHEN v_is_primary THEN 'Für „' || v_job.title || '“ ist eine neue Hauptbewerbung eingegangen.'
      ELSE 'Für „' || v_job.title || '“ ist eine weitere Bewerbung auf Wartelistenplatz ' || v_queue_position::text || ' eingegangen.'
    END,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || v_application.id::text,
      'application_id', v_application.id,
      'job_id', p_job_id,
      'queue_position', v_queue_position,
      'is_primary', v_is_primary
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'application', to_jsonb(v_application),
    'message', to_jsonb(v_message),
    'queue_position', v_queue_position,
    'is_primary', v_is_primary
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Du hast dich bereits auf diesen Job beworben.');
END;
$$;


ALTER FUNCTION "public"."submit_job_application"("p_job_id" "uuid", "p_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_profile_from_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  metadata_city text := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'city', '')), '');
  metadata_market_id uuid := NULL;
BEGIN
  BEGIN
    metadata_market_id := NULLIF(NEW.raw_user_meta_data->>'market_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    metadata_market_id := NULL;
  END;

  INSERT INTO public.profiles (id, email, email_verified_at, phone_verified_at, city, market_id)
  VALUES (NEW.id, NEW.email, NEW.email_confirmed_at, NEW.phone_confirmed_at, metadata_city, metadata_market_id)
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.profiles.email),
        email_verified_at = COALESCE(EXCLUDED.email_verified_at, public.profiles.email_verified_at),
        phone_verified_at = COALESCE(EXCLUDED.phone_verified_at, public.profiles.phone_verified_at),
        city = COALESCE(NULLIF(public.profiles.city, ''), EXCLUDED.city),
        market_id = COALESCE(public.profiles.market_id, EXCLUDED.market_id),
        updated_at = NOW();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_profile_from_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_regions_display_name"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
    IF NEW.display_name IS NULL THEN
        NEW.display_name := NEW.city;
    END IF;
    IF NEW.brand_prefix IS NULL THEN
        NEW.brand_prefix := NEW.city;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_regions_display_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_user_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_application_from_message"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.applications
  SET last_activity_at = GREATEST(last_activity_at, COALESCE(NEW.created_at, now())),
      updated_at = now()
  WHERE id = NEW.application_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_application_from_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_application_from_reopen_request"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.applications
  SET last_activity_at = GREATEST(last_activity_at, COALESCE(NEW.created_at, now())),
      updated_at = now()
  WHERE id = NEW.application_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_application_from_reopen_request"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_owned_job_details"("p_job_id" "uuid", "p_expected_status" "public"."job_status", "p_title" "text", "p_description" "text", "p_wage_hourly" numeric, "p_category" "text", "p_payment_type" "text", "p_reach" "text", "p_status" "public"."job_status", "p_job_kind" "text", "p_recurrence_rule" "text", "p_continuity_preferred" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_title text := nullif(btrim(p_title), '');
  v_description text := nullif(btrim(p_description), '');
  v_category text := nullif(btrim(p_category), '');
  v_payment_type text := nullif(btrim(p_payment_type), '');
  v_reach text := nullif(btrim(p_reach), '');
  v_job_kind text := nullif(btrim(p_job_kind), '');
  v_recurrence_rule text := nullif(btrim(p_recurrence_rule), '');
  v_continuity_preferred boolean;
  v_details_changed boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_job_id IS NULL OR p_expected_status IS NULL OR p_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_job_state');
  END IF;
  IF v_title IS NULL OR char_length(v_title) < 5 OR char_length(v_title) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_title');
  END IF;
  IF v_description IS NULL
     OR char_length(v_description) < 10
     OR char_length(v_description) > 5000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_description');
  END IF;
  IF p_wage_hourly IS NULL OR p_wage_hourly <= 0 OR p_wage_hourly > 100000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_compensation');
  END IF;
  IF v_category IS NULL OR v_category NOT IN (
    'garden', 'household', 'babysitting', 'tutoring', 'it_help',
    'moving', 'pets', 'shopping', 'other'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_category');
  END IF;
  IF v_payment_type IS NULL OR v_payment_type NOT IN ('hourly', 'fixed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_type');
  END IF;
  IF v_reach IS NULL OR v_reach NOT IN ('internal_rheinbach', 'extended') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_reach');
  END IF;
  IF v_job_kind IS NULL OR v_job_kind NOT IN ('one_time', 'recurring') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_job_kind');
  END IF;
  IF p_continuity_preferred IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_continuity_preference');
  END IF;
  IF v_job_kind = 'recurring'
     AND (
       v_recurrence_rule IS NULL
       OR v_recurrence_rule NOT IN ('weekly', 'biweekly', 'monthly', 'flexible')
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_recurrence');
  END IF;
  IF v_job_kind = 'one_time' AND v_recurrence_rule IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_recurrence');
  END IF;

  v_recurrence_rule := CASE
    WHEN v_job_kind = 'recurring' THEN v_recurrence_rule
    ELSE NULL
  END;
  v_continuity_preferred := v_job_kind = 'recurring' AND p_continuity_preferred;

  SELECT job.*
  INTO v_job
  FROM public.jobs job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_job.posted_by <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF v_job.status IS DISTINCT FROM p_expected_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status_changed');
  END IF;

  v_details_changed :=
    v_job.title IS DISTINCT FROM v_title
    OR v_job.description IS DISTINCT FROM v_description
    OR v_job.wage_hourly IS DISTINCT FROM p_wage_hourly
    OR v_job.category IS DISTINCT FROM v_category
    OR v_job.payment_type IS DISTINCT FROM v_payment_type
    OR v_job.reach IS DISTINCT FROM v_reach
    OR v_job.job_kind IS DISTINCT FROM v_job_kind
    OR v_job.recurrence_rule IS DISTINCT FROM v_recurrence_rule
    OR v_job.continuity_preferred IS DISTINCT FROM v_continuity_preferred
    OR v_job.status IS DISTINCT FROM p_status;

  IF v_job.status IN (
       'reviewing'::public.job_status,
       'reserved'::public.job_status,
       'filled'::public.job_status
     )
     OR v_job.completed_at IS NOT NULL
     OR (
       v_job.status = 'closed'::public.job_status
       AND v_job.filled_by IS NOT NULL
     ) THEN
    IF v_details_changed THEN
      RETURN jsonb_build_object('ok', false, 'error', 'workflow_details_locked');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'job_id', p_job_id,
      'status', v_job.status
    );
  END IF;

  IF v_job.status = 'draft'::public.job_status
     AND p_status NOT IN (
       'draft'::public.job_status,
       'open'::public.job_status,
       'closed'::public.job_status
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status_transition');
  END IF;
  IF v_job.status = 'open'::public.job_status
     AND p_status NOT IN ('open'::public.job_status, 'closed'::public.job_status) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status_transition');
  END IF;
  IF v_job.status = 'closed'::public.job_status
     AND p_status NOT IN ('closed'::public.job_status, 'open'::public.job_status) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status_transition');
  END IF;

  UPDATE public.jobs
  SET title = v_title,
      description = v_description,
      wage_hourly = p_wage_hourly,
      category = v_category,
      payment_type = v_payment_type,
      status = p_status,
      reach = v_reach,
      job_kind = v_job_kind,
      recurrence_rule = v_recurrence_rule,
      continuity_preferred = v_continuity_preferred,
      updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'status', p_status);
END;
$$;


ALTER FUNCTION "public"."update_owned_job_details"("p_job_id" "uuid", "p_expected_status" "public"."job_status", "p_title" "text", "p_description" "text", "p_wage_hourly" numeric, "p_category" "text", "p_payment_type" "text", "p_reach" "text", "p_status" "public"."job_status", "p_job_kind" "text", "p_recurrence_rule" "text", "p_continuity_preferred" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."withdraw_application"("p_application_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'Kein Interesse mehr');
  v_app record;
  v_result jsonb;
  v_rebalance jsonb;
  v_route_application_id uuid;
  v_body text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nicht authentifiziert.');
  END IF;
  IF char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Der Grund darf höchstens 500 Zeichen lang sein.');
  END IF;

  SELECT
    a.user_id,
    a.status,
    a.conversation_state,
    a.closed_by,
    a.close_action,
    COALESCE(NULLIF(btrim(p.full_name), ''), 'Eine Person') AS display_name
  INTO v_app
  FROM public.applications a
  JOIN public.profiles p ON p.id = a.user_id
  WHERE a.id = p_application_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bewerbung nicht gefunden.');
  END IF;
  IF v_app.user_id <> v_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nur der Bewerber kann diese Bewerbung zurückziehen.');
  END IF;
  IF v_app.status = 'withdrawn'
     AND v_app.conversation_state = 'closed'
     AND v_app.closed_by = v_user_id
     AND v_app.close_action = 'seeker_withdrew' THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;
  IF v_app.status NOT IN ('submitted', 'negotiating', 'waitlisted', 'accepted')
     OR v_app.conversation_state <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Diese Bewerbung kann nicht zurückgezogen werden.');
  END IF;

  v_result := public._activity_close_application(
    p_application_id,
    v_user_id,
    'seeker_withdrew',
    v_reason,
    'withdrawn'
  );
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RETURN v_result;
  END IF;

  v_rebalance := v_result->'rebalance';
  v_route_application_id := CASE
    WHEN v_rebalance->>'action' = 'promoted' THEN (v_rebalance->>'application_id')::uuid
    ELSE p_application_id
  END;

  v_body := split_part(v_app.display_name, ' ', 1) || ' hat die Bewerbung für „'
    || COALESCE(v_result->>'job_title', 'deinen Job') || '“ zurückgezogen.';

  IF v_rebalance->>'action' = 'promoted' THEN
    v_body := v_body || ' ' || split_part(COALESCE(v_rebalance->>'display_name', 'Die nächste Person'), ' ', 1)
      || ' ist aus der Warteliste nachgerückt; der Chat ist jetzt geöffnet.';
  ELSIF v_rebalance->>'action' = 'job_reopened' THEN
    v_body := v_body || ' Das Angebot ist wieder für neue Bewerbungen geöffnet.';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data, category)
  VALUES (
    (v_result->>'provider_id')::uuid,
    'application_status',
    'Bewerbung zurückgezogen',
    v_body,
    jsonb_build_object(
      'route', '/app-home/activities?conversation=' || v_route_application_id::text,
      'application_id', v_route_application_id,
      'job_id', (v_result->>'job_id')::uuid,
      'closed_application_id', p_application_id
    ),
    CASE WHEN v_rebalance->>'action' = 'promoted' THEN 'waitlist' ELSE 'applications' END
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."withdraw_application"("p_application_id" "uuid", "p_reason" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."application_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "event_type" "text" NOT NULL,
    "reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."application_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."application_status" DEFAULT 'submitted'::"public"."application_status" NOT NULL,
    "rejection_reason" "text",
    "queue_position" integer NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "conversation_state" "text" DEFAULT 'open'::"text" NOT NULL,
    "closed_by" "uuid",
    "closed_at" timestamp with time zone,
    "closed_reason" "text",
    "close_action" "text",
    "closed_from_status" "public"."application_status",
    "was_primary_before_close" boolean DEFAULT false NOT NULL,
    "closure_version" integer DEFAULT 0 NOT NULL,
    "reopened_at" timestamp with time zone,
    "reopened_by" "uuid",
    "promoted_at" timestamp with time zone,
    "promoted_by" "uuid",
    "promotion_reason" "text",
    "last_activity_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "applications_close_action_check" CHECK ((("close_action" IS NULL) OR ("close_action" = ANY (ARRAY['provider_rejected'::"text", 'seeker_withdrew'::"text", 'job_assigned'::"text", 'engagement_completed'::"text", 'engagement_cancelled'::"text"])))),
    CONSTRAINT "applications_closure_version_check" CHECK (("closure_version" >= 0)),
    CONSTRAINT "applications_conversation_state_check" CHECK (("conversation_state" = ANY (ARRAY['open'::"text", 'closed'::"text"]))),
    CONSTRAINT "applications_queue_position_check" CHECK ((("queue_position" IS NULL) OR ("queue_position" > 0)))
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_reopen_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "closure_version" integer NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "response_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    CONSTRAINT "conversation_reopen_requests_message_check" CHECK ((("char_length"("btrim"("message")) >= 10) AND ("char_length"("btrim"("message")) <= 500))),
    CONSTRAINT "conversation_reopen_requests_participants_check" CHECK (("requested_by" <> "recipient_id")),
    CONSTRAINT "conversation_reopen_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."conversation_reopen_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guardian_consent_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "child_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "purpose" "text" DEFAULT 'basis_verification'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_ip_hash" "text",
    "created_user_agent_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "token_encrypted" "text",
    CONSTRAINT "guardian_consent_links_purpose_check" CHECK (("purpose" = 'basis_verification'::"text")),
    CONSTRAINT "guardian_consent_links_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'redeemed'::"text", 'expired'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."guardian_consent_links" OWNER TO "postgres";


COMMENT ON TABLE "public"."guardian_consent_links" IS 'One-time parent consent links for youth basis verification. Tokens are stored as hashes only.';



COMMENT ON COLUMN "public"."guardian_consent_links"."token_encrypted" IS 'Server-side encrypted raw token for showing an active basis verification link again to the authenticated child. Validation still uses token_hash.';



CREATE TABLE IF NOT EXISTS "public"."guardian_consents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "child_id" "uuid" NOT NULL,
    "link_id" "uuid",
    "parent_name" "text" NOT NULL,
    "parent_email" "text",
    "relationship_type" "text" NOT NULL,
    "signature_name" "text" NOT NULL,
    "declaration_version" "text" NOT NULL,
    "declaration_text" "text" NOT NULL,
    "consent_scope" "text" DEFAULT 'jobbridge_basis_verification'::"text" NOT NULL,
    "status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "approved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "email_verified_at" timestamp with time zone,
    "linked_guardian_id" "uuid",
    "ip_hash" "text",
    "user_agent_hash" "text",
    "risk_flags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "affirmations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "revocation_notice" "text",
    "signature_method" "text" DEFAULT 'typed_name'::"text" NOT NULL,
    CONSTRAINT "guardian_consents_parent_email_check" CHECK ((POSITION(('@'::"text") IN ("parent_email")) > 1)),
    CONSTRAINT "guardian_consents_relationship_type_check" CHECK (("relationship_type" = ANY (ARRAY['mother'::"text", 'father'::"text", 'legal_guardian'::"text", 'other_custodian'::"text"]))),
    CONSTRAINT "guardian_consents_status_check" CHECK (("status" = ANY (ARRAY['approved'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."guardian_consents" OWNER TO "postgres";


COMMENT ON TABLE "public"."guardian_consents" IS 'Auditable parent/guardian basis consent declarations for youth verification, separate from optional guardian account links.';



COMMENT ON COLUMN "public"."guardian_consents"."parent_email" IS 'Optional. Consent can be given without entering an email; linked guardian accounts may provide email via auth.';



COMMENT ON COLUMN "public"."guardian_consents"."affirmations" IS 'Exact boolean declarations confirmed by the guardian at the time of consent.';



COMMENT ON COLUMN "public"."guardian_consents"."revocation_notice" IS 'Revocation notice shown to the guardian at the time of consent.';



COMMENT ON COLUMN "public"."guardian_consents"."signature_method" IS 'Method used for electronic signature, e.g. typed_name.';



CREATE TABLE IF NOT EXISTS "public"."guardian_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "child_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "redeemed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "used_at" "date",
    "purpose" "text" DEFAULT 'guardian_account_link'::"text" NOT NULL,
    "basis_consent_link_id" "uuid",
    CONSTRAINT "guardian_invitations_purpose_check" CHECK (("purpose" = ANY (ARRAY['guardian_account_link'::"text", 'basis_account_link'::"text"]))),
    CONSTRAINT "guardian_invitations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'redeemed'::"text", 'expired'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."guardian_invitations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."guardian_invitations"."purpose" IS 'guardian_account_link = optional guardian account link; basis_account_link = account link started from a basis verification consent link.';



CREATE TABLE IF NOT EXISTS "public"."guardian_relationships" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "child_id" "uuid",
    "guardian_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'active'::"text"
);


ALTER TABLE "public"."guardian_relationships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_agreements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "job_id" "uuid" NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "timezone" "text" DEFAULT 'Europe/Berlin'::"text" NOT NULL,
    "note" "text",
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "job_agreements_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'cancelled'::"text", 'completed'::"text"]))),
    CONSTRAINT "job_agreements_time_range_check" CHECK ((("ends_at" IS NULL) OR ("ends_at" > "starts_at")))
);


ALTER TABLE "public"."job_agreements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "engagement_id" "uuid" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "timezone" "text" DEFAULT 'Europe/Berlin'::"text" NOT NULL,
    "note" "text",
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_by" "uuid",
    "legacy_agreement_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "job_appointments_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "job_appointments_time_range_check" CHECK ((("ends_at" IS NULL) OR ("ends_at" > "starts_at")))
);


ALTER TABLE "public"."job_appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_engagements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "job_id" "uuid" NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "seeker_id" "uuid" NOT NULL,
    "engagement_type" "text" DEFAULT 'one_time'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "closed_by" "uuid",
    "close_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "job_engagements_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "job_engagements_type_check" CHECK (("engagement_type" = ANY (ARRAY['one_time'::"text", 'recurring'::"text"])))
);


ALTER TABLE "public"."job_engagements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_private_details" (
    "job_id" "uuid" NOT NULL,
    "address_full" "text",
    "private_lat" double precision,
    "private_lng" double precision,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."job_private_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "posted_by" "uuid" NOT NULL,
    "status" "public"."job_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "market_id" "uuid",
    "public_location_label" "text",
    "public_lat" double precision,
    "public_lng" double precision,
    "address_reveal_policy" "text" DEFAULT 'after_apply'::"text",
    "wage_hourly" numeric,
    "category" "text" DEFAULT 'other'::"text",
    "hiring_mode" "public"."hiring_mode" DEFAULT 'first_come'::"public"."hiring_mode" NOT NULL,
    "max_applicants" integer,
    "filled_by" "uuid",
    "filled_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "reach" "text" DEFAULT 'internal_rheinbach'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "payment_type" "text" DEFAULT 'hourly'::"text" NOT NULL,
    "job_kind" "text" DEFAULT 'one_time'::"text" NOT NULL,
    "recurrence_rule" "text",
    "continuity_preferred" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "jobs_address_reveal_policy_check" CHECK (("address_reveal_policy" = ANY (ARRAY['after_apply'::"text", 'after_accept'::"text"]))),
    CONSTRAINT "jobs_job_kind_check" CHECK (("job_kind" = ANY (ARRAY['one_time'::"text", 'recurring'::"text"]))),
    CONSTRAINT "jobs_payment_type_check" CHECK (("payment_type" = ANY (ARRAY['hourly'::"text", 'fixed'::"text"]))),
    CONSTRAINT "jobs_reach_check" CHECK (("reach" = ANY (ARRAY['internal_rheinbach'::"text", 'extended'::"text"]))),
    CONSTRAINT "jobs_recurrence_rule_check" CHECK ((("recurrence_rule" IS NULL) OR ("recurrence_rule" = ANY (ARRAY['weekly'::"text", 'biweekly'::"text", 'monthly'::"text", 'flexible'::"text"]))))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "kind" "text" DEFAULT 'chat'::"text" NOT NULL,
    "client_nonce" "uuid",
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "messages_kind_check" CHECK (("kind" = ANY (ARRAY['application'::"text", 'chat'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."moderation_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "moderator_user_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "moderation_actions_target_type_check" CHECK (("target_type" = ANY (ARRAY['job'::"text", 'user'::"text", 'message'::"text", 'report'::"text"])))
);


ALTER TABLE "public"."moderation_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "user_id" "uuid" NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "email_application_updates" boolean DEFAULT true NOT NULL,
    "email_messages" boolean DEFAULT true NOT NULL,
    "email_job_updates" boolean DEFAULT true NOT NULL,
    "digest_frequency" "text" DEFAULT 'instant'::"text" NOT NULL,
    "quiet_hours_start" time without time zone,
    "quiet_hours_end" time without time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "in_app_enabled" boolean DEFAULT true NOT NULL,
    "in_app_application_updates" boolean DEFAULT true NOT NULL,
    "in_app_messages" boolean DEFAULT true NOT NULL,
    "in_app_waitlist_updates" boolean DEFAULT true NOT NULL,
    "in_app_appointments" boolean DEFAULT true NOT NULL,
    "email_waitlist_updates" boolean DEFAULT true NOT NULL,
    "email_appointments" boolean DEFAULT true NOT NULL,
    "timezone" "text" DEFAULT 'Europe/Berlin'::"text" NOT NULL,
    CONSTRAINT "notification_preferences_digest_check" CHECK (("digest_frequency" = ANY (ARRAY['instant'::"text", 'daily'::"text", 'weekly'::"text"]))),
    CONSTRAINT "notification_preferences_digest_frequency_check" CHECK (("digest_frequency" = ANY (ARRAY['instant'::"text", 'daily'::"text", 'weekly'::"text"]))),
    CONSTRAINT "notification_preferences_quiet_hours_check" CHECK (((("quiet_hours_start" IS NULL) AND ("quiet_hours_end" IS NULL)) OR (("quiet_hours_start" IS NOT NULL) AND ("quiet_hours_end" IS NOT NULL))))
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "data" "jsonb",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category" "text" DEFAULT 'system'::"text" NOT NULL,
    "dedupe_key" "text",
    CONSTRAINT "notifications_category_check" CHECK (("category" = ANY (ARRAY['messages'::"text", 'applications'::"text", 'waitlist'::"text", 'appointments'::"text", 'jobs'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "birthdate" "date",
    "city" "text",
    "user_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_type" "public"."account_type" DEFAULT 'job_seeker'::"public"."account_type" NOT NULL,
    "email_verified_at" timestamp with time zone,
    "phone_verified_at" timestamp with time zone,
    "guardian_status" "public"."guardian_status" DEFAULT 'none'::"public"."guardian_status" NOT NULL,
    "guardian_id" "uuid",
    "country" "text" DEFAULT 'DE'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "market_id" "uuid",
    "theme_preference" "text" DEFAULT 'system'::"text" NOT NULL,
    "email" "text",
    "provider_kind" "public"."provider_kind",
    "guardian_verified_at" timestamp with time zone,
    "provider_verification_status" "public"."provider_verification_status" DEFAULT 'none'::"public"."provider_verification_status" NOT NULL,
    "provider_verified_at" timestamp with time zone,
    "company_name" "text",
    "company_contact_email" "text",
    "company_message" "text",
    "bio" "text",
    "interests" "text",
    "skills" "text",
    "availability_note" "text",
    "avatar_url" "text",
    "street" "text",
    "house_number" "text",
    "zip" "text",
    "lat" double precision,
    "lng" double precision,
    "mobile_nav_preference" "text" DEFAULT 'bottom'::"text" NOT NULL,
    CONSTRAINT "profiles_mobile_nav_preference_check" CHECK (("mobile_nav_preference" = ANY (ARRAY['top'::"text", 'bottom'::"text"]))),
    CONSTRAINT "profiles_theme_preference_check" CHECK (("theme_preference" = ANY (ARRAY['light'::"text", 'dark'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."avatar_url" IS 'URL to the users profile picture';



CREATE TABLE IF NOT EXISTS "public"."regions_live" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "city" "text" NOT NULL,
    "postal_code" "text",
    "federal_state" "text" NOT NULL,
    "country" "text" DEFAULT 'DE'::"text" NOT NULL,
    "openplz_municipality_key" "text",
    "is_live" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "brand_prefix" "text" DEFAULT 'JobBridge'::"text",
    "display_name" "text"
);


ALTER TABLE "public"."regions_live" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_user_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "reason_code" "text" NOT NULL,
    "details" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "application_id" "uuid",
    "reported_user_id" "uuid",
    "message_id" "uuid",
    "reopen_request_id" "uuid",
    "evidence_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "evidence_captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reviewing'::"text", 'resolved'::"text", 'dismissed'::"text"]))),
    CONSTRAINT "reports_target_type_check" CHECK (("target_type" = ANY (ARRAY['job'::"text", 'user'::"text", 'message'::"text", 'reopen_request'::"text"])))
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."security_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "event_type" "text" NOT NULL,
    "ip_address" "inet" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."security_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_system_roles" (
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_system_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "city" "text" NOT NULL,
    "federal_state" "text",
    "country" "text" DEFAULT 'DE'::"text",
    "role" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."waitlist" OWNER TO "postgres";


ALTER TABLE ONLY "public"."application_events"
    ADD CONSTRAINT "application_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_reopen_requests"
    ADD CONSTRAINT "conversation_reopen_requests_one_per_closure" UNIQUE ("application_id", "closure_version", "requested_by");



ALTER TABLE ONLY "public"."conversation_reopen_requests"
    ADD CONSTRAINT "conversation_reopen_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardian_consent_links"
    ADD CONSTRAINT "guardian_consent_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardian_consent_links"
    ADD CONSTRAINT "guardian_consent_links_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."guardian_consents"
    ADD CONSTRAINT "guardian_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardian_invitations"
    ADD CONSTRAINT "guardian_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardian_invitations"
    ADD CONSTRAINT "guardian_invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."guardian_relationships"
    ADD CONSTRAINT "guardian_relationships_child_id_guardian_id_key" UNIQUE ("child_id", "guardian_id");



ALTER TABLE ONLY "public"."guardian_relationships"
    ADD CONSTRAINT "guardian_relationships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_agreements"
    ADD CONSTRAINT "job_agreements_application_id_key" UNIQUE ("application_id");



ALTER TABLE ONLY "public"."job_agreements"
    ADD CONSTRAINT "job_agreements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_appointments"
    ADD CONSTRAINT "job_appointments_legacy_agreement_id_key" UNIQUE ("legacy_agreement_id");



ALTER TABLE ONLY "public"."job_appointments"
    ADD CONSTRAINT "job_appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_engagements"
    ADD CONSTRAINT "job_engagements_application_id_key" UNIQUE ("application_id");



ALTER TABLE ONLY "public"."job_engagements"
    ADD CONSTRAINT "job_engagements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_private_details"
    ADD CONSTRAINT "job_private_details_pkey" PRIMARY KEY ("job_id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."moderation_actions"
    ADD CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regions_live"
    ADD CONSTRAINT "regions_live_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_events"
    ADD CONSTRAINT "security_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_roles"
    ADD CONSTRAINT "system_roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."system_roles"
    ADD CONSTRAINT "system_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "unique_application" UNIQUE ("job_id", "user_id");



ALTER TABLE ONLY "public"."user_system_roles"
    ADD CONSTRAINT "user_system_roles_pkey" PRIMARY KEY ("user_id", "role_id");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");



CREATE INDEX "guardian_consent_links_child_status_idx" ON "public"."guardian_consent_links" USING "btree" ("child_id", "status", "expires_at" DESC);



CREATE INDEX "guardian_consents_child_status_idx" ON "public"."guardian_consents" USING "btree" ("child_id", "status", "approved_at" DESC);



CREATE INDEX "guardian_consents_link_id_idx" ON "public"."guardian_consents" USING "btree" ("link_id") WHERE ("link_id" IS NOT NULL);



CREATE INDEX "guardian_consents_linked_guardian_id_idx" ON "public"."guardian_consents" USING "btree" ("linked_guardian_id") WHERE ("linked_guardian_id" IS NOT NULL);



CREATE UNIQUE INDEX "guardian_consents_one_approved_per_child_idx" ON "public"."guardian_consents" USING "btree" ("child_id") WHERE ("status" = 'approved'::"text");



CREATE INDEX "guardian_invitations_basis_consent_link_id_idx" ON "public"."guardian_invitations" USING "btree" ("basis_consent_link_id");



CREATE INDEX "guardian_invitations_child_purpose_status_idx" ON "public"."guardian_invitations" USING "btree" ("child_id", "purpose", "status", "expires_at" DESC);



CREATE UNIQUE INDEX "guardian_invitations_one_active_guardian_link_idx" ON "public"."guardian_invitations" USING "btree" ("child_id") WHERE (("status" = 'active'::"text") AND ("purpose" = 'guardian_account_link'::"text"));



CREATE INDEX "idx_application_events_actor" ON "public"."application_events" USING "btree" ("actor_id") WHERE ("actor_id" IS NOT NULL);



CREATE INDEX "idx_application_events_timeline" ON "public"."application_events" USING "btree" ("application_id", "created_at", "id");



CREATE INDEX "idx_applications_closed_by" ON "public"."applications" USING "btree" ("closed_by") WHERE ("closed_by" IS NOT NULL);



CREATE INDEX "idx_applications_job_created" ON "public"."applications" USING "btree" ("job_id", "created_at" DESC);



CREATE INDEX "idx_applications_job_id" ON "public"."applications" USING "btree" ("job_id");



CREATE INDEX "idx_applications_job_queue" ON "public"."applications" USING "btree" ("job_id", "is_primary" DESC, "queue_position", "created_at", "id");



CREATE INDEX "idx_applications_job_status_created" ON "public"."applications" USING "btree" ("job_id", "status", "created_at", "id");



CREATE INDEX "idx_applications_last_activity" ON "public"."applications" USING "btree" ("last_activity_at" DESC, "id");



CREATE UNIQUE INDEX "idx_applications_one_primary_per_job" ON "public"."applications" USING "btree" ("job_id") WHERE ("is_primary" AND ("status" = ANY (ARRAY['submitted'::"public"."application_status", 'negotiating'::"public"."application_status", 'accepted'::"public"."application_status"])));



CREATE INDEX "idx_applications_promoted_by" ON "public"."applications" USING "btree" ("promoted_by") WHERE ("promoted_by" IS NOT NULL);



CREATE INDEX "idx_applications_reopened_by" ON "public"."applications" USING "btree" ("reopened_by") WHERE ("reopened_by" IS NOT NULL);



CREATE INDEX "idx_applications_user_created" ON "public"."applications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_applications_user_id" ON "public"."applications" USING "btree" ("user_id");



CREATE INDEX "idx_guardian_invitations_child_id" ON "public"."guardian_invitations" USING "btree" ("child_id");



CREATE INDEX "idx_guardian_invitations_redeemed_by" ON "public"."guardian_invitations" USING "btree" ("redeemed_by");



CREATE INDEX "idx_guardian_invitations_token" ON "public"."guardian_invitations" USING "btree" ("token");



CREATE INDEX "idx_guardian_relationships_guardian_id" ON "public"."guardian_relationships" USING "btree" ("guardian_id");



CREATE INDEX "idx_job_agreements_job_status" ON "public"."job_agreements" USING "btree" ("job_id", "status");



CREATE INDEX "idx_job_agreements_provider_schedule" ON "public"."job_agreements" USING "btree" ("provider_id", "starts_at" DESC);



CREATE INDEX "idx_job_agreements_seeker_schedule" ON "public"."job_agreements" USING "btree" ("seeker_id", "starts_at" DESC);



CREATE INDEX "idx_job_appointments_created_by" ON "public"."job_appointments" USING "btree" ("created_by") WHERE ("created_by" IS NOT NULL);



CREATE INDEX "idx_job_appointments_engagement_schedule" ON "public"."job_appointments" USING "btree" ("engagement_id", "starts_at" DESC, "id" DESC);



CREATE INDEX "idx_job_engagements_closed_by" ON "public"."job_engagements" USING "btree" ("closed_by") WHERE ("closed_by" IS NOT NULL);



CREATE INDEX "idx_job_engagements_job_status" ON "public"."job_engagements" USING "btree" ("job_id", "status");



CREATE INDEX "idx_job_engagements_participants" ON "public"."job_engagements" USING "btree" ("provider_id", "seeker_id", "status");



CREATE INDEX "idx_job_engagements_seeker" ON "public"."job_engagements" USING "btree" ("seeker_id", "status", "updated_at" DESC);



CREATE INDEX "idx_jobs_filled_by" ON "public"."jobs" USING "btree" ("filled_by") WHERE ("filled_by" IS NOT NULL);



CREATE INDEX "idx_jobs_hiring_mode" ON "public"."jobs" USING "btree" ("hiring_mode");



CREATE INDEX "idx_jobs_market_id" ON "public"."jobs" USING "btree" ("market_id");



CREATE INDEX "idx_jobs_posted_by" ON "public"."jobs" USING "btree" ("posted_by");



CREATE INDEX "idx_jobs_posted_by_created" ON "public"."jobs" USING "btree" ("posted_by", "created_at" DESC);



CREATE INDEX "idx_jobs_status" ON "public"."jobs" USING "btree" ("status");



CREATE INDEX "idx_jobs_status_created" ON "public"."jobs" USING "btree" ("status", "created_at" DESC);



CREATE UNIQUE INDEX "idx_messages_application_message_once" ON "public"."messages" USING "btree" ("application_id") WHERE ("kind" = 'application'::"text");



CREATE INDEX "idx_messages_application_timeline" ON "public"."messages" USING "btree" ("application_id", "created_at" DESC, "id" DESC);



CREATE INDEX "idx_messages_application_unread" ON "public"."messages" USING "btree" ("application_id", "sender_id") WHERE ("read_at" IS NULL);



CREATE UNIQUE INDEX "idx_messages_sender_nonce" ON "public"."messages" USING "btree" ("sender_id", "client_nonce") WHERE ("client_nonce" IS NOT NULL);



CREATE INDEX "idx_moderation_actions_created" ON "public"."moderation_actions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_moderation_actions_moderator_user_id" ON "public"."moderation_actions" USING "btree" ("moderator_user_id");



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_user_created" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_notifications_user_dedupe" ON "public"."notifications" USING "btree" ("user_id", "dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id") WHERE ("read_at" IS NULL);



CREATE INDEX "idx_profiles_guardian_id" ON "public"."profiles" USING "btree" ("guardian_id");



CREATE INDEX "idx_profiles_market_id" ON "public"."profiles" USING "btree" ("market_id");



CREATE INDEX "idx_reopen_requests_application" ON "public"."conversation_reopen_requests" USING "btree" ("application_id", "created_at" DESC);



CREATE INDEX "idx_reopen_requests_recipient_pending" ON "public"."conversation_reopen_requests" USING "btree" ("recipient_id", "created_at" DESC) WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_reopen_requests_requested_by" ON "public"."conversation_reopen_requests" USING "btree" ("requested_by", "created_at" DESC);



CREATE INDEX "idx_reopen_requests_resolved_by" ON "public"."conversation_reopen_requests" USING "btree" ("resolved_by") WHERE ("resolved_by" IS NOT NULL);



CREATE INDEX "idx_reports_application_created" ON "public"."reports" USING "btree" ("application_id", "created_at" DESC) WHERE ("application_id" IS NOT NULL);



CREATE INDEX "idx_reports_message" ON "public"."reports" USING "btree" ("message_id") WHERE ("message_id" IS NOT NULL);



CREATE INDEX "idx_reports_reopen_request" ON "public"."reports" USING "btree" ("reopen_request_id") WHERE ("reopen_request_id" IS NOT NULL);



CREATE INDEX "idx_reports_reported_user" ON "public"."reports" USING "btree" ("reported_user_id", "created_at" DESC) WHERE ("reported_user_id" IS NOT NULL);



CREATE INDEX "idx_reports_reporter_user_id" ON "public"."reports" USING "btree" ("reporter_user_id");



CREATE INDEX "idx_reports_status_created" ON "public"."reports" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_security_events_user_id_created" ON "public"."security_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_user_system_roles_role_id" ON "public"."user_system_roles" USING "btree" ("role_id");



CREATE INDEX "idx_waitlist_normalized_email" ON "public"."waitlist" USING "btree" ("lower"("btrim"("email")));



CREATE OR REPLACE TRIGGER "applications_notify_provider_on_automatic_promotion" AFTER UPDATE OF "status", "is_primary", "promoted_at", "promoted_by" ON "public"."applications" FOR EACH ROW WHEN ((("old"."status" = 'waitlisted'::"public"."application_status") AND ("new"."status" = 'negotiating'::"public"."application_status") AND ("new"."is_primary" IS TRUE) AND ("new"."promoted_at" IS NOT NULL) AND ("new"."promoted_by" IS NULL))) EXECUTE FUNCTION "public"."notify_provider_on_automatic_promotion"();



CREATE OR REPLACE TRIGGER "applications_set_activity_timestamp" BEFORE UPDATE ON "public"."applications" FOR EACH ROW EXECUTE FUNCTION "public"."set_application_activity_timestamp"();



CREATE OR REPLACE TRIGGER "enforce_eligible_guardian_relationship" BEFORE INSERT OR UPDATE OF "child_id", "guardian_id", "status" ON "public"."guardian_relationships" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_eligible_guardian_relationship"();



CREATE OR REPLACE TRIGGER "enforce_verified_provider_job_insert" BEFORE INSERT ON "public"."jobs" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_verified_provider_job_insert"();



CREATE OR REPLACE TRIGGER "invalidate_provider_verification_on_address_change" BEFORE UPDATE OF "street", "house_number", "city", "zip", "country", "lat", "lng" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_provider_verification_on_address_change"();



CREATE OR REPLACE TRIGGER "job_appointments_set_updated_at" BEFORE UPDATE ON "public"."job_appointments" FOR EACH ROW EXECUTE FUNCTION "public"."set_row_updated_at"();



CREATE OR REPLACE TRIGGER "job_engagements_set_updated_at" BEFORE UPDATE ON "public"."job_engagements" FOR EACH ROW EXECUTE FUNCTION "public"."set_row_updated_at"();



CREATE OR REPLACE TRIGGER "messages_humanize_activity_copy" BEFORE INSERT OR UPDATE OF "content", "kind" ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."humanize_activity_system_message_copy"();



CREATE OR REPLACE TRIGGER "messages_touch_application" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."touch_application_from_message"();



CREATE OR REPLACE TRIGGER "notifications_humanize_application_copy" BEFORE INSERT OR UPDATE OF "type", "title", "body", "data" ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."humanize_application_notification_copy"();



CREATE OR REPLACE TRIGGER "notifications_prepare_delivery" BEFORE INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_notification_delivery"();



CREATE OR REPLACE TRIGGER "protect_active_guardian_eligibility" BEFORE UPDATE OF "account_type", "provider_kind", "birthdate", "full_name", "city" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_active_guardian_eligibility"();



CREATE OR REPLACE TRIGGER "reopen_requests_touch_application" AFTER INSERT ON "public"."conversation_reopen_requests" FOR EACH ROW EXECUTE FUNCTION "public"."touch_application_from_reopen_request"();



CREATE OR REPLACE TRIGGER "tr_regions_display_name" BEFORE INSERT ON "public"."regions_live" FOR EACH ROW EXECUTE FUNCTION "public"."sync_regions_display_name"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."application_events"
    ADD CONSTRAINT "application_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."application_events"
    ADD CONSTRAINT "application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_promoted_by_fkey" FOREIGN KEY ("promoted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."conversation_reopen_requests"
    ADD CONSTRAINT "conversation_reopen_requests_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_reopen_requests"
    ADD CONSTRAINT "conversation_reopen_requests_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_reopen_requests"
    ADD CONSTRAINT "conversation_reopen_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_reopen_requests"
    ADD CONSTRAINT "conversation_reopen_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."guardian_consent_links"
    ADD CONSTRAINT "guardian_consent_links_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guardian_consents"
    ADD CONSTRAINT "guardian_consents_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guardian_consents"
    ADD CONSTRAINT "guardian_consents_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."guardian_consent_links"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."guardian_consents"
    ADD CONSTRAINT "guardian_consents_linked_guardian_id_fkey" FOREIGN KEY ("linked_guardian_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."guardian_invitations"
    ADD CONSTRAINT "guardian_invitations_basis_consent_link_id_fkey" FOREIGN KEY ("basis_consent_link_id") REFERENCES "public"."guardian_consent_links"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."guardian_invitations"
    ADD CONSTRAINT "guardian_invitations_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guardian_invitations"
    ADD CONSTRAINT "guardian_invitations_redeemed_by_fkey" FOREIGN KEY ("redeemed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."guardian_relationships"
    ADD CONSTRAINT "guardian_relationships_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."guardian_relationships"
    ADD CONSTRAINT "guardian_relationships_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_agreements"
    ADD CONSTRAINT "job_agreements_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_agreements"
    ADD CONSTRAINT "job_agreements_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_agreements"
    ADD CONSTRAINT "job_agreements_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_agreements"
    ADD CONSTRAINT "job_agreements_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_appointments"
    ADD CONSTRAINT "job_appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."job_appointments"
    ADD CONSTRAINT "job_appointments_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "public"."job_engagements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_appointments"
    ADD CONSTRAINT "job_appointments_legacy_agreement_id_fkey" FOREIGN KEY ("legacy_agreement_id") REFERENCES "public"."job_agreements"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."job_engagements"
    ADD CONSTRAINT "job_engagements_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_engagements"
    ADD CONSTRAINT "job_engagements_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."job_engagements"
    ADD CONSTRAINT "job_engagements_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_engagements"
    ADD CONSTRAINT "job_engagements_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_engagements"
    ADD CONSTRAINT "job_engagements_seeker_id_fkey" FOREIGN KEY ("seeker_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_private_details"
    ADD CONSTRAINT "job_private_details_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_filled_by_fkey" FOREIGN KEY ("filled_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."regions_live"("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."moderation_actions"
    ADD CONSTRAINT "moderation_actions_moderator_user_id_fkey" FOREIGN KEY ("moderator_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."regions_live"("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_reopen_request_id_fkey" FOREIGN KEY ("reopen_request_id") REFERENCES "public"."conversation_reopen_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."security_events"
    ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_system_roles"
    ADD CONSTRAINT "user_system_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."system_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_system_roles"
    ADD CONSTRAINT "user_system_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Participants can view application events" ON "public"."application_events" FOR SELECT TO "authenticated" USING ("public"."is_application_participant"("application_id"));



CREATE POLICY "Participants can view appointments" ON "public"."job_appointments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."job_engagements" "e"
  WHERE (("e"."id" = "job_appointments"."engagement_id") AND (("e"."provider_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("e"."seeker_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Participants can view engagements" ON "public"."job_engagements" FOR SELECT TO "authenticated" USING ((("provider_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("seeker_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Participants can view job agreements" ON "public"."job_agreements" FOR SELECT TO "authenticated" USING ((("provider_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("seeker_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Participants can view reopen requests" ON "public"."conversation_reopen_requests" FOR SELECT TO "authenticated" USING ("public"."is_application_participant"("application_id"));



CREATE POLICY "Users can view messages for their applications" ON "public"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."applications" "application"
     JOIN "public"."jobs" "job" ON (("job"."id" = "application"."job_id")))
  WHERE (("application"."id" = "messages"."application_id") AND (("application"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("job"."posted_by" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Users can view own reports" ON "public"."reports" FOR SELECT TO "authenticated" USING (("reporter_user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view own system roles" ON "public"."user_system_roles" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."application_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "applications_select_participants" ON "public"."applications" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND (("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."jobs" "job"
  WHERE (("job"."id" = "applications"."job_id") AND ("job"."posted_by" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."conversation_reopen_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "guardian consent links child can read own" ON "public"."guardian_consent_links" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "child_id"));



CREATE POLICY "guardian consents child can read own" ON "public"."guardian_consents" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "child_id"));



ALTER TABLE "public"."guardian_consent_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guardian_consents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."guardian_invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "guardian_invitations_select_own" ON "public"."guardian_invitations" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "child_id"));



ALTER TABLE "public"."guardian_relationships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "guardian_relationships_select" ON "public"."guardian_relationships" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "child_id") OR (( SELECT "auth"."uid"() AS "uid") = "guardian_id")));



ALTER TABLE "public"."job_agreements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_engagements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_private_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "jobs_select_authenticated" ON "public"."jobs" FOR SELECT TO "authenticated" USING ((("status" = ANY (ARRAY['open'::"public"."job_status", 'reserved'::"public"."job_status"])) OR ("posted_by" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_activity_job_participant"("id")));



CREATE POLICY "jobs_select_public" ON "public"."jobs" FOR SELECT TO "anon" USING (("status" = 'open'::"public"."job_status"));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."moderation_actions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "moderation_actions_service_only" ON "public"."moderation_actions" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_preferences_insert_own" ON "public"."notification_preferences" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notification_preferences_select_own" ON "public"."notification_preferences" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notification_preferences_update_own" ON "public"."notification_preferences" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_select_own" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND ("id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "id") AND (("birthdate" IS NULL) OR ((NULLIF("btrim"("full_name"), ''::"text") IS NOT NULL) AND (NULLIF("btrim"("city"), ''::"text") IS NOT NULL)))));



ALTER TABLE "public"."regions_live" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regions_live_public_read" ON "public"."regions_live" FOR SELECT USING (true);



ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."security_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "security_events_service_only" ON "public"."security_events" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."system_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_roles_read" ON "public"."system_roles" FOR SELECT USING (true);



ALTER TABLE "public"."user_system_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."_activity_close_application"("p_application_id" "uuid", "p_actor_id" "uuid", "p_action" "text", "p_reason" "text", "p_status" "public"."application_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_activity_close_application"("p_application_id" "uuid", "p_actor_id" "uuid", "p_action" "text", "p_reason" "text", "p_status" "public"."application_status") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_activity_rebalance_job"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_activity_rebalance_job"("p_job_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_activity_reopen_application"("p_application_id" "uuid", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_activity_reopen_application"("p_application_id" "uuid", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_rebalance_job_after_application_exit"("p_job_id" "uuid", "p_exiting_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_rebalance_job_after_application_exit"("p_job_id" "uuid", "p_exiting_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_distance"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_distance"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_distance"("lat1" double precision, "lon1" double precision, "lat2" double precision, "lon2" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_job_engagement"("p_application_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_job_engagement"("p_application_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_job_engagement"("p_application_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_profile_onboarding"("p_full_name" "text", "p_birthdate" "date", "p_city" "text", "p_market_id" "uuid", "p_account_type" "public"."account_type", "p_provider_kind" "public"."provider_kind", "p_company_name" "text", "p_company_contact_email" "text", "p_company_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_profile_onboarding"("p_full_name" "text", "p_birthdate" "date", "p_city" "text", "p_market_id" "uuid", "p_account_type" "public"."account_type", "p_provider_kind" "public"."provider_kind", "p_company_name" "text", "p_company_contact_email" "text", "p_company_message" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."confirm_job_engagement"("p_application_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_timezone" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_job_engagement"("p_application_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_timezone" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_job_engagement"("p_application_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_timezone" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_guardian_invitation"("p_invited_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_guardian_invitation"("p_invited_email" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_job_v2"("p_market_id" "uuid", "p_title" "text", "p_description" "text", "p_wage" numeric, "p_category" "text", "p_payment_type" "text", "p_status" "public"."job_status", "p_address_reveal_policy" "text", "p_public_location_label" "text", "p_public_lat" double precision, "p_public_lng" double precision, "p_reach" "text", "p_job_kind" "text", "p_recurrence_rule" "text", "p_continuity_preferred" boolean, "p_address_full" "text", "p_private_lat" double precision, "p_private_lng" double precision, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_job_v2"("p_market_id" "uuid", "p_title" "text", "p_description" "text", "p_wage" numeric, "p_category" "text", "p_payment_type" "text", "p_status" "public"."job_status", "p_address_reveal_policy" "text", "p_public_location_label" "text", "p_public_lat" double precision, "p_public_lng" double precision, "p_reach" "text", "p_job_kind" "text", "p_recurrence_rule" "text", "p_continuity_preferred" boolean, "p_address_full" "text", "p_private_lat" double precision, "p_private_lng" double precision, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_job_v2"("p_market_id" "uuid", "p_title" "text", "p_description" "text", "p_wage" numeric, "p_category" "text", "p_payment_type" "text", "p_status" "public"."job_status", "p_address_reveal_policy" "text", "p_public_location_label" "text", "p_public_lat" double precision, "p_public_lng" double precision, "p_reach" "text", "p_job_kind" "text", "p_recurrence_rule" "text", "p_continuity_preferred" boolean, "p_address_full" "text", "p_private_lat" double precision, "p_private_lng" double precision, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_eligible_guardian_relationship"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."enforce_verified_provider_job_insert"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."get_activity_inbox_summaries"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_activity_inbox_summaries"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_activity_inbox_summaries"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_activity_partner_profiles"("p_application_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_activity_partner_profiles"("p_application_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_activity_partner_profiles"("p_application_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_authorized_job_location"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_authorized_job_location"("p_job_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_guardian_invitation_info"("token_input" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_guardian_invitation_info"("token_input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_guardian_invitation_info"("token_input" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_security_events"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_security_events"("p_limit" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_visible_job_creator_summaries"("p_job_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_visible_job_creator_summaries"("p_job_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_visible_job_creator_summaries"("p_job_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_waitlist_job_summaries"("p_job_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_waitlist_job_summaries"("p_job_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_waitlist_job_summaries"("p_job_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_system_role"("user_id" "uuid", "required_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_system_role"("user_id" "uuid", "required_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."humanize_activity_system_message_copy"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."humanize_application_notification_copy"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."invalidate_provider_verification_on_address_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."is_activity_job_participant"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_activity_job_participant"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_activity_job_participant"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_application_participant"("p_application_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_application_participant"("p_application_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_application_participant"("p_application_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_staff"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_staff"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_staff"("p_uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_staff"("p_uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_launch_waitlist"("p_email" "text", "p_city" "text", "p_federal_state" "text", "p_country" "text", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_launch_waitlist"("p_email" "text", "p_city" "text", "p_federal_state" "text", "p_country" "text", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_launch_waitlist"("p_email" "text", "p_city" "text", "p_federal_state" "text", "p_country" "text", "p_role" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_all_notifications_read"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_application_messages_read"("p_application_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_application_messages_read"("p_application_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_application_messages_read"("p_application_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_notification_read"("p_notification_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_provider_on_automatic_promotion"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."prepare_notification_delivery"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_notification_delivery"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."promote_waitlisted_application"("p_application_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promote_waitlisted_application"("p_application_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_waitlisted_application"("p_application_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protect_active_guardian_eligibility"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."redeem_guardian_invitation"("token_input" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."redeem_guardian_invitation"("token_input" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reject_application"("p_application_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_application"("p_application_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_application"("p_application_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reopen_application"("p_application_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reopen_application"("p_application_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reopen_application"("p_application_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_activity_item"("p_application_id" "uuid", "p_reason_code" "text", "p_details" "text", "p_reported_user_id" "uuid", "p_message_id" "uuid", "p_reopen_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_activity_item"("p_application_id" "uuid", "p_reason_code" "text", "p_details" "text", "p_reported_user_id" "uuid", "p_message_id" "uuid", "p_reopen_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_activity_item"("p_application_id" "uuid", "p_reason_code" "text", "p_details" "text", "p_reported_user_id" "uuid", "p_message_id" "uuid", "p_reopen_request_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_conversation_reopen"("p_application_id" "uuid", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_conversation_reopen"("p_application_id" "uuid", "p_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_conversation_reopen"("p_application_id" "uuid", "p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_provider_verification"("p_street" "text", "p_house_number" "text", "p_city" "text", "p_zip" "text", "p_lat" numeric, "p_lng" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_provider_verification"("p_street" "text", "p_house_number" "text", "p_city" "text", "p_zip" "text", "p_lat" numeric, "p_lng" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."respond_to_conversation_reopen_request"("p_request_id" "uuid", "p_accept" boolean, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_to_conversation_reopen_request"("p_request_id" "uuid", "p_accept" boolean, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."respond_to_conversation_reopen_request"("p_request_id" "uuid", "p_accept" boolean, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_application_message"("p_application_id" "uuid", "p_content" "text", "p_client_nonce" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_application_message"("p_application_id" "uuid", "p_content" "text", "p_client_nonce" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_application_message"("p_application_id" "uuid", "p_content" "text", "p_client_nonce" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_application_activity_timestamp"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_application_activity_timestamp"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_row_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_row_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_job_application"("p_job_id" "uuid", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_job_application"("p_job_id" "uuid", "p_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_job_application"("p_job_id" "uuid", "p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_profile_from_auth_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_profile_from_auth_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_regions_display_name"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_regions_display_name"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_user_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_user_email"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_application_from_message"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_application_from_message"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_application_from_reopen_request"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_application_from_reopen_request"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_owned_job_details"("p_job_id" "uuid", "p_expected_status" "public"."job_status", "p_title" "text", "p_description" "text", "p_wage_hourly" numeric, "p_category" "text", "p_payment_type" "text", "p_reach" "text", "p_status" "public"."job_status", "p_job_kind" "text", "p_recurrence_rule" "text", "p_continuity_preferred" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_owned_job_details"("p_job_id" "uuid", "p_expected_status" "public"."job_status", "p_title" "text", "p_description" "text", "p_wage_hourly" numeric, "p_category" "text", "p_payment_type" "text", "p_reach" "text", "p_status" "public"."job_status", "p_job_kind" "text", "p_recurrence_rule" "text", "p_continuity_preferred" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."withdraw_application"("p_application_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."withdraw_application"("p_application_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."withdraw_application"("p_application_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON TABLE "public"."application_events" TO "service_role";
GRANT SELECT ON TABLE "public"."application_events" TO "authenticated";



GRANT ALL ON TABLE "public"."applications" TO "service_role";
GRANT SELECT ON TABLE "public"."applications" TO "authenticated";



GRANT ALL ON TABLE "public"."conversation_reopen_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."conversation_reopen_requests" TO "authenticated";



GRANT ALL ON TABLE "public"."guardian_consent_links" TO "service_role";
GRANT SELECT ON TABLE "public"."guardian_consent_links" TO "authenticated";



GRANT ALL ON TABLE "public"."guardian_consents" TO "service_role";
GRANT SELECT ON TABLE "public"."guardian_consents" TO "authenticated";



GRANT ALL ON TABLE "public"."guardian_invitations" TO "service_role";
GRANT SELECT ON TABLE "public"."guardian_invitations" TO "authenticated";



GRANT ALL ON TABLE "public"."guardian_relationships" TO "service_role";
GRANT SELECT ON TABLE "public"."guardian_relationships" TO "authenticated";



GRANT ALL ON TABLE "public"."job_agreements" TO "service_role";
GRANT SELECT ON TABLE "public"."job_agreements" TO "authenticated";



GRANT ALL ON TABLE "public"."job_appointments" TO "service_role";
GRANT SELECT ON TABLE "public"."job_appointments" TO "authenticated";



GRANT ALL ON TABLE "public"."job_engagements" TO "service_role";
GRANT SELECT ON TABLE "public"."job_engagements" TO "authenticated";



GRANT ALL ON TABLE "public"."job_private_details" TO "service_role";



GRANT ALL ON TABLE "public"."jobs" TO "service_role";
GRANT SELECT ON TABLE "public"."jobs" TO "anon";
GRANT SELECT ON TABLE "public"."jobs" TO "authenticated";



GRANT ALL ON TABLE "public"."messages" TO "service_role";
GRANT SELECT ON TABLE "public"."messages" TO "authenticated";



GRANT ALL ON TABLE "public"."moderation_actions" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."notification_preferences" TO "authenticated";



GRANT ALL ON TABLE "public"."notifications" TO "service_role";
GRANT SELECT ON TABLE "public"."notifications" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("city") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("theme_preference") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("bio") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("interests") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("skills") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("availability_note") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("street") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("house_number") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("zip") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("lat") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("lng") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("mobile_nav_preference") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."regions_live" TO "service_role";
GRANT SELECT ON TABLE "public"."regions_live" TO "anon";
GRANT SELECT ON TABLE "public"."regions_live" TO "authenticated";



GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."security_events" TO "service_role";



GRANT ALL ON TABLE "public"."system_roles" TO "service_role";
GRANT SELECT ON TABLE "public"."system_roles" TO "authenticated";



GRANT ALL ON TABLE "public"."user_system_roles" TO "service_role";
GRANT SELECT ON TABLE "public"."user_system_roles" TO "authenticated";



GRANT ALL ON TABLE "public"."waitlist" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_email_update AFTER UPDATE OF email ON auth.users FOR EACH ROW WHEN (((old.email)::text IS DISTINCT FROM (new.email)::text)) EXECUTE FUNCTION public.sync_user_email();

CREATE TRIGGER trg_sync_profile_from_auth_user AFTER INSERT OR UPDATE OF email, email_confirmed_at, phone_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_profile_from_auth_user();
