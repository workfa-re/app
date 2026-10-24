BEGIN;

-- A child can have more than one actual guardian. Keep each guardian's evidence
-- independent, including when an existing legacy approval is already present.
-- These index changes do not revoke, replace, or rewrite any consent record.
CREATE UNIQUE INDEX guardian_consents_one_approved_guardian_scope_idx
  ON public.guardian_consents(child_id,linked_guardian_id,consent_scope)
  WHERE status='approved' AND linked_guardian_id IS NOT NULL;

-- Legacy approvals without a linked account are not application readiness, but
-- retain their original one-per-child invariant until explicitly linked.
CREATE UNIQUE INDEX guardian_consents_one_approved_unlinked_child_idx
  ON public.guardian_consents(child_id)
  WHERE status='approved' AND linked_guardian_id IS NULL;

DROP INDEX public.guardian_consents_one_approved_per_child_idx;
-- The new pair/scope index also covers the current declaration version.
DROP INDEX public.guardian_consent_current_once;

COMMIT;
