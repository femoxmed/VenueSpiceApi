ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS policy_snapshot jsonb;
