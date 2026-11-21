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
		console.log('[deploy-patch] Checking for Liberty Cromwell partial refund ledger synchronization...');

		// 1. Check if the refund ledger debit entry already exists
		const existingLedgerDebit = await queryRunner.query(
			`SELECT id, amount, status FROM financial_ledger_entries WHERE idempotency_key = $1`,
			['manual-refund-ledger:2a92a3cc-f4a4-49fd-a2ce-ed8bfad713c5'],
		);

		if (existingLedgerDebit && existingLedgerDebit.length > 0) {
			console.log('[deploy-patch] Refund ledger debit entry already exists. No patch needed:', existingLedgerDebit[0]);
		} else {
			console.log('[deploy-patch] Applying idempotent ledger correction for Liberty Cromwell refund...');
			await queryRunner.startTransaction();

			// Insert the ledger debit entry
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

			// Adjust the order's pending organizer_net entry
			await queryRunner.query(`
				UPDATE financial_ledger_entries
				SET amount = ROUND(amount - 55.51, 2),
				    updated_at = NOW()
				WHERE "orderId" = '6ead14df-dd08-44d4-9167-d5bfa38cdbca'
				  AND type = 'organizer_net'
				  AND status = 'pending'
				  AND amount = 66.00;
			`);

			// Invalidate the refunded ticket
			await queryRunner.query(`
				UPDATE issued_tickets
				SET status = 'refunded',
				    updated_at = NOW()
				WHERE id = '539307bb-7e52-4faa-9304-72defb56f3b9'
				  AND status = 'valid';
			`);

			await queryRunner.commitTransaction();
			console.log('[deploy-patch] Successfully applied Liberty Cromwell ledger correction.');
		}
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
