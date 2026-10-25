BEGIN;

-- A narrow family read model. It never exposes messages, private addresses,
-- contact details, job descriptions, payment records or a chat deep link.
CREATE FUNCTION guardian_private.child_overview(p_child_id uuid,p_view text DEFAULT 'active',p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=guardian_private.verified_user(); child public.profiles%ROWTYPE;
 allowed boolean; totals jsonb; rows jsonb; more boolean;
BEGIN
 IF p_child_id IS NULL OR p_view NOT IN('active','completed') OR (p_before_at IS NULL)<>(p_before_id IS NULL)
   OR (p_before_at IS NOT NULL AND NOT isfinite(p_before_at)) THEN
   RAISE EXCEPTION 'GUARDIAN_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 IF actor=p_child_id OR NOT guardian_private.adult_eligible(actor) OR NOT guardian_private.in_scope(p_child_id)
   OR NOT EXISTS(SELECT FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL)
   OR NOT EXISTS(SELECT FROM auth.users u WHERE u.id=p_child_id AND u.deleted_at IS NULL)
   OR NOT EXISTS(SELECT FROM public.guardian_relationships r
      WHERE r.guardian_id=actor AND r.child_id=p_child_id AND r.status='active') THEN
   RAISE EXCEPTION 'GUARDIAN_CHILD_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO child FROM public.profiles WHERE id=p_child_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'GUARDIAN_CHILD_FORBIDDEN' USING ERRCODE='42501'; END IF;
 allowed:=child.account_type::text='job_seeker'
   AND child.birthdate<=(guardian_private.today()-interval '14 years')::date
   AND child.birthdate>(guardian_private.today()-interval '18 years')::date
   AND EXISTS(SELECT FROM public.guardian_consents consent
      WHERE consent.child_id=child.id AND consent.linked_guardian_id=actor
        AND consent.status='approved' AND consent.revoked_at IS NULL AND consent.email_verified_at IS NOT NULL
        AND consent.consent_scope='workfare_minor_jobs'
        AND consent.declaration_version='workfare-guardian-2026-10-24-v1'
        AND consent.signature_method='authenticated_email'
        AND consent.affirmations @> '{"accepted":true,"adult_confirmed":true,"legal_authority":true}'::jsonb);
 IF NOT COALESCE(allowed,false) THEN
   RETURN jsonb_build_object('ownerId',actor,'child',jsonb_build_object('id',child.id,'name',child.full_name,'avatarUrl',child.avatar_url),
     'access','profile_only','counts',NULL,'view',p_view,'jobs','[]'::jsonb,'hasMore',false);
 END IF;

 WITH work AS (
   SELECT a.id,j.title,j.posted_by,
     CASE WHEN e.status='completed' OR a.status::text='completed' THEN 'completed'
          WHEN e.status='cancelled' OR a.status::text IN('withdrawn','rejected','auto_rejected','cancelled') OR a.conversation_state='closed' THEN 'canceled'
          WHEN e.status='active' OR a.status::text='accepted' THEN 'agreed' WHEN a.status::text IN('submitted','negotiating') THEN 'reserved' ELSE 'canceled' END AS stage,
     COALESCE(e.completed_at,CASE WHEN a.status::text='completed' THEN COALESCE(a.closed_at,a.updated_at) END,e.started_at,a.created_at) AS sort_at
   FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
   LEFT JOIN public.job_engagements e ON e.application_id=a.id AND e.seeker_id=child.id AND e.provider_id=j.posted_by
   WHERE a.user_id=child.id AND guardian_private.in_scope(j.posted_by)
 ) SELECT jsonb_build_object('active',count(*) FILTER(WHERE stage IN('reserved','agreed')),
      'completed',count(*) FILTER(WHERE stage='completed'),
      'contacts',count(DISTINCT posted_by) FILTER(WHERE stage IN('reserved','agreed','completed')))
   INTO totals FROM work;

 WITH work AS (
   SELECT a.id,j.title,provider.full_name AS partner_name,provider.company_name AS company_name,provider.avatar_url AS partner_avatar,
     CASE WHEN e.status='completed' OR a.status::text='completed' THEN 'completed'
          WHEN e.status='cancelled' OR a.status::text IN('withdrawn','rejected','auto_rejected','cancelled') OR a.conversation_state='closed' THEN 'canceled'
          WHEN e.status='active' OR a.status::text='accepted' THEN 'agreed' WHEN a.status::text IN('submitted','negotiating') THEN 'reserved' ELSE 'canceled' END AS stage,
     COALESCE(e.completed_at,CASE WHEN a.status::text='completed' THEN COALESCE(a.closed_at,a.updated_at) END,e.started_at,a.created_at) AS sort_at,e.completed_at,
     (SELECT appointment.starts_at FROM public.job_appointments appointment
       WHERE appointment.engagement_id=e.id AND appointment.status=CASE WHEN e.status='completed' THEN 'completed' ELSE 'scheduled' END
       ORDER BY CASE WHEN e.status='completed' THEN -extract(epoch FROM appointment.starts_at) ELSE extract(epoch FROM appointment.starts_at) END,appointment.id LIMIT 1) AS starts_at
   FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
   LEFT JOIN public.profiles provider ON provider.id=j.posted_by
   LEFT JOIN public.job_engagements e ON e.application_id=a.id AND e.seeker_id=child.id AND e.provider_id=j.posted_by
   WHERE a.user_id=child.id AND guardian_private.in_scope(j.posted_by)
 ), page AS (
   SELECT * FROM work WHERE CASE WHEN p_view='completed' THEN stage='completed' ELSE stage IN('reserved','agreed') END
     AND (p_before_at IS NULL OR (sort_at,id)<(p_before_at,p_before_id))
   ORDER BY sort_at DESC,id DESC LIMIT 7
 ), visible AS (SELECT * FROM page ORDER BY sort_at DESC,id DESC LIMIT 6)
 SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'status',stage,
      'partner',jsonb_build_object('name',COALESCE(nullif(company_name,''),partner_name),'avatarUrl',partner_avatar),
      'startsAt',starts_at,'completedAt',CASE WHEN stage='completed' THEN COALESCE(completed_at,sort_at) ELSE NULL END,'sortAt',sort_at)
      ORDER BY sort_at DESC,id DESC) FROM visible),'[]'::jsonb), (SELECT count(*)>6 FROM page) INTO rows,more;
 RETURN jsonb_build_object('ownerId',actor,'child',jsonb_build_object('id',child.id,'name',child.full_name,'avatarUrl',child.avatar_url),
   'access','minor_jobs','counts',totals,'view',p_view,'jobs',rows,'hasMore',more);
END; $$;
CREATE FUNCTION public.get_guardian_child_overview(p_child_id uuid,p_view text DEFAULT 'active',p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT guardian_private.child_overview(p_child_id,p_view,p_before_at,p_before_id);
$$;
REVOKE ALL ON FUNCTION guardian_private.child_overview(uuid,text,timestamptz,uuid),public.get_guardian_child_overview(uuid,text,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION guardian_private.child_overview(uuid,text,timestamptz,uuid),public.get_guardian_child_overview(uuid,text,timestamptz,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
