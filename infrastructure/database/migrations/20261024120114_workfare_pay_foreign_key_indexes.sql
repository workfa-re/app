BEGIN;

-- Cover financial relationship lookups and foreign-key maintenance.
CREATE INDEX payment_order_events_order_idx ON payment_private.order_events(order_id);
CREATE INDEX payment_orders_application_idx ON payment_private.orders(application_id);
CREATE INDEX payment_orders_job_idx ON payment_private.orders(job_id);

COMMIT;
