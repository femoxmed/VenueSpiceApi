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

		// 1. Ensure Liberty Cromwell refund ledger entry exists
		await queryRunner.query(`
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
