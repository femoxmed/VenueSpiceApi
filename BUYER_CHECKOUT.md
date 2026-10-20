# Customer accounts and ticket checkout

Customers can sign in during checkout using an existing account of any role, or verify an email code to create a customer account. Ticket selection, attendees, referral code and checkout state remain on the page. The purchaser must supply a name and a valid international phone number; phone ownership is not SMS-verified. Attendee details remain separate from the purchasing account.

Email-code sessions are restricted to purchasing, profile completion, My Tickets and verified guest-order claims. They retain the existing account identity and role but cannot access organizer/admin management APIs. Existing password sign-in (including administrator OTP) remains available. New customers can use password reset later to set a password.

## Deployment order and environment

1. Back up the database. Deploy the backend with `DB_SYNCHRONIZE=true` and `CHECKOUT_ACCOUNT_REQUIRED=false` initially. Synchronization adds the nullable order buyer reference, customer terms timestamp and email challenge/rate-limit tables. It reconciles all registered entities, not only these fields. Alternatively, apply `sql/20261020-buyer-checkout.sql` with synchronization disabled.
2. Deploy the web frontend and admin frontend, retaining their existing API URL and analytics environment settings. No new frontend or admin environment variables are required.
3. Confirm Redis/email workers and the existing SMTP configuration deliver sign-in codes. Keep existing `JWT_SECRET` and `JWT_REFRESH_SECRET` (if configured) unchanged. No new email provider or SMS settings are needed.
4. Set backend `CHECKOUT_ACCOUNT_REQUIRED=true` (exact lowercase) to require authenticated checkout. The frontend reads `/ticket-orders/checkout-requirements`; no frontend flag is needed. Existing payment sessions/webhooks can still complete. With the flag false, legacy guest checkout remains available; signed-in purchases still require name/phone and are account-linked.
5. After a successful schema update, `DB_SYNCHRONIZE=false` can disable synchronization on later restarts. Keep `ANALYTICS_TRUST_CLOUDFRONT_GEO=false`. Existing Stripe settings and webhook events are unchanged.

Optional backend `AUTH_TRUST_PROXY_HOPS=0` defaults to trusting no proxy headers. Set it to the exact number of trusted reverse-proxy hops in your deployment (supported range 0–5) only when clients cannot bypass that proxy path. This controls the client IP used for OTP rate limits; with 0, users behind the same reverse proxy share its IP allowance. Do not guess a nonzero value.

## Data and access

- Every new authenticated order stores `buyer_user_id` and a checkout-time name, email and phone snapshot. Later profile edits do not rewrite receipts/order history. The API derives purchaser identity from the authenticated user, ignoring submitted identity overrides.
- `/my-tickets` shows only the signed-in user's orders and issued ticket codes. Ticket email delivery, resend and refund flows remain available. Refunds and cancellations do not grant active tickets.
- Historical guest orders remain unlinked until the customer requests a claim and proves email ownership with a new email sign-in code. Proof expires after 10 minutes. Claims only attach unowned orders with the matching email; they cannot transfer another account's orders.
- Ticket customers appears in administrator Analytics and organizer Analytics. Administrators see all customers; organization owners and active members see only their own organization's purchases. Totals are grouped by email/currency; paid totals are before refunds. Order history includes unsuccessful orders as well as completed purchases.
- Account terms acceptance does not create marketing consent.
- Codes expire after 10 minutes, are hashed at rest, single-use and limited to five verification attempts. Sending is limited to once per minute, five per email/hour and 300 per IP/hour, persisted across instances/restarts. No codes are logged by this flow.
- Existing already-verified users must sign in; the legacy email-verification endpoint no longer issues sessions without verifying a code.

## Smoke test after deployment

Use a test event/payment configuration: select tickets and apply a referral, sign in inline, confirm the selection/discount remains, enter name/phone, complete checkout, and check the purchase in My Tickets and customer Analytics. Repeat with an existing organizer/promoter account and a free ticket. Check missing/invalid phone, wrong/expired code, another user's ticket access, refresh during the session, and a previous guest purchase claim. Confirm ticket email delivery and exactly one successful payment/order before enabling the requirement broadly.

Local regression: build the API and run `node test/buyer-checkout.integration.cjs` against disposable PostgreSQL on localhost:55439, user `analytics_test`, database `postgres` (override port with `ANALYTICS_TEST_PORT`). Install `uuid-ossp` in public first. The suite creates/drops only its own synthetic schema and mocks email/payment services. It covers actual HTTP guards/DTOs, existing roles, OTP expiry/replay/attempt/send limits, concurrency, refresh scope, ownership/snapshots, claims, tenant isolation, and legacy/repeated synchronization. Live SMTP and Stripe settlement must be verified in deployment.
