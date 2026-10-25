BEGIN;
-- Snapshot handlers retrieve the actual payout, but concurrent responses may
-- finish out of order. Retain terminal facts on the same immutable payout;
-- a later bank failure after "paid" remains valid and must still be recorded.
CREATE FUNCTION payment_private.payout_status_ordering() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.payout_ref IS NOT NULL AND NEW.payout_ref=OLD.payout_ref AND (
   (OLD.payout_status IN('failed','canceled') AND NEW.payout_status IS DISTINCT FROM OLD.payout_status)
   OR (OLD.payout_status='paid' AND (NEW.payout_status IS NULL OR NEW.payout_status IN('pending','in_transit')))
   OR (OLD.payout_status='in_transit' AND (NEW.payout_status IS NULL OR NEW.payout_status='pending'))
 ) THEN
  NEW.payout_status:=OLD.payout_status;
  NEW.arrival_at:=OLD.arrival_at;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION payment_private.payout_status_ordering() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_status_ordering BEFORE UPDATE OF payout_status ON payment_private.payout_operations
 FOR EACH ROW EXECUTE FUNCTION payment_private.payout_status_ordering();
COMMIT;
