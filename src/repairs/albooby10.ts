import { DataSource } from 'typeorm';

const action = 'repair.albooby10.no-expiry.2026-11-09.v1';
const eventTitle = 'Runtown Live in Dallas — Mad Over You | Thanksgiving Friday 2026';

export async function repairAlbooby10(db: DataSource, mode: string) {
	if (mode !== 'preview' && mode !== 'apply') return 'disabled';
	return db.transaction(async tx => {
		await tx.query("SET LOCAL lock_timeout = '3s'");
		await tx.query("SET LOCAL statement_timeout = '5s'");
		// Serialize concurrent rolling-deploy instances. The marker and update commit together.
		await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [action]);
		if ((await tx.query('SELECT 1 FROM audit_logs WHERE action = $1 LIMIT 1', [action])).length) return 'already processed';
		const [row] = await tx.query(`
			SELECT c.id, c.ends_at, c.status,
				(c.approved_by_influencer_at IS NOT NULL AND c.declined_by_influencer_at IS NULL
				 AND a.status = 'active' AND u."isActive"
				 AND (c.starts_at IS NULL OR c.starts_at <= now())
				 AND (c.max_uses IS NULL OR c.uses_count < c.max_uses)
				 AND e.status = 'published' AND COALESCE(e.ends_at, e.starts_at) > now()) AS eligible,
				(c.ends_at IS NOT NULL AND c.ends_at < now()) AS past
			FROM discount_coupons c
			JOIN events e ON e.id = c."eventId" AND e."organizationId" = c."organizationId"
			JOIN agents a ON a.id = c."agentId" AND a."organizationId" = c."organizationId"
			JOIN users u ON u.id = a."userId"
			WHERE c.code = $1 AND e.title = $2
			FOR UPDATE OF c, e, a, u`, ['ALBOOBY10', eventTitle]);
		if (!row) return 'skipped: no exact campaign match';
		const evidence = JSON.stringify({ status: row.status, endsAt: row.ends_at });
		if (!row.eligible || !['active','expired'].includes(row.status)) return 'skipped: campaign is not eligible ' + evidence;
		if (row.ends_at && !row.past) return 'skipped: future end date ' + evidence;
		const healthy = row.status === 'active' && !row.ends_at;
		if (mode === 'preview') return (healthy ? 'already healthy ' : 'would restore active with no end date ') + evidence;
		if (!healthy) await tx.query("UPDATE discount_coupons SET ends_at = NULL, status = 'active', updated_at = now() WHERE id = $1", [row.id]);
		await tx.query(`INSERT INTO audit_logs (action, entity_type, entity_id, changes) VALUES ($1, 'discount_coupon', $2, $3::jsonb)`, [action, row.id, JSON.stringify({ before: JSON.parse(evidence), after: { status: 'active', endsAt: null }, changed: !healthy })]);
		return healthy ? 'already healthy; recorded completion' : 'restored active with no end date';
	});
}
