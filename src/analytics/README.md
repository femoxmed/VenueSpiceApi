# Analytics rollout

Implemented admin reports: registrations, event creation, organizer adoption, ticket sales, and revenue. Open Analytics in the admin app; the Revenue navigation opens the same reporting interface with Revenue selected.

## Deployment

1. For automatic setup, take a database snapshot and deploy with `DB_SYNCHRONIZE=true`. TypeORM creates the analytics table, nullable checkout attribution columns and all seven analytics/report indexes before the API starts accepting requests. No manual SQL is required for this path. Synchronization reconciles every registered entity, including other existing local backend changes; it is not restricted to analytics. The database user needs schema-altering privileges. After a successful rollout, setting `DB_SYNCHRONIZE=false` prevents future deployments from automatically changing the schema. If synchronization is disabled from the outset, apply `sql/20261014-analytics.sql` and any other pending schema changes before deploying.
2. Deploy the API and admin app together. Reports read existing data immediately. No seed/reset scripts are needed for this feature.
3. To collect new website activity, set backend `ANALYTICS_TRACKING_ENABLED=true` and `ANALYTICS_ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins (no trailing slash).
4. Set web `NEXT_PUBLIC_ANALYTICS_ENABLED=true` and rebuild/deploy the public site. Keep its existing `NEXT_PUBLIC_API_URL` pointing at the deployed API. Collection is disabled by default so an incomplete rollout does not silently collect data.
5. Visit a public event and select a ticket. Verify POST `/api/analytics/events` returns `{accepted:true}`. Confirm `analytics_events` has page views and ticket-selection events. When a checkout is created, its order should have `analytics_session_id` and `analytics_visitor_id`. Confirmed purchases are derived from that order's backend `paid_at` and status, not client telemetry.

Production data and environment files have not been changed by this implementation.

## Report API and definitions

Authenticated GET `/api/analytics/reports/:report` accepts required `start` and `end` (YYYY-MM-DD inclusive), optional `groupBy=day|week|month`, `organizationId` and `eventId`. Maximum range is 366 days. Reporting days use UTC, weeks start Monday, and partial buckets include only dates inside the filter. The response has columns, zero-filled buckets, independently calculated totals and the immediately preceding equal-length period. GET the same path with `/export` for a CSV containing both periods and their filter metadata. CSV opens in Excel; native XLSX export is not included in this phase.

- `registrations`: all accounts by creation date, including unverified accounts. Platform administrators only; organization/event filters are rejected because registrations are not attributable to events.
- `event-creation`: events by creation date, regardless of current status.
- `organizer-adoption`: organizations of type `organization`, excluding vendor/influencer accounts. New organizers are counted by organization creation date. Active means creating an event or receiving a confirmed order during the period. Published means currently published events created in the period, not historical publication transitions. Distinct totals are calculated across the whole period, not summed from daily counts.
- `ticket-sales`: confirmed orders by `paid_at`, including orders later refunded. Ticket quantities come from ticket order items, so merchandise does not inflate ticket counts. Order counts may include merchandise-only checkouts. Free/paid-price counts use ticket unit prices; order-level discounts do not reclassify tickets. Net unrefunded ticket quantities are not inferred from monetary refunds.
- `revenue`: separate currencies. Gross checkout sales include tickets and merchandise, using the saved gross subtotal when available. Buyer payments, platform fees and processing fees use saved order amounts. Only succeeded refunds with `completed_at` are counted, on their completion date, even if the sale was earlier. Estimated platform revenue subtracts proportional platform-fee refund allocations, not the entire refund. This is not reconciled accounting profit: actual processor costs, fee reversals and disputes require further provider/ledger reconciliation.

The API allows administrators platform-wide access. Other authenticated users must select an organization they own or actively belong to; event filters must belong to that organization. These same checks execute before CSV exports. The new report UI is in the admin application; organizer report screens are not added in this phase, but scoped report endpoints are available.

## Tracking foundation

Collection covers home, event listings, accessible event detail pages and ticket selection. Engagement is visible-page time while activity was detected within the last minute, sent in small intervals. Ticket selection and checkout starts are deduplicated within a browser tab/session/event. New checkout orders retain anonymous session and visitor IDs so a future funnel can count distinct sessions and use backend-confirmed payments.

Visitor IDs rotate after 90 days. Sessions expire after 30 minutes without recorded activity. Browser storage restrictions, failed network requests and disabled tracking never block checkout. Do Not Track, Global Privacy Control and localStorage `vs_analytics_opt_out=true` suppress collection and attribution. Only page categories, event IDs, coarse source labels and anonymous IDs are sent; URL paths, query parameters, access tokens, buyer details, and full referrer URLs are not collected. This does not add a consent-management UI.

Raw events are deleted after 90 days by a daily UTC job. Order attribution columns follow existing transaction retention. The collector validates an allowlisted payload and origin, deduplicates event IDs, disallows purchase events, and limits requests per network address in each API instance. Configure shared edge rate limiting for a multi-instance deployment; do not blindly trust forwarded IP headers. Browser tracking remains best-effort and can be blocked or spoofed, so it must not determine financial totals.

Traffic, engagement and funnel dashboards, historical backfill, user-account activity linkage and comprehensive attribution are intentionally outside this initial tracking foundation. No data exists before collection is enabled.

## Verification

- `npm run build` in API and admin.
- `node test/analytics.integration.cjs` in API, after building, against a disposable local PostgreSQL server on 127.0.0.1:55439 (override only the port with `ANALYTICS_TEST_PORT`), user `analytics_test`, database `postgres`. Tests create/drop their own schema and insert synthetic fixtures; never point them at a live database. Covers report SQL, period boundaries, grouping, distinct totals, currencies, refunds, authorization, exports, rerunnable migration, collector validation, ORM insertion/deduplication and pruning.
- `node test/analytics.cjs` in web checks session/visitor expiry, source classification, event context, deduplication, privacy signals and non-blocking tracking failures.

Existing public-site validation blockers observed: generated Next page types reject the dashboard's named `DashboardPageContent` export and the event page's synchronous-or-Promise params union. The local Next build also lacks native SWC bindings for Turbopack. A source-only TypeScript check (excluding generated `.next` types) passed. These unrelated files and dependencies were not changed.

Automatic setup verification: `node test/analytics-synchronize.integration.cjs` uses the same disposable local PostgreSQL connection as the report tests. It emulates the known pre-change schema, inserts sample user/organization/event/order records, then verifies that synchronization recreates the new columns, table and seven indexes without losing those records. Repeat synchronization is tested too. This does not establish that an uninspected production schema will have an identical synchronization plan.
