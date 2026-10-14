// Run after npm run build against a disposable local PostgreSQL instance only.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { TrackingService } = require('../dist/analytics/tracking.service');
const { AnalyticsEventEntity } = require('../dist/analytics/entities/analytics-event.entity');
const { AnalyticsService } = require('../dist/analytics/analytics.service');
const { reportPeriod, reportCsv, csvCell } = require('../dist/analytics/report-utils');
const { AnalyticsController } = require('../dist/analytics/analytics.controller');
const { TrackEventDto } = require('../dist/analytics/dto/track-event.dto');
const { validate } = require('class-validator');
const { readFileSync } = require('node:fs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function main() {
  const client = new Client({ host: '127.0.0.1', port: Number(process.env.ANALYTICS_TEST_PORT || 55439), user: 'analytics_test', database: 'postgres' });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  // Isolated schema: never drop or touch a pre-existing application schema.
  const schema = `analytics_test_${Date.now()}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  try {
    await client.query(`
      CREATE TABLE users(id uuid, created_at timestamptz);
      CREATE TABLE organizations(id uuid, created_at timestamptz, type text, owner_user_id uuid);
      CREATE TABLE organization_members(organization_id uuid, user_id uuid, status text);
      CREATE TABLE events(id uuid, "organizationId" uuid, created_at timestamptz, status text);
      CREATE TABLE ticket_orders(id uuid, "organizationId" uuid, "eventId" uuid, paid_at timestamptz, status text, currency text, subtotal numeric, total numeric, platform_fee numeric, processing_fee numeric, fee_snapshot jsonb);
      CREATE TABLE ticket_order_items("orderId" uuid, quantity int, unit_price numeric);
      CREATE TABLE refund_requests(order_id varchar, status text, completed_at timestamptz, currency text, amount numeric);
    `);
    await client.query(readFileSync(require('node:path').join(__dirname, '../sql/20261014-analytics.sql'), 'utf8'));
    // Idempotent migration.
    await client.query(readFileSync(require('node:path').join(__dirname, '../sql/20261014-analytics.sql'), 'utf8'));
    await client.query(`INSERT INTO users VALUES ($1,'2026-01-01T00:00:00Z'), ($2,'2026-01-31T23:59:59Z'), ($3,'2026-02-01T00:00:00Z'), ($4,'2025-12-01T00:00:00Z')`, [id(1),id(2),id(3),id(4)]);
    await client.query(`INSERT INTO organizations VALUES ($1,'2026-01-01','organization',$3),($2,'2025-12-01','organization',$4),($5,'2026-01-01','influencer',$4)`,[id(10),id(11),id(1),id(2),id(12)]);
    await client.query(`INSERT INTO organization_members VALUES ($1,$2,'active'),($1,$3,'inactive')`,[id(10),id(3),id(4)]);
    await client.query(`INSERT INTO events VALUES ($1,$3,'2026-01-01','published'),($2,$4,'2026-01-02','draft'),($5,$3,'2026-01-10','published')`,[id(20),id(21),id(10),id(11),id(22)]);
    await client.query(`INSERT INTO ticket_orders VALUES
      ($1,$4,$6,'2026-01-01','refunded','USD',100,110,10,0,'{}'),
      ($2,$5,$7,'2026-01-02','paid','NGN',200,220,20,0,'{}'),
      ($3,$4,$6,'2025-12-20','paid','USD',50,55,5,0,'{}'),
      ($8,$4,$6,NULL,'pending','USD',999,999,999,0,'{}')`,[id(30),id(31),id(32),id(10),id(11),id(20),id(21),id(33)]);
    await client.query(`INSERT INTO ticket_order_items VALUES ($1,2,50),($1,1,0),($2,4,50),($3,1,50)`,[id(30),id(31),id(32)]);
    await client.query(`INSERT INTO refund_requests VALUES ($1,'succeeded','2026-01-05','USD',55),($1,'requested',NULL,'USD',55)`,[id(30)]);
    const service = new AnalyticsService({ query: async (sql, args) => (await client.query(sql,args)).rows });
    const admin = {id:id(1),role:'admin'};
    const query = {start:'2026-01-01',end:'2026-01-31',groupBy:'day'};
    const registration = await service.report('registrations',query,admin);
    assert.equal(registration.totals[0].registrations,2); assert.equal(registration.rows.length,31);
    assert.equal(registration.previousStart,'2025-12-01'); assert.equal(registration.previousTotals[0].registrations,1);
    const events = await service.report('event-creation',query,admin); assert.equal(events.totals[0].events,3);
    const adoption = await service.report('organizer-adoption',query,admin);
    assert.equal(adoption.totals[0].registered,1); assert.equal(adoption.totals[0].active,2); assert.equal(adoption.totals[0].published,1);
    const sales = await service.report('ticket-sales',query,admin);
    assert.equal(sales.totals[0].tickets,7); assert.equal(sales.totals[0].freeTickets,1); assert.equal(sales.totals[0].orders,2);
    const revenue = await service.report('revenue',query,admin);
    assert.equal(revenue.totals.length,2);
    const usd = revenue.totals.find(r=>r.currency==='USD');
    assert.equal(usd.grossSales,100); assert.equal(usd.refunds,55); assert.equal(usd.estimatedNetRevenue,5);
    const owner = {id:id(1),role:'user'};
    assert.equal((await service.report('ticket-sales',{...query,organizationId:id(10)},owner)).totals[0].tickets,3);
    assert.equal((await service.report('event-creation',{...query,organizationId:id(10)}, {id:id(3),role:'org_staff'})).totals[0].events,2);
    await assert.rejects(()=>service.report('event-creation',{...query,organizationId:id(10)}, {id:id(4),role:'org_staff'}),/cannot access/);
    await assert.rejects(()=>service.report('registrations',query,owner),/administrator-only/);
    await assert.rejects(()=>service.report('registrations',{...query,eventId:id(20)},admin),/no event/);
    await assert.rejects(()=>service.report('ticket-sales',query,owner),/Select an organization/);
    await assert.rejects(()=>service.report('ticket-sales',{...query,organizationId:id(11)},owner),/cannot access/);
    await assert.rejects(()=>service.report('ticket-sales',{...query,organizationId:id(10),eventId:id(21)},owner),/does not belong/);
    for(const groupBy of ['week','month']) assert.equal((await service.report('ticket-sales',{...query,groupBy},admin)).totals[0].tickets,7);
    const empty = await service.report('event-creation',{start:'2024-01-01',end:'2024-01-02'},admin);
    assert.equal(empty.totals[0].events,0); assert.equal(empty.rows.length,2);
    assert.throws(()=>reportPeriod({...query,start:'2026-02-30'}));
    assert.throws(()=>reportPeriod({...query,end:'2025-01-01'}));
    assert.throws(()=>reportPeriod({...query,end:'2027-02-01'}));
    assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
    assert.match(reportCsv(revenue),/"previous"/); assert.match(reportCsv(revenue),/"USD"/);
    // Export must execute the same authorization before writing any response.
    const controller = new AnalyticsController(service, { record: async()=>({accepted:true}) }, {get: (_key,fallback)=>fallback});
    await assert.rejects(()=>controller.export('revenue',{...query,organizationId:id(11)},{user:owner},{}),/cannot access/);
    assert.deepEqual(await controller.track({},{}),{accepted:false});
    const enabled = new AnalyticsController(service,{record:async()=>({accepted:true})},{get:key=>key==='ANALYTICS_TRACKING_ENABLED'?'true':'https://venuespice.com'});
    await assert.rejects(()=>enabled.track({}, {headers:{origin:'https://evil.example'},socket:{}}),/origin/);
    const request = {headers:{origin:'https://venuespice.com'},ip:'127.0.0.1',socket:{}};
    for(let i=0;i<120;i++) await enabled.track({},request);
    await assert.rejects(()=>enabled.track({},request),/Too many/);
    const forged = Object.assign(new TrackEventDto(),{id:id(50),visitorId:id(51),sessionId:id(52),name:'purchase_completed',page:'home'});
    assert.ok((await validate(forged)).some(error=>error.property==='name'));
    await client.query(`INSERT INTO analytics_events(id,name,visitor_id,session_id,page) VALUES ($1,'page_view',$2,$3,'home') ON CONFLICT DO NOTHING`,[id(50),id(51),id(52)]);
    await client.query(`INSERT INTO analytics_events(id,name,visitor_id,session_id,page) VALUES ($1,'page_view',$2,$3,'home') ON CONFLICT DO NOTHING`,[id(50),id(51),id(52)]);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM analytics_events')).rows[0].count,1);
    const orm = new DataSource({type:'postgres',host:'127.0.0.1',port:Number(process.env.ANALYTICS_TEST_PORT || 55439),username:'analytics_test',database:'postgres',schema,entities:[AnalyticsEventEntity],extra:{options:`-c search_path=${schema}`}});
    await orm.initialize();
    try {
      const tracking = new TrackingService(orm);
      const dto = {id:id(60),visitorId:id(51),sessionId:id(52),name:'engagement',page:'event_detail',eventId:id(20),engagedSeconds:30};
      await tracking.record(dto); await tracking.record(dto);
      assert.equal((await client.query('SELECT count(*)::int AS count FROM analytics_events')).rows[0].count,2);
      await assert.rejects(()=>tracking.record({...dto,id:id(61),eventId:id(99)}),/Unknown event/);
      await client.query("UPDATE analytics_events SET received_at=NOW()-INTERVAL '91 days' WHERE id=$1",[id(60)]);
      await tracking.prune();
      assert.equal((await client.query('SELECT count(*)::int AS count FROM analytics_events')).rows[0].count,1);
    } finally { await orm.destroy(); }
    console.log('Analytics integration checks passed: five reports, boundaries, zero buckets, comparisons, currency isolation, refunds, membership/exports, migration reruns, tracking validation, deduplication, and rate limits.');
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
