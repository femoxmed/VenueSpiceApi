# Refund processing

Refund approval requires STRIPE_SECRET_KEY and a real Stripe PaymentIntent reference (`pi_...`). Missing configuration, absent references and local/demo references are rejected before the request is claimed. They never generate a synthetic successful refund.

Only a matching Stripe refund with status `succeeded` marks the request, order, tickets, invoice and payment record refunded. Ticket capacity is restored in the same database transaction. Stripe `pending`, `requires_action` and unrecognized statuses remain `processing`; `failed` and `canceled` become `failed`. Tickets remain valid while processing or failed. A successful provider status does not guarantee that the buyer's bank has already posted the credit.

The existing Nest scheduler reconciles processing refunds every minute, in batches of 100. Known Stripe refund IDs are retrieved with the configured secret key. No additional webhook subscription or environment variable is required. Multiple instances can run the reconciler; row locking prevents duplicate local completion, and the same Stripe idempotency key is used for every creation attempt for a given request.

The approved amount is persisted before calling Stripe and reused on retries. Network errors, provider server errors and ambiguous retry responses remain processing. Creation retries without a known refund ID stop after 23 hours from approval to avoid reuse after Stripe's idempotency retention window. These requests log a warning and require manual reconciliation against Stripe; do not issue another refund blindly. `requires_action` also needs attention in Stripe where applicable.

Existing records previously marked successful by the old local fallback are not automatically changed or reissued. Reconcile any `local_refund_...` records against payment-provider records before making corrections. The cancellation policy below applies to newly versioned orders; per-ticket refunds are not supported.

Validation: `npm run build`, then `node test/refunds.integration.cjs` with an isolated localhost PostgreSQL instance on port 55439 (or ANALYTICS_TEST_PORT), user analytics_test. The suite uses synthetic records in a disposable schema and mocks all Stripe calls. Never point it at production.

## Admin tools

Admin → Refunds & Disputes now includes on-demand reconciliation and direct refunds. Both are restricted to platform administrator roles. No new environment variables are required; use the existing STRIPE_SECRET_KEY for the correct account and live/test mode.

GET /refunds/reconciliation?page=1 reads local refund requests (10 per page) and performs only Stripe GET requests. It does not update records, emit audits or issue refunds. It flags missing/unlinked refunds, amount/status/reference differences, extra provider refunds, pending/failed refunds, and unavailable/incomplete lookups. CSV exports the current page. An empty provider result is not proof that the customer was never reimbursed: check the account/mode, disputes and external reimbursements. This report starts from local requests; it is not a complete scan of all Stripe payments.

GET /refunds/admin-preview/:orderId validates eligibility and the original Stripe payment without writes. POST /refunds/admin-issue requires orderId, reason, expectedAmount, cancellationReason and confirmed=true. It rechecks eligibility and payment state, locks the order and creates an audited processing request before using the existing idempotent Stripe workflow. Existing active/completed local refunds, provider refunds and disputed charges block direct issuance. It does not repair historical mismatches automatically.

## Cancellation policy

New orders record refundPolicyVersion=processing-retained-v1 in the fee snapshot. Voluntary cancellation retains only the original buyerProcessingFee, not organizer-paid fees or a guessed Stripe cost. The existing event percentage applies to (total minus that processing fee); service fees and tax are included proportionally. Orders without the version marker keep their previous percentage-of-total terms. Mixed orders with incomplete fee allocation require reconciliation rather than guessing.

Platform admins can choose cancellationReason voluntary, organizer_cancellation or platform_error. The latter two refund 100% of the total including fees and tax, bypassing voluntary cutoff, refund-disabled and checked-in restrictions; paid status and duplicate/dispute safeguards still apply. Buyer requests and organizer approvals remain voluntary. To handle an order with an existing requested refund through the direct admin flow, decline that pending request first; do not create parallel refunds.

The preview shows original subtotal, buyer fees, processing fee, tax, applied percentage, refunded components, retained processing fee and total retained. policy_snapshot on each refund preserves the approved reason and calculation; creation retries keep the persisted amount. All tickets are invalidated on confirmed success, even for percentage refunds. Tax reporting must account for the refund; this does not introduce a tax filing/reversal integration.

Deployment: publish the frontend checkout disclosure before enabling new backend order creation. Deploy backend and admin together. With DB_SYNCHRONIZE=true the nullable policy_snapshot column is added automatically. Otherwise apply sql/2026-10-28-refund-policy.sql before deploying the backend. No historical refund/payment records are rewritten.
