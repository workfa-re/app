BEGIN;

-- ON DELETE SET NULL preserves consent evidence after a guardian account is
-- removed. More than one historical guardian can therefore become unlinked.
-- Unlinked evidence never authorizes a reservation: readiness still requires
-- the exact active relationship and a currently eligible linked guardian.
DROP INDEX public.guardian_consents_one_approved_unlinked_child_idx;

-- The approved (child, guardian, scope) uniqueness for linked accounts remains.
COMMIT;
