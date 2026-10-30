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

Platform admins can choose cancellationReason voluntary, organizer_cancellation or platform_error. The latter two refund 100% of the total including fees and tax, bypassing voluntary cutoff, refund-disabled and checked-in restrictions; paid status and duplicate/dispute safeguards still apply. Buyer requests and organizer approvals remain voluntary. For an existing requested refund, use its Approve action and component preview; it updates that same request without creating a second refund.

The preview shows original subtotal, buyer fees, processing fee, tax, applied percentage, refunded components, retained processing fee and total retained. policy_snapshot on each refund preserves the approved reason and calculation; creation retries keep the persisted amount. Refunds including ticket charges invalidate all tickets in the order on confirmed success; fee-only adjustments keep tickets and order paid status unchanged. Tax reporting must account for the refund; this does not introduce a tax filing/reversal integration.

Deployment: publish the frontend checkout disclosure before enabling new backend order creation. Deploy backend and admin together. With DB_SYNCHRONIZE=true the nullable policy_snapshot column is added automatically. Otherwise apply sql/2026-10-28-refund-policy.sql before deploying the backend. No historical refund/payment records are rewritten.

## Admin component selection

Admin preview returns availableComponents and recommended refundComponents for tickets/add-ons, buyer service fee, buyer processing fee and tax. Admins may select each component and adjust it between zero and its original paid amount, including overriding the recommended percentage or processing retention. Changing the selection resets UI confirmation. POST /refunds/admin-issue accepts optional refundAmounts with all four numeric keys (tickets, serviceFee, processingFee, tax). The server validates finite nonnegative two-decimal values, each component cap, a positive total and expectedAmount; it repeats validation while holding the order lock. The exact selected breakdown is stored in policy_snapshot and used for retries/auditing. Existing automatic buyer-request calculations are unchanged. No new database columns or environment variables are needed beyond the existing policy_snapshot deployment.

Ticket-charge refunds cancel all tickets in the order; fee-only adjustments preserve tickets and order/payment/invoice paid status. Further refunds for an already-refunded order/payment remain blocked, including after a fee-only adjustment. Per-ticket cancellation and successive partial refunds are not implemented.

## Existing request approval and customer emails

The admin table Approve button automatically loads GET /refunds/requests/:id/preview and opens the component modal. POST /refunds/requests/:id/approve-selected accepts the same confirmed selection as direct admin issuance. It checks request/order identity and requested status, and conditionally claims the same record under the order lock. Concurrent approvals cannot submit a second refund. Organizer legacy approval remains policy-based.

Tax defaults proportionally to the selected ticket subtotal in the UI. This is a preview estimate, not a jurisdiction-specific tax engine; administrators must review mixed taxable fees against original records. The approved snapshot preserves the tax amount for reporting adjustment.

Provider-accepted pending refunds create a processing email; success creates a confirmation email; failed refunds create a buyer update and an alert to the reviewing administrator. Immediate success sends just the confirmation. Network ambiguity without a known provider result does not claim success or send a processing acceptance email. No historical completed requests are backfilled.

Emails are recorded transactionally in refund_email_outbox and dispatched through the existing notifications queue. Stable per-refund/state/recipient job IDs and retained BullMQ jobs prevent duplicates from repeated status updates or outbox retries. Queue outages retain unsent outbox entries for the minute scheduler. Existing SMTP queue retry settings apply; exhausted send failures require queue review. SMTP itself cannot guarantee exactly-once delivery if a mail server accepts a message but its response is lost.

Deploy with DB_SYNCHRONIZE=true, or run sql/2026-10-30-refund-emails.sql (and the earlier policy_snapshot migration if not already applied). Existing Redis, notifications worker and SMTP settings are required; no new environment variables. Do not prune retained refund email jobs while they are needed for deduplication.
