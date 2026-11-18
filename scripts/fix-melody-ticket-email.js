/*
 * One-off production repair for a checkout entered with the wrong email.
 * Dry-run by default. To apply and resend the ticket email:
 *   APPLY_MELODY_EMAIL_FIX=true node scripts/fix-melody-ticket-email.js
 *
 * Required database variables are the same ones used by the API. Set
 * API_BASE_URL when the API is not running at http://127.0.0.1:3000.
 */
const { Client } = require('pg');

const OLD_EMAIL = 'melodyzilpah@gmail.com';
const NEW_EMAIL = 'melodyzilpahd@gmail.com';
const FULL_NAME = 'Melody Dzobo';
const apply = process.env.APPLY_MELODY_EMAIL_FIX === 'true';

function connectionOptions() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'aquzera',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

async function main() {
  const client = new Client(connectionOptions());
  await client.connect();
  try {
    const orders = await client.query(
      `SELECT id, status, customer_name, customer_email
       FROM ticket_orders
       WHERE LOWER(customer_email) = LOWER($1)
       ORDER BY created_at DESC`,
      [OLD_EMAIL],
    );
    const users = await client.query(
      `SELECT id, full_name, email FROM users WHERE LOWER(email) = LOWER($1)`,
      [OLD_EMAIL],
    );
    const tickets = await client.query(
      `SELECT t.id, t.order_id, t.holder_name, t.holder_email
       FROM issued_tickets t
       WHERE LOWER(t.holder_email) = LOWER($1)`,
      [OLD_EMAIL],
    );

    console.log(JSON.stringify({ dryRun: !apply, orders: orders.rows, users: users.rows, tickets: tickets.rows }, null, 2));
    if (!orders.rowCount && !users.rowCount && !tickets.rowCount) {
      throw new Error('No records matched the old email; nothing changed.');
    }
    if (!apply) {
      console.log('Dry run only. Set APPLY_MELODY_EMAIL_FIX=true to update and resend.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE ticket_orders
       SET customer_email = $1, customer_name = $2, updated_at = NOW()
       WHERE LOWER(customer_email) = LOWER($3)`,
      [NEW_EMAIL, FULL_NAME, OLD_EMAIL],
    );
    await client.query(
      `UPDATE issued_tickets
       SET holder_email = $1, holder_name = CASE WHEN LOWER(holder_email) = LOWER($2) THEN $3 ELSE holder_name END
       WHERE LOWER(holder_email) = LOWER($2)`,
      [NEW_EMAIL, OLD_EMAIL, FULL_NAME],
    );
    await client.query(
      `UPDATE users SET email = $1, full_name = $2, updated_at = NOW()
       WHERE LOWER(email) = LOWER($3)`,
      [NEW_EMAIL, FULL_NAME, OLD_EMAIL],
    );
    await client.query('COMMIT');

    const baseUrl = (process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/ticket-orders/find-my-ticket`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: NEW_EMAIL }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Ticket resend failed (${response.status}): ${body}`);
    console.log(`Updated ${orders.rowCount} order(s), ${tickets.rowCount} ticket(s), ${users.rowCount} user account(s). Ticket email queued for ${NEW_EMAIL}.`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
