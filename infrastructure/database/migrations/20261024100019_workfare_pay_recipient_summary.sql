BEGIN;

-- Read-only financial overview. It grants neither recipient eligibility nor
-- transfer/payout authority; an unresolved minor model remains unresolved.
CREATE FUNCTION payment_private.recipient_earnings_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); active_mode text; earnings jsonb; recent jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'RECIPIENT_AUTHENTICATION_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT mode INTO active_mode FROM payment_private.configuration;
  IF active_mode IS NULL OR active_mode NOT IN('local_simulation','sandbox') THEN
    RAISE EXCEPTION 'PAYMENTS_DISABLED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT FROM public.profiles WHERE id=actor AND account_type='job_seeker')
    OR NOT payment_private.recipient_synthetic(actor) THEN
    RAISE EXCEPTION 'RECIPIENT_SEEKER_REQUIRED' USING ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object('scope','confirmed_workfare_payments',
    'confirmedCents',COALESCE(sum(earnings_cents::bigint) FILTER(WHERE state='paid' AND refunded_cents=0),0),
    'refundedCents',COALESCE(sum(earnings_cents::bigint) FILTER(WHERE refunded_cents=total_cents),0),
    'underReviewCents',COALESCE(sum(earnings_cents::bigint) FILTER(WHERE state IN('review_required','refund_pending') AND refunded_cents=0),0),
    'underReviewCount',count(*) FILTER(WHERE state IN('review_required','refund_pending') AND refunded_cents=0),
    'paidJobs',count(DISTINCT appointment_id) FILTER(WHERE state='paid' AND refunded_cents=0)) INTO earnings
  FROM payment_private.orders WHERE recipient_id=actor AND mode=active_mode;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'applicationId',application_id,'title',title,
    'earningsCents',earnings_cents,'state',state,'startsAt',starts_at,'updatedAt',updated_at)
    ORDER BY updated_at DESC,id DESC),'[]'::jsonb) INTO recent
  FROM (SELECT id,application_id,title,earnings_cents,state,starts_at,updated_at FROM payment_private.orders
    WHERE recipient_id=actor AND mode=active_mode ORDER BY updated_at DESC,id DESC LIMIT 10) own_orders;
  RETURN jsonb_build_object('ownerId',actor,'kind',CASE active_mode WHEN 'sandbox' THEN 'sandbox' ELSE 'local' END,
    'currency','eur','checkedAt',statement_timestamp(),'earnings',earnings,'recentPayments',recent);
END; $$;

CREATE FUNCTION public.get_my_recipient_payment_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT payment_private.recipient_earnings_summary();
$$;
REVOKE ALL ON FUNCTION payment_private.recipient_earnings_summary(),public.get_my_recipient_payment_summary() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION payment_private.recipient_earnings_summary(),public.get_my_recipient_payment_summary() TO authenticated;
COMMENT ON FUNCTION public.get_my_recipient_payment_summary() IS 'Own Workfare payment statistics in the currently active isolated test mode, never a bank balance or payout authorization.';
COMMIT;
