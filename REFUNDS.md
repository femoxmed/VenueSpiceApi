# Refund processing

Refund approval requires STRIPE_SECRET_KEY and a real Stripe PaymentIntent reference (`pi_...`). Missing configuration, absent references and local/demo references are rejected before the request is claimed. They never generate a synthetic successful refund.

Only a matching Stripe refund with status `succeeded` marks the request, order, tickets, invoice and payment record refunded. Ticket capacity is restored in the same database transaction. Stripe `pending`, `requires_action` and unrecognized statuses remain `processing`; `failed` and `canceled` become `failed`. Tickets remain valid while processing or failed. A successful provider status does not guarantee that the buyer's bank has already posted the credit.

The existing Nest scheduler reconciles processing refunds every minute, in batches of 100. Known Stripe refund IDs are retrieved with the configured secret key. No additional webhook subscription or environment variable is required. Multiple instances can run the reconciler; row locking prevents duplicate local completion, and the same Stripe idempotency key is used for every creation attempt for a given request.

The approved amount is persisted before calling Stripe and reused on retries. Network errors, provider server errors and ambiguous retry responses remain processing. Creation retries without a known refund ID stop after 23 hours from approval to avoid reuse after Stripe's idempotency retention window. These requests log a warning and require manual reconciliation against Stripe; do not issue another refund blindly. `requires_action` also needs attention in Stripe where applicable.

Existing records previously marked successful by the old local fallback are not automatically changed or reissued. Reconcile any `local_refund_...` records against payment-provider records before making corrections. This release does not change percentage-refund policy or add per-ticket refunds.

Validation: `npm run build`, then `node test/refunds.integration.cjs` with an isolated localhost PostgreSQL instance on port 55439 (or ANALYTICS_TEST_PORT), user analytics_test. The suite uses synthetic records in a disposable schema and mocks all Stripe calls. Never point it at production.
