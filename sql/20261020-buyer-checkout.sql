-- Additive alternative to DB_SYNCHRONIZE=true. Run against the application's schema.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_terms_accepted_at timestamptz;
ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS buyer_user_id uuid;
CREATE INDEX IF NOT EXISTS ticket_orders_buyer_user_idx ON ticket_orders (buyer_user_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_orders_buyer_user_fk' AND conrelid = 'ticket_orders'::regclass) THEN
    ALTER TABLE ticket_orders ADD CONSTRAINT ticket_orders_buyer_user_fk FOREIGN KEY (buyer_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS buyer_login_challenges (
  email varchar PRIMARY KEY,
  "challengeId" uuid NOT NULL,
  "codeHash" varchar NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "sentAt" timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  "consumedAt" timestamptz
);
CREATE TABLE IF NOT EXISTS buyer_login_limits (
  key varchar PRIMARY KEY,
  "windowAt" timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0
);
COMMIT;
