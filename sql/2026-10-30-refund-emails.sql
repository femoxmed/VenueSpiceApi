CREATE TABLE IF NOT EXISTS refund_email_outbox (
 id varchar PRIMARY KEY,
 recipient varchar NOT NULL,
 subject varchar NOT NULL,
 html text NOT NULL,
 queued_at timestamptz,
 created_at timestamp NOT NULL DEFAULT now()
);
