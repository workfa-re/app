-- DRAFT ONLY. Install solely into the separately verified, isolated demo database.
-- Depends on the complete source schema, uuid-ossp in extensions, and the
-- demo_private visits/personas + public.demo_bind_identities isolation contract.
-- No auth users, sessions, tokens, SMTP settings or production data are created here.

BEGIN;
DO $$ BEGIN
  IF current_setting('workfare.demo_target', true) IS DISTINCT FROM 'isolated-local-demo' THEN
    RAISE EXCEPTION 'Local demo target confirmation missing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION demo_private.seed_entity_id(p_session_id uuid, p_key text)
RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT extensions.uuid_generate_v5(p_session_id, 'workfare-platform-demo-v1:' || p_key);
$$;
REVOKE ALL ON FUNCTION demo_private.seed_entity_id(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION demo_private.seed_entity_id(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION demo_private.seed_demo_session(
  p_session_id uuid,
  p_identities jsonb,
  p_seed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_template constant jsonb := $template${
  "version": "workfare-platform-demo-v1",
  "synthetic": true,
  "description": "Gemeinsame Vorlage für die drei öffentlichen Demoansichten und ihre echten Datenbankbeispiele.",
  "public_roles": [
    {
      "id": "seeker",
      "label": "Suchende",
      "identity_alias": "seeker"
    },
    {
      "id": "private-provider",
      "label": "Private Anbieter",
      "identity_alias": "private-provider"
    },
    {
      "id": "company",
      "label": "Unternehmen",
      "identity_alias": "company"
    }
  ],
  "email_pattern": "demo+{session_uuid}.{identity_alias}@example.test",
  "profiles": [
    {
      "alias": "seeker",
      "name": "Mila Beispiel",
      "age": 17,
      "account_type": "job_seeker",
      "provider_kind": null,
      "street": "Beispielweg",
      "house_number": "4",
      "bio": "Ich bin Mila und unterstütze gern Menschen in meiner Nachbarschaft. Dieses Profil ist frei erfunden.",
      "interests": "Garten, Tiere und Technik",
      "skills": "Zuverlässig, geduldig und gut organisiert",
      "availability": "Nachmittags nach der Schule und samstags"
    },
    {
      "alias": "private-provider",
      "name": "Robin Muster",
      "age": 35,
      "account_type": "job_provider",
      "provider_kind": "private",
      "street": "Musterallee",
      "house_number": "12",
      "bio": "Bei uns gibt es immer etwas im Garten oder Haushalt zu tun. Wir freuen uns über zuverlässige Unterstützung. Fiktives Beispielprofil.",
      "interests": "Garten und Nachbarschaft",
      "skills": "Klare Absprachen und gemeinsame Anleitung",
      "availability": "Werktags ab 16 Uhr und am Wochenende"
    },
    {
      "alias": "company",
      "name": "Alex Muster",
      "age": 32,
      "account_type": "job_provider",
      "provider_kind": "company",
      "company_name": "Nachbarschaftswerk Musterstadt",
      "street": "Beispielplatz",
      "house_number": "3",
      "bio": "Wir organisieren kleine Aktionen für ein lebendiges Viertel. Diese Organisation und alle ihre Angebote sind erfunden.",
      "interests": "Gemeinschaft, Veranstaltungen und Umweltschutz",
      "skills": "Organisation und Betreuung kleiner Projekte",
      "availability": "Dienstags und donnerstags am Nachmittag"
    },
    {
      "alias": "guardian",
      "name": "Sam Beispiel",
      "age": 44,
      "account_type": "job_provider",
      "provider_kind": "private",
      "street": "Beispielweg",
      "house_number": "4",
      "bio": "Fiktive sorgeberechtigte Person für die geschützte Plattform-Demo.",
      "interests": "Familie, Lesen und Nachbarschaft",
      "skills": "Begleitung und klare Absprachen",
      "availability": "Nach Vereinbarung"
    },
    {
      "alias": "peer-seeker",
      "name": "Noah Muster",
      "age": 18,
      "account_type": "job_seeker",
      "provider_kind": null,
      "street": "Beispielgasse",
      "house_number": "7",
      "bio": "Ich helfe gern bei praktischen Aufgaben und lerne Neues dazu. Fiktives Beispielprofil.",
      "interests": "Sport, Garten und Bücher",
      "skills": "Teamarbeit und sorgfältiges Arbeiten",
      "availability": "Am Wochenende und in den Ferien"
    }
  ],
  "jobs": [
    {
      "key": "garden-open",
      "owner": "private-provider",
      "title": "Den Garten gemeinsam fit machen",
      "category": "garden",
      "wage": 15,
      "description": "Wir sammeln Laub, jäten ein kleines Beet und gießen die Pflanzen. Handschuhe und Werkzeug liegen bereit. Wir erklären alle Aufgaben in Ruhe.",
      "status": "open",
      "market": "local",
      "district": "Nordviertel",
      "payment_type": "hourly",
      "job_kind": "recurring",
      "recurrence_rule": "weekly",
      "continuity_preferred": true,
      "filled_by": null
    },
    {
      "key": "pets-open",
      "owner": "private-provider",
      "title": "Eine entspannte Runde mit unserem Hund",
      "category": "pets",
      "wage": 12,
      "description": "Unser ruhiger Hund freut sich über einen Spaziergang durch das Viertel. Beim ersten Treffen gehen wir gemeinsam, damit ihr euch kennenlernen könnt.",
      "status": "open",
      "market": "local",
      "district": "Parkviertel",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": null
    },
    {
      "key": "phone-open",
      "owner": "guardian",
      "title": "Das neue Smartphone gemeinsam einrichten",
      "category": "it_help",
      "wage": 18,
      "description": "Kontakte übertragen, die Kamera ausprobieren und wichtige Einstellungen erklären: Wir suchen geduldige Unterstützung für etwa eine Stunde.",
      "status": "open",
      "market": "local",
      "district": "Zentrum",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": null
    },
    {
      "key": "community-open",
      "owner": "company",
      "title": "Den Nachbarschaftstag vorbereiten",
      "category": "other",
      "wage": 16,
      "description": "Für unseren kleinen Nachbarschaftstag sortieren wir Material und stellen leichte Schilder auf. Eine betreuende Person ist durchgehend dabei.",
      "status": "open",
      "market": "local",
      "district": "Zentrum",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": null
    },
    {
      "key": "books-open",
      "owner": "company",
      "title": "Bücher für die Tauschbox sortieren",
      "category": "household",
      "wage": 15,
      "description": "Wir ordnen gut erhaltene Bücher nach Themen und beschriften kleine Regalfächer. Die Aufgabe dauert ungefähr zwei Stunden.",
      "status": "open",
      "market": "local",
      "district": "Zentrum",
      "payment_type": "fixed",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": null
    },
    {
      "key": "private-conversation",
      "owner": "private-provider",
      "title": "Pflanzen während der Ferien versorgen",
      "category": "garden",
      "wage": 14,
      "description": "Einmal täglich die Balkonpflanzen gießen und kurz nach dem Rechten sehen. Die Wassermenge besprechen wir vorher gemeinsam.",
      "status": "reserved",
      "market": "local",
      "district": "Nordviertel",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": null
    },
    {
      "key": "private-scheduled",
      "owner": "private-provider",
      "title": "Unterstützung beim Wocheneinkauf",
      "category": "shopping",
      "wage": 14,
      "description": "Einen überschaubaren Einkauf im Viertel erledigen und leichte Taschen bis zur Haustür bringen. Einkaufsliste und Budget stehen vorher fest.",
      "status": "filled",
      "market": "local",
      "district": "Nordviertel",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": "seeker"
    },
    {
      "key": "private-completed",
      "owner": "private-provider",
      "title": "Fotos für das Familienalbum sortieren",
      "category": "it_help",
      "wage": 16,
      "description": "Digitale Bilder gemeinsam nach Jahren ordnen und doppelte Aufnahmen aussortieren. Persönliche Fotos werden in dieser Demo nicht verwendet.",
      "status": "closed",
      "market": "local",
      "district": "Nordviertel",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": "seeker"
    },
    {
      "key": "private-draft",
      "owner": "private-provider",
      "title": "Beim Umtopfen der Zimmerpflanzen helfen",
      "category": "garden",
      "wage": 15,
      "description": "Ein paar Zimmerpflanzen brauchen größere Töpfe. Wir bereiten Erde und Töpfe vor und arbeiten gemeinsam am Tisch.",
      "status": "draft",
      "market": "local",
      "district": "Nordviertel",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": null
    },
    {
      "key": "company-conversation",
      "owner": "company",
      "title": "Material für die Mitmachwerkstatt ordnen",
      "category": "other",
      "wage": 16,
      "description": "Für unsere betreute Mitmachwerkstatt sortieren wir Bastelmaterial, zählen Stifte und stellen kleine Materialkisten zusammen.",
      "status": "reserved",
      "market": "local",
      "district": "Zentrum",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": null
    },
    {
      "key": "company-scheduled",
      "owner": "company",
      "title": "Beete im Gemeinschaftsgarten pflegen",
      "category": "garden",
      "wage": 15,
      "description": "Gemeinsam leichte Gartenarbeiten übernehmen: gießen, Laub sammeln und Beete beschriften. Eine Ansprechperson begleitet die Arbeit.",
      "status": "filled",
      "market": "local",
      "district": "Parkviertel",
      "payment_type": "hourly",
      "job_kind": "recurring",
      "recurrence_rule": "weekly",
      "continuity_preferred": true,
      "filled_by": "seeker"
    },
    {
      "key": "company-draft",
      "owner": "company",
      "title": "Infomaterial für den Aktionstag vorbereiten",
      "category": "other",
      "wage": 14,
      "description": "Flyer sortieren, kleine Materialpakete zusammenstellen und leichte Beschilderung vorbereiten. Schwere Lasten gehören nicht zur Aufgabe.",
      "status": "draft",
      "market": "local",
      "district": "Zentrum",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": null
    },
    {
      "key": "company-completed",
      "owner": "company",
      "title": "Spiele für das Nachbarschaftsfest sortieren",
      "category": "household",
      "wage": 15,
      "description": "Brettspiele prüfen, Spielkarten zählen und die Kisten übersichtlich beschriften. Alle Materialien sind frei erfundene Beispieldaten.",
      "status": "closed",
      "market": "local",
      "district": "Zentrum",
      "payment_type": "hourly",
      "job_kind": "one_time",
      "recurrence_rule": null,
      "continuity_preferred": false,
      "filled_by": "peer-seeker"
    },
    {
      "key": "extended-tutoring",
      "owner": "guardian",
      "title": "Mathe verständlich erklären",
      "category": "tutoring",
      "wage": 18,
      "description": "Einmal pro Woche gemeinsam Grundlagen üben und Hausaufgaben besprechen. Geduld und klare Erklärungen sind wichtiger als Tempo.",
      "status": "open",
      "market": "extended",
      "district": "Mitte",
      "payment_type": "hourly",
      "job_kind": "recurring",
      "recurrence_rule": "weekly",
      "continuity_preferred": false,
      "filled_by": null
    }
  ],
  "applications": [
    {
      "key": "private-chat-seeker",
      "job": "private-conversation",
      "applicant": "seeker",
      "status": "negotiating",
      "queue_position": 1,
      "is_primary": true,
      "created_days_ago": 2,
      "message": "Hallo Robin, ich kümmere mich gern um Pflanzen und hätte in den Ferien nachmittags Zeit. Können wir die Aufgabe vorher gemeinsam anschauen?",
      "provider_reply": "Danke für deine Nachricht! Lass uns die Einzelheiten hier gemeinsam besprechen.",
      "seeker_reply": "Sehr gern. Die Beschreibung passt gut und ich freue mich auf die gemeinsame Aufgabe."
    },
    {
      "key": "private-wait-peer",
      "job": "private-conversation",
      "applicant": "peer-seeker",
      "status": "waitlisted",
      "queue_position": 2,
      "is_primary": false,
      "created_days_ago": 2,
      "message": "Hallo Robin, ich könnte ebenfalls beim Gießen helfen und würde gern auf der Warteliste bleiben.",
      "provider_reply": null,
      "seeker_reply": null
    },
    {
      "key": "private-booked-seeker",
      "job": "private-scheduled",
      "applicant": "seeker",
      "status": "accepted",
      "queue_position": 1,
      "is_primary": true,
      "created_days_ago": 4,
      "message": "Hallo Robin, ich unterstütze dich gern beim Einkauf. Am vereinbarten Nachmittag habe ich Zeit.",
      "provider_reply": "Vielen Dank, Mila. Wir treffen uns am vereinbarten Termin; die Einkaufsliste liegt dann bereit.",
      "seeker_reply": "Alles klar, ich bin pünktlich da und wir gehen die Liste gemeinsam durch."
    },
    {
      "key": "private-done-seeker",
      "job": "private-completed",
      "applicant": "seeker",
      "status": "completed",
      "queue_position": 1,
      "is_primary": false,
      "created_days_ago": 8,
      "message": "Hallo Robin, beim Sortieren am Computer helfe ich dir gern.",
      "provider_reply": "Danke für die sorgfältige Hilfe. Jetzt ist alles wieder übersichtlich.",
      "seeker_reply": "Gern geschehen! Schön, dass wir so viel geschafft haben."
    },
    {
      "key": "company-chat-peer",
      "job": "company-conversation",
      "applicant": "peer-seeker",
      "status": "negotiating",
      "queue_position": 1,
      "is_primary": true,
      "created_days_ago": 2,
      "message": "Hallo Alex, ich sortiere gern und hätte am Donnerstag Zeit, bei der Vorbereitung mitzuhelfen.",
      "provider_reply": "Hallo Noah, das passt gut. Wir zeigen dir zu Beginn die Materialkisten.",
      "seeker_reply": "Prima, dann stimmen wir hier noch die genaue Uhrzeit ab."
    },
    {
      "key": "company-wait-seeker",
      "job": "company-conversation",
      "applicant": "seeker",
      "status": "waitlisted",
      "queue_position": 2,
      "is_primary": false,
      "created_days_ago": 2,
      "message": "Hallo Alex, ich würde bei der Werkstattvorbereitung gern einspringen, falls noch Hilfe benötigt wird.",
      "provider_reply": null,
      "seeker_reply": null
    },
    {
      "key": "company-booked-seeker",
      "job": "company-scheduled",
      "applicant": "seeker",
      "status": "accepted",
      "queue_position": 1,
      "is_primary": true,
      "created_days_ago": 5,
      "message": "Hallo Alex, ich arbeite gern im Garten und könnte regelmäßig am Nachmittag helfen.",
      "provider_reply": "Willkommen, Mila. Die ersten beiden Termine sind eingetragen; Werkzeug stellen wir bereit.",
      "seeker_reply": "Vielen Dank, ich freue mich auf den Gemeinschaftsgarten."
    },
    {
      "key": "company-done-peer",
      "job": "company-completed",
      "applicant": "peer-seeker",
      "status": "completed",
      "queue_position": 1,
      "is_primary": false,
      "created_days_ago": 9,
      "message": "Hallo Alex, ich helfe gern beim Sortieren der Spiele.",
      "provider_reply": "Danke, Noah. Die Spiele sind jetzt vollständig und gut beschriftet.",
      "seeker_reply": "Hat Spaß gemacht. Viel Freude beim Nachbarschaftsfest!"
    }
  ],
  "engagements": [
    {
      "application": "private-booked-seeker",
      "status": "active",
      "appointment_days": [
        2
      ]
    },
    {
      "application": "private-done-seeker",
      "status": "completed",
      "appointment_days": [
        -4
      ]
    },
    {
      "application": "company-booked-seeker",
      "status": "active",
      "appointment_days": [
        3,
        10
      ]
    },
    {
      "application": "company-done-peer",
      "status": "completed",
      "appointment_days": [
        -5
      ]
    }
  ],
  "namespace_uuid": "68713d56-32a9-502d-8ec0-180d7a3112b8",
  "markets": {
    "local": {
      "id": "47eb50eb-9048-5819-b6f7-e45a1db169a4",
      "city": "Musterstadt",
      "postal_code": "00000"
    },
    "extended": {
      "id": "31ad691e-33f8-5114-a8a4-7543f2c90298",
      "city": "Beispielort",
      "postal_code": "00001"
    }
  }
}$template$::jsonb;
  v_visit demo_private.visits%ROWTYPE;
  v_item jsonb;
  v_job jsonb;
  v_app jsonb;
  v_engagement jsonb;
  v_id uuid;
  v_job_id uuid;
  v_application_id uuid;
  v_provider_id uuid;
  v_seeker_id uuid;
  v_guardian_id uuid;
  v_engagement_id uuid;
  v_agreement_id uuid;
  v_appointment_id uuid;
  v_local_market uuid;
  v_extended_market uuid;
  v_role text;
  v_day integer;
  v_index integer;
  v_created_at timestamptz;
  v_reply_at timestamptz;
  v_starts_at timestamptz;
  v_is_completed boolean;
  v_manifest jsonb;
  v_job_ids jsonb := '{}'::jsonb;
  v_application_ids jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Demo seed requires the server service role.' USING ERRCODE = '42501';
  END IF;
  IF p_session_id IS NULL OR p_seed_at IS NULL THEN
    RAISE EXCEPTION 'Demo seed requires a session and reference time.' USING ERRCODE = '22023';
  END IF;

  -- This binding function must raise on invalid aliases, duplicate/cross-visit IDs,
  -- missing confirmation or an email other than demo+<session>.<alias>@example.test.
  PERFORM public.demo_bind_identities(p_session_id, p_identities);
  SELECT * INTO v_visit FROM demo_private.visits
  WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_visit.expires_at <= now() THEN
    RAISE EXCEPTION 'Demo session is missing or expired.' USING ERRCODE = '42501';
  END IF;
  IF v_visit.seeded_at IS NOT NULL THEN
    IF v_visit.seed_result IS NULL THEN
      RAISE EXCEPTION 'Demo seed receipt is incomplete.' USING ERRCODE = '55000';
    END IF;
    -- Retrying never resets jobs, conversations, preferences or other visitor edits.
    RETURN v_visit.seed_result;
  END IF;
  IF p_seed_at < now() - interval '1 day' OR p_seed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Demo seed reference time is outside the provisioning window.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_system_roles WHERE user_id IN (
    SELECT value::uuid FROM jsonb_each_text(p_identities)
  )) THEN
    RAISE EXCEPTION 'Demo identities must not hold staff or system roles.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('demo.seed_visit_id', p_session_id::text, true);

  v_guardian_id := (p_identities->>'guardian')::uuid;
  v_local_market := (v_template->'markets'->'local'->>'id')::uuid;
  v_extended_market := (v_template->'markets'->'extended'->>'id')::uuid;

  INSERT INTO public.regions_live
    (id, city, postal_code, federal_state, country, is_live, brand_prefix, display_name)
  VALUES
    (v_local_market, 'Musterstadt', '00000', 'Beispielland', 'DE', true, 'Workfare', 'Musterstadt'),
    (v_extended_market, 'Beispielort', '00001', 'Beispielland', 'DE', true, 'Workfare', 'Beispielort')
  ON CONFLICT (id) DO NOTHING;
  IF (SELECT count(*) FROM public.regions_live
      WHERE id IN (v_local_market, v_extended_market) AND country = 'DE' AND is_live AND brand_prefix = 'Workfare') <> 2 THEN
    RAISE EXCEPTION 'Shared demo market catalog is inconsistent.' USING ERRCODE = '55000';
  END IF;

  -- Auth may already have created empty profile stubs. Complete them first;
  -- apply provider verification separately after address fields, because the
  -- real address-change trigger invalidates an old verified state.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_template->'profiles') LOOP
    v_role := v_item->>'alias';
    v_id := (p_identities->>v_role)::uuid;
    INSERT INTO public.profiles (
      id, full_name, birthdate, city, country, user_type, account_type, provider_kind,
      email, email_verified_at, market_id, theme_preference, mobile_nav_preference,
      company_name, company_contact_email, company_message,
      bio, interests, skills, availability_note, street, house_number, zip,
      avatar_url, lat, lng, created_at, updated_at
    ) VALUES (
      v_id, v_item->>'name',
      ((p_seed_at AT TIME ZONE 'Europe/Berlin')::date - make_interval(years => (v_item->>'age')::int, months => 3))::date,
      'Musterstadt', 'DE',
      CASE WHEN v_item->>'account_type' = 'job_seeker' THEN 'youth' ELSE 'adult' END,
      (v_item->>'account_type')::public.account_type,
      (v_item->>'provider_kind')::public.provider_kind,
      'demo+' || p_session_id::text || '.' || v_role || '@example.test', p_seed_at,
      v_local_market, 'system', 'top', v_item->>'company_name',
      CASE WHEN v_role = 'company' THEN 'demo+' || p_session_id::text || '.company@example.test' END,
      CASE WHEN v_role = 'company' THEN 'Vollständig erfundene Organisation für die Workfare-Demo.' END,
      v_item->>'bio', v_item->>'interests', v_item->>'skills', v_item->>'availability',
      v_item->>'street', v_item->>'house_number', '00000', NULL, NULL, NULL,
      p_seed_at - interval '30 days', p_seed_at
    ) ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name, birthdate = EXCLUDED.birthdate,
      city = EXCLUDED.city, country = EXCLUDED.country, user_type = EXCLUDED.user_type,
      account_type = EXCLUDED.account_type, provider_kind = EXCLUDED.provider_kind,
      email = EXCLUDED.email, email_verified_at = EXCLUDED.email_verified_at,
      market_id = EXCLUDED.market_id, theme_preference = EXCLUDED.theme_preference,
      mobile_nav_preference = EXCLUDED.mobile_nav_preference,
      company_name = EXCLUDED.company_name, company_contact_email = EXCLUDED.company_contact_email,
      company_message = EXCLUDED.company_message, bio = EXCLUDED.bio, interests = EXCLUDED.interests,
      skills = EXCLUDED.skills, availability_note = EXCLUDED.availability_note,
      street = EXCLUDED.street, house_number = EXCLUDED.house_number, zip = EXCLUDED.zip,
      avatar_url = NULL, lat = NULL, lng = NULL;

    UPDATE public.profiles SET
      provider_verification_status = CASE WHEN v_item->>'account_type' = 'job_provider'
        THEN 'verified'::public.provider_verification_status ELSE 'none'::public.provider_verification_status END,
      provider_verified_at = CASE WHEN v_item->>'account_type' = 'job_provider' THEN p_seed_at END,
      guardian_status = CASE WHEN v_item->>'account_type' = 'job_seeker'
        THEN 'linked'::public.guardian_status ELSE 'none'::public.guardian_status END,
      guardian_id = NULL,
      guardian_verified_at = CASE WHEN v_item->>'account_type' = 'job_seeker' THEN p_seed_at END
    WHERE id = v_id;

    INSERT INTO public.notification_preferences (
      user_id, email_enabled, email_application_updates, email_messages, email_job_updates,
      email_waitlist_updates, email_appointments, in_app_enabled, in_app_application_updates,
      in_app_messages, in_app_waitlist_updates, in_app_appointments, timezone
    ) VALUES (v_id, false, false, false, false, false, false, true, true, true, true, true, 'Europe/Berlin')
    ON CONFLICT (user_id) DO UPDATE SET
      email_enabled = false, email_application_updates = false, email_messages = false,
      email_job_updates = false, email_waitlist_updates = false, email_appointments = false,
      in_app_enabled = true, in_app_application_updates = true, in_app_messages = true,
      in_app_waitlist_updates = true, in_app_appointments = true;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['seeker', 'peer-seeker'] LOOP
    v_id := (p_identities->>v_role)::uuid;
    INSERT INTO public.guardian_relationships (id, child_id, guardian_id, status, created_at)
    VALUES (demo_private.seed_entity_id(p_session_id, 'guardian:' || v_role), v_id, v_guardian_id, 'active', p_seed_at - interval '20 days');
    UPDATE public.profiles SET guardian_id = v_guardian_id WHERE id = v_id;
    INSERT INTO public.guardian_consents (
      id, child_id, parent_name, parent_email, relationship_type, signature_name,
      declaration_version, declaration_text, consent_scope, status, approved_at,
      email_verified_at, linked_guardian_id, affirmations, signature_method
    ) VALUES (
      demo_private.seed_entity_id(p_session_id, 'consent:' || v_role), v_id,
      'Sam Beispiel', 'demo+' || p_session_id::text || '.guardian@example.test', 'legal_guardian', 'Sam Beispiel',
      'workfare-demo-v1', 'Synthetischer Beispielnachweis. Es wurde keine echte Einwilligung einer Person abgegeben.',
      'jobbridge_basis_verification', 'approved', p_seed_at - interval '20 days',
      p_seed_at - interval '20 days', v_guardian_id, '{"synthetic_demo":true}'::jsonb, 'demo_seed'
    );
  END LOOP;

  FOR v_job IN SELECT value FROM jsonb_array_elements(v_template->'jobs') LOOP
    v_job_id := demo_private.seed_entity_id(p_session_id, 'job:' || (v_job->>'key'));
    v_provider_id := (p_identities->>(v_job->>'owner'))::uuid;
    v_job_ids := v_job_ids || jsonb_build_object(v_job->>'key', v_job_id);
    INSERT INTO public.jobs (
      id, title, description, posted_by, status, created_at, updated_at, market_id,
      public_location_label, wage_hourly, category, hiring_mode, payment_type,
      job_kind, recurrence_rule, continuity_preferred, reach, address_reveal_policy,
      filled_by, filled_at, completed_at, expires_at
    ) VALUES (
      v_job_id, v_job->>'title', v_job->>'description', v_provider_id,
      (v_job->>'status')::public.job_status, p_seed_at - interval '10 days', p_seed_at,
      CASE WHEN v_job->>'market' = 'local' THEN v_local_market ELSE v_extended_market END,
      CASE WHEN v_job->>'market' = 'local' THEN 'Musterstadt' ELSE 'Beispielort' END || ' · ' || (v_job->>'district'),
      (v_job->>'wage')::numeric, v_job->>'category', 'first_come', v_job->>'payment_type',
      v_job->>'job_kind', v_job->>'recurrence_rule', (v_job->>'continuity_preferred')::boolean,
      CASE WHEN v_job->>'market' = 'local' THEN 'internal_rheinbach' ELSE 'extended' END, 'after_accept',
      (p_identities->>(v_job->>'filled_by'))::uuid,
      CASE WHEN v_job->>'filled_by' IS NOT NULL THEN p_seed_at - interval '6 days' END,
      CASE WHEN v_job->>'status' = 'closed' THEN p_seed_at - interval '3 days' END,
      p_seed_at + interval '30 days'
    );
    INSERT INTO public.job_private_details (job_id, address_full, notes)
    SELECT v_job_id, street || ' ' || house_number || ', 00000 Musterstadt (fiktiv)',
      'Erfundener Treffpunkt. Es gibt keine reale Adresse und keine gespeicherten Kartenkoordinaten.'
    FROM public.profiles WHERE id = v_provider_id;
  END LOOP;

  FOR v_app IN SELECT value FROM jsonb_array_elements(v_template->'applications') LOOP
    v_application_id := demo_private.seed_entity_id(p_session_id, 'application:' || (v_app->>'key'));
    v_job_id := (v_job_ids->>(v_app->>'job'))::uuid;
    SELECT value INTO v_job FROM jsonb_array_elements(v_template->'jobs') WHERE value->>'key' = v_app->>'job';
    v_provider_id := (p_identities->>(v_job->>'owner'))::uuid;
    v_seeker_id := (p_identities->>(v_app->>'applicant'))::uuid;
    v_created_at := p_seed_at - make_interval(days => (v_app->>'created_days_ago')::int);
    v_is_completed := v_app->>'status' = 'completed';
    v_reply_at := CASE WHEN v_is_completed THEN p_seed_at - interval '3 days 30 minutes' ELSE p_seed_at - interval '70 minutes' END;
    v_application_ids := v_application_ids || jsonb_build_object(v_app->>'key', v_application_id);
    INSERT INTO public.applications (
      id, job_id, user_id, message, status, queue_position, is_primary, conversation_state,
      created_at, updated_at, last_activity_at, closed_by, closed_at, closed_reason,
      close_action, closed_from_status, was_primary_before_close, closure_version
    ) VALUES (
      v_application_id, v_job_id, v_seeker_id, v_app->>'message', (v_app->>'status')::public.application_status,
      (v_app->>'queue_position')::int, (v_app->>'is_primary')::boolean,
      CASE WHEN v_is_completed THEN 'closed' ELSE 'open' END,
      v_created_at, v_created_at, CASE WHEN v_is_completed THEN p_seed_at - interval '3 days' ELSE v_created_at END,
      CASE WHEN v_is_completed THEN v_provider_id END, CASE WHEN v_is_completed THEN p_seed_at - interval '3 days' END,
      CASE WHEN v_is_completed THEN 'Die gemeinsame Aufgabe wurde erfolgreich abgeschlossen.' END,
      CASE WHEN v_is_completed THEN 'engagement_completed' END,
      CASE WHEN v_is_completed THEN 'accepted'::public.application_status END,
      v_is_completed, CASE WHEN v_is_completed THEN 1 ELSE 0 END
    );
    INSERT INTO public.messages (id, application_id, sender_id, content, kind, created_at, read_at)
    VALUES (demo_private.seed_entity_id(p_session_id, 'message:application:' || (v_app->>'key')),
      v_application_id, v_seeker_id, v_app->>'message', 'application', v_created_at,
      CASE WHEN v_app->>'status' <> 'negotiating' THEN v_created_at + interval '1 hour' END);
    INSERT INTO public.application_events (id, application_id, actor_id, event_type, metadata, created_at)
    VALUES (demo_private.seed_entity_id(p_session_id, 'event:submitted:' || (v_app->>'key')),
      v_application_id, v_seeker_id, 'application_submitted',
      jsonb_build_object('job_id', v_job_id, 'queue_position', (v_app->>'queue_position')::int,
        'is_primary', (v_app->>'queue_position')::int = 1, 'demo_template', v_template->>'version'), v_created_at);

    IF v_app->>'provider_reply' IS NOT NULL THEN
      INSERT INTO public.messages (id, application_id, sender_id, content, kind, created_at, read_at) VALUES
        (demo_private.seed_entity_id(p_session_id, 'message:provider:' || (v_app->>'key')),
          v_application_id, v_provider_id, v_app->>'provider_reply', 'chat', v_reply_at,
          CASE WHEN v_is_completed THEN v_reply_at + interval '1 minute' END),
        (demo_private.seed_entity_id(p_session_id, 'message:seeker:' || (v_app->>'key')),
          v_application_id, v_seeker_id, v_app->>'seeker_reply', 'chat', v_reply_at + interval '2 minutes',
          CASE WHEN v_is_completed THEN v_reply_at + interval '3 minutes' END);
    END IF;
    IF v_app->>'status' IN ('negotiating', 'waitlisted') THEN
      INSERT INTO public.notifications (id, user_id, type, title, body, data, category, dedupe_key, created_at)
      VALUES (demo_private.seed_entity_id(p_session_id, 'notification:new:' || (v_app->>'key')),
        v_provider_id, 'application_new', 'Neue Bewerbung', 'Es gibt eine neue Rückmeldung zu deinem Angebot.',
        jsonb_build_object('route', '/app-home/activities?conversation=' || v_application_id::text,
          'application_id', v_application_id, 'job_id', v_job_id,
          'queue_position', (v_app->>'queue_position')::int, 'is_primary', (v_app->>'is_primary')::boolean),
        CASE WHEN v_app->>'status' = 'waitlisted' THEN 'waitlist' ELSE 'applications' END,
        'demo:new:' || v_application_id::text, v_created_at);
    END IF;
    IF v_app->>'status' = 'negotiating' THEN
      INSERT INTO public.notifications (id, user_id, type, title, body, data, category, dedupe_key, created_at)
      VALUES (demo_private.seed_entity_id(p_session_id, 'notification:message:' || (v_app->>'key')),
        v_seeker_id, 'message', 'Neue Nachricht', v_app->>'provider_reply',
        jsonb_build_object('route', '/app-home/activities?conversation=' || v_application_id::text,
          'application_id', v_application_id, 'job_id', v_job_id),
        'messages', 'demo:message:' || v_application_id::text, v_reply_at);
    END IF;
  END LOOP;

  FOR v_engagement IN SELECT value FROM jsonb_array_elements(v_template->'engagements') LOOP
    SELECT value INTO v_app FROM jsonb_array_elements(v_template->'applications') WHERE value->>'key' = v_engagement->>'application';
    SELECT value INTO v_job FROM jsonb_array_elements(v_template->'jobs') WHERE value->>'key' = v_app->>'job';
    v_application_id := (v_application_ids->>(v_app->>'key'))::uuid;
    v_job_id := (v_job_ids->>(v_app->>'job'))::uuid;
    v_provider_id := (p_identities->>(v_job->>'owner'))::uuid;
    v_seeker_id := (p_identities->>(v_app->>'applicant'))::uuid;
    v_engagement_id := demo_private.seed_entity_id(p_session_id, 'engagement:' || (v_app->>'key'));
    v_agreement_id := demo_private.seed_entity_id(p_session_id, 'agreement:' || (v_app->>'key'));
    v_is_completed := v_engagement->>'status' = 'completed';
    v_created_at := p_seed_at - make_interval(days => (v_app->>'created_days_ago')::int) + interval '6 hours';
    UPDATE public.jobs SET filled_at = v_created_at WHERE id = v_job_id;
    INSERT INTO public.job_engagements (
      id, application_id, job_id, provider_id, seeker_id, engagement_type, status,
      started_at, completed_at, closed_by, close_reason, created_at, updated_at
    ) VALUES (
      v_engagement_id, v_application_id, v_job_id, v_provider_id, v_seeker_id,
      v_job->>'job_kind', v_engagement->>'status', v_created_at,
      CASE WHEN v_is_completed THEN p_seed_at - interval '3 days' END,
      CASE WHEN v_is_completed THEN v_provider_id END,
      CASE WHEN v_is_completed THEN 'Die gemeinsame Aufgabe wurde erfolgreich abgeschlossen.' END,
      v_created_at, CASE WHEN v_is_completed THEN p_seed_at - interval '3 days' ELSE v_created_at END
    );
    v_index := 0;
    FOR v_day IN SELECT value::int FROM jsonb_array_elements_text(v_engagement->'appointment_days') LOOP
      v_index := v_index + 1;
      v_starts_at := (((p_seed_at AT TIME ZONE 'Europe/Berlin')::date + v_day) + time '16:00') AT TIME ZONE 'Europe/Berlin';
      v_appointment_id := demo_private.seed_entity_id(p_session_id, 'appointment:' || (v_app->>'key') || ':' || v_index::text);
      IF v_index = 1 THEN
        INSERT INTO public.job_agreements (
          id, application_id, job_id, provider_id, seeker_id, starts_at, ends_at,
          timezone, note, status, created_at, updated_at
        ) VALUES (
          v_agreement_id, v_application_id, v_job_id, v_provider_id, v_seeker_id,
          v_starts_at, v_starts_at + interval '1 hour', 'Europe/Berlin',
          'Wir besprechen die Aufgabe vor Ort gemeinsam. Dieser Termin ist erfunden.',
          CASE WHEN v_is_completed THEN 'completed' ELSE 'confirmed' END,
          v_created_at, CASE WHEN v_is_completed THEN p_seed_at - interval '3 days' ELSE v_created_at END
        );
      END IF;
      INSERT INTO public.job_appointments (
        id, engagement_id, starts_at, ends_at, timezone, note, status,
        created_by, legacy_agreement_id, created_at, updated_at
      ) VALUES (
        v_appointment_id, v_engagement_id, v_starts_at, v_starts_at + interval '1 hour', 'Europe/Berlin',
        'Beispieltermin: Einführung und gemeinsame Aufgabe.',
        CASE WHEN v_is_completed THEN 'completed' ELSE 'scheduled' END,
        v_provider_id, CASE WHEN v_index = 1 THEN v_agreement_id END,
        v_created_at, CASE WHEN v_is_completed THEN p_seed_at - interval '3 days' ELSE v_created_at END
      );
      INSERT INTO public.application_events (id, application_id, actor_id, event_type, metadata, created_at)
      VALUES (demo_private.seed_entity_id(p_session_id, 'event:appointment:' || (v_app->>'key') || ':' || v_index::text),
        v_application_id, v_provider_id, 'appointment_scheduled',
        jsonb_build_object('engagement_id', v_engagement_id, 'appointment_id', v_appointment_id,
          'starts_at', v_starts_at, 'job_kind', v_job->>'job_kind'), v_created_at);
      IF NOT v_is_completed THEN
        INSERT INTO public.notifications (id, user_id, type, title, body, data, category, dedupe_key, created_at)
        VALUES (demo_private.seed_entity_id(p_session_id, 'notification:appointment:' || (v_app->>'key') || ':' || v_index::text),
          v_seeker_id, 'success', 'Termin vereinbart', 'Der nächste Termin ist in deinen Aktivitäten gespeichert.',
          jsonb_build_object('route', '/app-home/activities?conversation=' || v_application_id::text,
            'application_id', v_application_id, 'job_id', v_job_id,
            'engagement_id', v_engagement_id, 'appointment_id', v_appointment_id),
          'appointments', 'demo:appointment:' || v_appointment_id::text, p_seed_at - interval '1 day');
      END IF;
    END LOOP;
    INSERT INTO public.messages (id, application_id, sender_id, content, kind, created_at, read_at)
    VALUES (demo_private.seed_entity_id(p_session_id, 'message:agreement:' || (v_app->>'key')),
      v_application_id, v_provider_id, 'Der Termin wurde verbindlich vereinbart.', 'system',
      v_created_at, v_created_at + interval '1 minute');
    IF v_is_completed THEN
      INSERT INTO public.application_events (id, application_id, actor_id, event_type, reason, metadata, created_at)
      VALUES (demo_private.seed_entity_id(p_session_id, 'event:completed:' || (v_app->>'key')),
        v_application_id, v_provider_id, 'engagement_completed', 'Die gemeinsame Aufgabe wurde erfolgreich abgeschlossen.',
        jsonb_build_object('engagement_id', v_engagement_id, 'job_kind', v_job->>'job_kind'), p_seed_at - interval '3 days');
      INSERT INTO public.notifications (id, user_id, type, title, body, data, category, dedupe_key, created_at, read_at)
      VALUES (demo_private.seed_entity_id(p_session_id, 'notification:completed:' || (v_app->>'key')),
        v_seeker_id, 'application_status', 'Zusammenarbeit abgeschlossen', 'Danke für die gemeinsame Unterstützung.',
        jsonb_build_object('route', '/app-home/activities?conversation=' || v_application_id::text,
          'application_id', v_application_id, 'job_id', v_job_id, 'engagement_id', v_engagement_id),
        'applications', 'demo:completed:' || v_application_id::text,
        p_seed_at - interval '3 days', p_seed_at - interval '2 days');
    END IF;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['seeker', 'private-provider', 'company'] LOOP
    INSERT INTO public.notifications (id, user_id, type, title, body, data, category, dedupe_key, created_at)
    VALUES (demo_private.seed_entity_id(p_session_id, 'notification:welcome:' || v_role),
      (p_identities->>v_role)::uuid, 'info', 'Willkommen in deiner Workfare-Demo',
      'Du kannst die Plattform mit diesen erfundenen Beispieldaten ausprobieren. Deine Änderungen gehören nur zu dieser Sitzung.',
      '{"route":"/app-home/settings"}'::jsonb, 'system', 'demo:welcome', p_seed_at - interval '5 minutes');
  END LOOP;

  v_manifest := jsonb_build_object(
    'template_version', v_template->>'version', 'session_id', p_session_id,
    'profile_ids', p_identities, 'market_id', v_local_market, 'extended_market_id', v_extended_market,
    'job_ids', v_job_ids, 'application_ids', v_application_ids,
    'seeded_at', p_seed_at,
    'counts', jsonb_build_object('profiles', 5, 'shared_regions', 2, 'guardian_relationships', 2,
      'guardian_consents', 2, 'jobs', 14, 'applications', 8, 'messages', 24,
      'engagements', 4, 'agreements', 4, 'appointments', 5, 'application_events', 15, 'notifications', 14)
  );
  UPDATE demo_private.visits SET seeded_at = p_seed_at, seed_result = v_manifest WHERE id = p_session_id;
  RETURN v_manifest;
END;
$function$;
REVOKE ALL ON FUNCTION demo_private.seed_demo_session(uuid, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION demo_private.seed_demo_session(uuid, jsonb, timestamptz) TO service_role;

-- Only a server with the isolated demo service credential may provision data.
CREATE OR REPLACE FUNCTION public.demo_seed_session(p_session_id uuid, p_identities jsonb)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT demo_private.seed_demo_session(p_session_id, p_identities, now());
$$;
REVOKE ALL ON FUNCTION public.demo_seed_session(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_seed_session(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
