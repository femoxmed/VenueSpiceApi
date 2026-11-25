import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

dotenv.config();

function isEnabled(value?: string | boolean | number | null) {
	return ['true', '1', 'yes', 'require', 'required'].includes(
		String(value ?? '').trim().toLowerCase(),
	);
}

async function runDeployPatches() {
	console.log('[deploy-patch] Initializing database connection for deploy patches...');
	const dataSource = new DataSource({
		type: 'postgres',
		host: process.env.DB_HOST || 'localhost',
		port: Number(process.env.DB_PORT || 5432),
		username: process.env.DB_USERNAME || 'postgres',
		password: process.env.DB_PASSWORD || 'postgres',
		database: process.env.DB_NAME || 'aquzera',
		ssl: isEnabled(process.env.DB_SSL || process.env.DATABASE_SSL || process.env.PGSSLMODE)
			? {
					rejectUnauthorized: isEnabled(process.env.DB_SSL_REJECT_UNAUTHORIZED),
				}
			: false,
		synchronize: false,
		logging: false,
	});

	await dataSource.initialize();
	console.log('[deploy-patch] Connected to database.');

	const queryRunner = dataSource.createQueryRunner();
	await queryRunner.connect();

	try {
		console.log('[deploy-patch] Running idempotent ledger sync and balance reconciliation for OS Entertainer & Olushegzy...');
		await queryRunner.startTransaction();

		// 1. Ensure Liberty Cromwell refund ledger entry exists (if organization exists on this database)
		await queryRunner.query(`
			DO $$
			BEGIN
				IF EXISTS (SELECT 1 FROM organizations WHERE id = '60887668-bc26-4043-942a-0812d3f84a86') THEN
					INSERT INTO financial_ledger_entries (
						id,
						idempotency_key,
						"organizationId",
						"orderId",
						type,
						status,
						amount,
						currency,
						available_at,
						metadata,
						created_at,
						updated_at
					)
					VALUES (
						gen_random_uuid(),
						'manual-refund-ledger:2a92a3cc-f4a4-49fd-a2ce-ed8bfad713c5',
						'60887668-bc26-4043-942a-0812d3f84a86',
						'6ead14df-dd08-44d4-9167-d5bfa38cdbca',
						'refund',
						'reversed',
						-55.51,
						'USD',
						NOW(),
						'{"refundRequestId":"2a92a3cc-f4a4-49fd-a2ce-ed8bfad713c5","customerEmail":"libertycromwell06@gmail.com","refundAmount":60.00,"deductedOrganizerNet":55.51,"reconciliationMethod":"stripe","stripeReference":"pm_1USGkDLMkRXz4kJQsutrDb2s","reason":"Deduct organizer share for manually reconciled external/stripe refund","isManualReconciliationLedgerSync":true}'::jsonb,
						NOW(),
						NOW()
					)
					ON CONFLICT (idempotency_key) DO NOTHING;
				END IF;
			END $$;
		`);

		// 2. Adjust Liberty Cromwell pending organizer_net entry to remaining subtotal ($10.49)
		console.log('[deploy-patch] Checking and adjusting Liberty Cromwell organizer_net entry...');
		const updateResult = await queryRunner.query(`
			UPDATE financial_ledger_entries
			SET amount = 10.49,
			    updated_at = NOW()
			WHERE (
				idempotency_key = 'ticket-order:6ead14df-dd08-44d4-9167-d5bfa38cdbca:organizer_net'
				OR ("orderId" = '6ead14df-dd08-44d4-9167-d5bfa38cdbca' AND type = 'organizer_net')
			)
			AND amount > 10.49;
		`);
		console.log('[deploy-patch] Updated organizer_net entries count:', updateResult);

		// 3. Invalidate refunded ticket
		await queryRunner.query(`
			UPDATE issued_tickets
			SET status = 'refunded'
			WHERE id = '539307bb-7e52-4faa-9304-72defb56f3b9'
			  AND status = 'valid';
		`);

		// 4. Per-event withdrawal attribution and index optimization
		await queryRunner.query(`
			ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS "eventId" uuid REFERENCES events(id) ON DELETE RESTRICT;
			CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_event_id ON withdrawal_requests("eventId");
			CREATE INDEX IF NOT EXISTS idx_ticket_orders_org_event_status ON ticket_orders ("organizationId", "eventId", status);
			CREATE INDEX IF NOT EXISTS idx_ledger_org_event_status ON financial_ledger_entries ("organizationId", "eventId", status);
		`);
		console.log('[deploy-patch] Ensured withdrawal_requests.eventId and composite indices exist.');

		// 5. Backfill missing ledger entries and eventId on financial_ledger_entries from ticket_orders
		console.log('[deploy-patch] Backfilling missing ledger entries and eventId on financial_ledger_entries...');
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS idx_ledger_order_id ON financial_ledger_entries("orderId");

			-- Insert missing organizer_net ledger entries for paid orders
			INSERT INTO financial_ledger_entries (
				id,
				idempotency_key,
				"organizationId",
				"eventId",
				"orderId",
				type,
				status,
				amount,
				currency,
				available_at,
				metadata,
				created_at,
				updated_at
			)
			SELECT
				gen_random_uuid(),
				'ticket-order:' || o.id || ':organizer_net',
				o."organizationId",
				o."eventId",
				o.id,
				'organizer_net',
				CASE
					WHEN (COALESCE(e."endsAt", e."startsAt") IS NOT NULL AND COALESCE(e."endsAt", e."startsAt") < NOW())
					     OR (o."paidAt" IS NOT NULL AND o."paidAt" + INTERVAL '7 days' < NOW())
					THEN 'available'
					ELSE 'pending'
				END,
				COALESCE(o."organizerNet", 0),
				COALESCE(o.currency, 'USD'),
				CASE
					WHEN (COALESCE(e."endsAt", e."startsAt") IS NOT NULL AND COALESCE(e."endsAt", e."startsAt") < NOW())
					THEN NOW()
					WHEN e."endsAt" IS NOT NULL THEN e."endsAt" + INTERVAL '7 days'
					WHEN e."startsAt" IS NOT NULL THEN e."startsAt" + INTERVAL '7 days'
					ELSE COALESCE(o."paidAt", o.created_at, NOW()) + INTERVAL '7 days'
				END,
				jsonb_build_object(
					'payoutMode', 'platform_hold',
					'payoutEligible', true,
					'backfilledFromOrders', true
				),
				COALESCE(o."paidAt", o.created_at, NOW()),
				NOW()
			FROM ticket_orders o
			LEFT JOIN events e ON e.id = o."eventId"
			WHERE o.status = 'paid'
			  AND o."organizerNet" > 0
			  AND o."organizationId" IS NOT NULL
			  AND NOT EXISTS (
				  SELECT 1 FROM financial_ledger_entries l
				  WHERE l.idempotency_key = 'ticket-order:' || o.id || ':organizer_net'
				     OR (l."orderId" = o.id AND l.type = 'organizer_net')
			  )
			ON CONFLICT (idempotency_key) DO NOTHING;

			-- Also link any existing ledger entries that had eventId IS NULL
			UPDATE financial_ledger_entries l
			SET "eventId" = o."eventId",
			    updated_at = NOW()
			FROM ticket_orders o
			WHERE l."orderId" = o.id
			  AND l."eventId" IS NULL
			  AND o."eventId" IS NOT NULL;

			-- Ensure past events have their pending funds transitioned to available
			UPDATE financial_ledger_entries l
			SET status = 'available',
			    updated_at = NOW()
			FROM events e
			WHERE l."eventId" = e.id
			  AND l.type = 'organizer_net'
			  AND l.status = 'pending'
			  AND COALESCE(e."endsAt", e."startsAt") < NOW();
		`);
		console.log('[deploy-patch] Ensured ledger entries backfilled and mature entries transitioned to available.');

		await queryRunner.commitTransaction();
		console.log('[deploy-patch] Successfully completed deploy patches.');
	} catch (error) {
		console.error('[deploy-patch] Error running deploy patches:', error);
		if (queryRunner.isTransactionActive) {
			await queryRunner.rollbackTransaction();
		}
		throw error;
	} finally {
		await queryRunner.release();
		await dataSource.destroy();
		console.log('[deploy-patch] Closed database connection.');
	}
}

runDeployPatches().catch((err) => {
	console.error('[deploy-patch] Fatal error during deploy patches:', err);
	process.exit(1);
});
