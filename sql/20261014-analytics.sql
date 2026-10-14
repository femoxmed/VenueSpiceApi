-- Apply before deploying when DB_SYNCHRONIZE=false. Additive and safe to rerun.
BEGIN;
CREATE TABLE IF NOT EXISTS analytics_events (
 id uuid PRIMARY KEY,
 name varchar(32) NOT NULL,
 visitor_id uuid NOT NULL,
 session_id uuid NOT NULL,
 event_id uuid,
 page varchar(64) NOT NULL,
 source varchar(100),
 engaged_seconds integer NOT NULL DEFAULT 0,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_received_idx ON analytics_events(received_at);
CREATE INDEX IF NOT EXISTS analytics_events_session_name_idx ON analytics_events(session_id,name);
ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS analytics_session_id uuid;
ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS analytics_visitor_id uuid;
CREATE INDEX IF NOT EXISTS analytics_orders_paid_idx ON ticket_orders(paid_at, "organizationId", "eventId");
CREATE INDEX IF NOT EXISTS analytics_items_order_idx ON ticket_order_items("orderId");
CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON events(created_at, "organizationId");
CREATE INDEX IF NOT EXISTS analytics_users_created_idx ON users(created_at);
CREATE INDEX IF NOT EXISTS analytics_refunds_completed_idx ON refund_requests(completed_at) WHERE status = 'succeeded';
CREATE INDEX IF NOT EXISTS analytics_events_event_received_idx ON analytics_events(event_id, received_at);
CREATE INDEX IF NOT EXISTS analytics_orders_attribution_idx ON ticket_orders(analytics_session_id, analytics_visitor_id, "eventId");
COMMIT;
