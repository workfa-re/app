BEGIN;
CREATE INDEX notification_endpoints_channel ON notification_private.channel_endpoints (channel);
CREATE INDEX notification_deliveries_channel ON notification_private.deliveries (channel);
CREATE INDEX notification_deliveries_endpoint ON notification_private.deliveries (endpoint_id);
COMMIT;