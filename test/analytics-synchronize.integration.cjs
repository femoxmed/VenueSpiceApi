// Disposable localhost-only DB. Verifies TypeORM synchronization without running app hooks/seeds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { DataSource, getMetadataArgsStorage } = require('typeorm');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function loadEntities(dir) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) loadEntities(file);
    else if(file.endsWith('.entity.js')) require(file);
  }
}
async function main() {
  const port=Number(process.env.ANALYTICS_TEST_PORT || 55439);
  const client=new Client({host:'127.0.0.1',port,user:'analytics_test',database:'postgres'});
  await client.connect();
  const schema=`sync_test_${Date.now()}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema},public`);
  await client.query("SET TIME ZONE 'UTC'");
  loadEntities(path.join(__dirname,'../dist'));
  const entities=[...new Set(getMetadataArgsStorage().tables.map(t=>t.target))];
  const options={type:'postgres',host:'127.0.0.1',port,username:'analytics_test',database:'postgres',schema,entities,synchronize:true,extra:{options:`-c search_path=${schema},public`}};
  let db;
  try {
    db=new DataSource(options);await db.initialize();
    await client.query(`INSERT INTO users(id,full_name,email,password_hash) VALUES ($1,'Synthetic Buyer','sync-test@example.invalid','not-a-password')`,[id(1)]);
    await client.query(`INSERT INTO organizations(id,name,slug,owner_user_id) VALUES ($1,'Synthetic Organizer','sync-test',$2)`,[id(2),id(1)]);
    await client.query(`INSERT INTO events(id,"organizationId",title,slug,starts_at) VALUES ($1,$2,'Synthetic Event','sync-test','2026-11-01T12:00:00Z')`,[id(3),id(2)]);
    await client.query(`INSERT INTO ticket_orders(id,"organizationId","eventId",customer_name,customer_email,subtotal,total,status,paid_at) VALUES ($1,$2,$3,'Synthetic Buyer','sync-test@example.invalid',100,110,'paid','2026-10-01T12:00:00Z')`,[id(4),id(2),id(3)]);
    const before=await client.query('SELECT id,total,status FROM ticket_orders');
    await db.destroy();db=null;
    // Emulate the known pre-change schema by removing the additive fields from current entities.
    const added={
      organizations:['payout_policy','payout_delay_days','payout_policy_starts_at','payout_policy_ends_at','payout_policy_reason','payout_policy_refund_risk_accepted_at','payout_policy_refund_risk_accepted_by'],
      events:['venue_postal_code','tax_collection_mode','tax_responsibility','organizer_tax_rate','organizer_tax_label','organizer_tax_permit_confirmed','organizer_tax_consent_at','organizer_tax_consent_text','venue_address_tax_confirmed','venue_address_tax_confirmed_at','venue_address_tax_consent_text','tax_code'],
      ticket_orders:['analytics_session_id','analytics_visitor_id','tax_provider','tax_collection_mode_snapshot','tax_responsibility_snapshot','tax_rate_snapshot','tax_label_snapshot','event_tax_location_snapshot','buyer_billing_address_snapshot','tax_breakdown'],
      discount_coupons:['influencer_reward_type','influencer_reward_value','influencer_decline_reason'],
    };
    for(const [table,columns] of Object.entries(added)) for(const column of columns) await client.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    await client.query('DROP TABLE analytics_events');
    for(const index of ['analytics_users_created_idx','analytics_events_created_idx','analytics_orders_paid_idx','analytics_items_order_idx','analytics_refunds_completed_idx']) await client.query(`DROP INDEX ${index}`);
    db=new DataSource(options);await db.initialize();
    assert.deepEqual((await client.query('SELECT id,total,status FROM ticket_orders')).rows,before.rows);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count,1);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM events')).rows[0].count,1);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM organizations')).rows[0].count,1);
    for(const [table,columns] of Object.entries(added)) {
      const result=await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[schema,table]);
      const found=new Set(result.rows.map(r=>r.column_name));for(const column of columns) assert.ok(found.has(column),`${table}.${column}`);
    }
    const indexes=await client.query("SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND indexname LIKE 'analytics_%'",[schema]);
    assert.equal(indexes.rows.length,7);
    assert.equal((await client.query('SELECT analytics_session_id,tax_provider FROM ticket_orders')).rows[0].analytics_session_id,null);
    assert.equal((await client.query('SELECT tax_provider FROM ticket_orders')).rows[0].tax_provider,'none');
    await client.query(`INSERT INTO analytics_events(id,name,visitor_id,session_id,page) VALUES ($1,'page_view',$2,$3,'home')`,[id(5),id(6),id(7)]);
    await db.synchronize();
    assert.equal((await client.query('SELECT count(*)::int AS count FROM analytics_events')).rows[0].count,1);
    assert.deepEqual((await client.query('SELECT id,total,status FROM ticket_orders')).rows,before.rows);
    console.log(`Synchronization checks passed for ${entities.length} entity definitions: existing sample records preserved; all known new columns, tracking table and seven indexes created; repeat synchronization preserves sample order and telemetry data.`);
  } finally {
    if(db?.isInitialized) await db.destroy();
    await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
