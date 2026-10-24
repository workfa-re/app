BEGIN;

-- Return the existing family's actual consent state. Redeeming a fresh parent
-- invitation must not request a second signature when the exact pair already
-- has a valid approval; an active relationship alone is still insufficient.
-- Only response projection changes. No approval/evidence workflow is invoked.
DO $$
DECLARE source text; modified text;
BEGIN
 source:=pg_get_functiondef('guardian_private.redeem(text,boolean,text,text)'::regprocedure);
 modified:=replace(source,
   'CASE WHEN minor AND invitation.direction=''guardian_to_child'' THEN ''pending_guardian_confirmation'' ELSE ''linked'' END',
   'CASE WHEN minor AND NOT guardian_private.relationship_approved(v_child_id,v_parent_id) THEN ''pending_guardian_confirmation'' ELSE ''linked'' END');
 IF source=modified THEN RAISE EXCEPTION 'Expected initial family result projection was not found'; END IF;
 source:=modified;
 modified:=replace(source,
   'AND r2.status=''active'') THEN ''linked''',
   'AND r2.status=''active'' AND (NOT guardian_private.needs_consent(v_child_id) OR guardian_private.relationship_approved(v_child_id,r2.guardian_id))) THEN ''linked''');
 IF source=modified THEN RAISE EXCEPTION 'Expected family retry result projection was not found'; END IF;
 EXECUTE modified;
END $$;

COMMIT;
