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
      CREATE TABLE ticket_orders(id uuid, "organizationId" uuid, "eventId" uuid, paid_at timestamptz, status text, currency text, subtotal numeric, total numeric, platform_fee numeric, processing_fee numeric, fee_snapshot jsonb, tax numeric NOT NULL DEFAULT 0);
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
    await client.query("UPDATE ticket_orders SET tax = CASE WHEN currency = 'NGN' THEN 19 ELSE 7 END");
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
    assert.equal(usd.taxCollected,7); assert.equal(revenue.totals.find(r=>r.currency==='NGN').taxCollected,19); assert.equal(revenue.previousTotals.find(r=>r.currency==='USD').taxCollected,7);
    assert.match(reportCsv(revenue), /Tax collected/);
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

    // Tracking fixtures: duplicate signals, multiple sessions, cross-org isolation and confirmed outcomes.
    await client.query('TRUNCATE analytics_events');
    let trackingId=100;
    const record=async (visitor,session,event,name,at,seconds=0)=>client.query(
      `INSERT INTO analytics_events(id,visitor_id,session_id,event_id,name,page,received_at,engaged_seconds)
       VALUES ($1,$2,$3,$4,$5,'event_detail',$6,$7)`,[id(trackingId++),id(visitor),id(session),event===null?null:id(event),name,at,seconds]);
    await record(70,80,20,'page_view','2025-12-30T12:00:00Z');
    await record(70,81,20,'page_view','2026-01-01T10:00:00Z');
    await record(70,81,20,'page_view','2026-01-01T10:01:00Z');
    await record(70,81,20,'engagement','2026-01-01T10:02:00Z',30);
    await record(70,81,20,'ticket_selected','2026-01-01T10:03:00Z');
    await record(70,81,20,'ticket_selected','2026-01-01T10:04:00Z');
    await record(70,81,20,'checkout_started','2026-01-01T10:05:00Z');
    await record(70,81,20,'checkout_started','2026-01-01T10:06:00Z');
    await record(70,82,20,'page_view','2026-01-02T10:00:00Z');
    await record(70,82,20,'engagement','2026-01-02T10:01:00Z',60);
    await record(71,83,20,'page_view','2026-01-02T11:00:00Z');
    await record(71,83,20,'checkout_started','2026-01-02T11:01:00Z');
    await record(72,84,21,'page_view','2026-01-02T12:00:00Z');
    await record(73,85,null,'page_view','2026-01-02T12:00:00Z');
    // An org-B visit must not make this person a returning visitor within org A.
    await record(71,86,21,'page_view','2025-12-20T12:00:00Z');
    await client.query(`UPDATE ticket_orders SET analytics_session_id=$1,analytics_visitor_id=$2,paid_at='2026-01-01T10:07:00Z' WHERE id=$3`,[id(81),id(70),id(30)]);
    // A repeated paid order in the same journey must not inflate conversion.
    await client.query(`UPDATE ticket_orders SET analytics_session_id=$1,analytics_visitor_id=$2,paid_at='2026-01-01T10:08:00Z',status='paid' WHERE id=$3`,[id(81),id(70),id(33)]);
    const tracked={...query,organizationId:id(10)};
    const traffic=await service.report('website-traffic',tracked,owner);
    assert.equal(traffic.totals[0].visitors,2);assert.equal(traffic.totals[0].sessions,3);assert.equal(traffic.totals[0].pageViews,4);
    assert.equal(traffic.totals[0].pagesPerSession,1.33);assert.equal(traffic.previousTotals[0].pageViews,1);
    assert.equal(new Date(traffic.coverage.firstObservedAt).toISOString(),'2025-12-30T12:00:00.000Z');
    assert.equal((await service.report('website-traffic',query,admin)).totals[0].visitors,4);
    const engagement=await service.report('user-engagement',tracked,owner);
    assert.equal(engagement.totals[0].activeVisitors,2);assert.equal(engagement.totals[0].returningVisitors,1);
    assert.equal(engagement.totals[0].returningRate,50);assert.equal(engagement.totals[0].engagedSeconds,90);
    assert.equal(engagement.totals[0].avgEngagementSeconds,30);assert.equal(engagement.totals[0].engagedVisitors,1);
    assert.equal((await service.report('user-engagement',query,admin)).totals[0].returningVisitors,2);
    const funnel=await service.report('checkout-conversion',tracked,owner);
    assert.equal(funnel.totals[0].journeys,3);assert.equal(funnel.totals[0].selected,1);assert.equal(funnel.totals[0].started,2);
    assert.equal(funnel.totals[0].completed,1);assert.equal(funnel.totals[0].pending,0);assert.equal(funnel.totals[0].abandoned,1);assert.equal(funnel.totals[0].conversionRate,50);
    for(const report of ['website-traffic','user-engagement','checkout-conversion']) {
      await assert.rejects(()=>service.report(report,query,owner),/Select an organization/);
      await assert.rejects(()=>service.report(report,{...query,organizationId:id(11)},owner),/cannot access/);
      await assert.rejects(()=>controller.export(report,{...query,organizationId:id(11)},{user:owner},{}),/cannot access/);
      const grouped=await service.report(report,{...tracked,groupBy:'month'},owner);
      assert.deepEqual(grouped.totals,funnel.report===report?funnel.totals:report==='website-traffic'?traffic.totals:engagement.totals);
      const blank=await service.report(report,{...tracked,start:'2024-01-01',end:'2024-01-02'},owner);
      assert.equal(blank.rows.length,2);
      assert.equal(blank.totals[0][report==='website-traffic'?'pagesPerSession':report==='user-engagement'?'returningRate':'conversionRate'],null);
    }
    assert.match(reportCsv(engagement),/Average engaged time per active session \(seconds\)/);
    assert.match(reportCsv(funnel),/Checkout conversion rate \(%\)/);
    // A second event with the same browser session is a separate journey and cannot inherit a payment.
    await record(70,81,22,'checkout_started','2026-01-01T10:05:00Z');
    assert.equal((await service.report('checkout-conversion',{...tracked,eventId:id(22)},owner)).totals[0].completed,0);
    // Cohort belongs to the first activity date even when payment crosses a reporting boundary.
    await record(74,87,20,'page_view','2026-01-31T23:58:00Z');
    await record(74,87,20,'checkout_started','2026-01-31T23:59:00Z');
    await client.query(`INSERT INTO ticket_orders(id,"organizationId","eventId",paid_at,status,currency,subtotal,total,platform_fee,processing_fee,fee_snapshot,tax,analytics_session_id,analytics_visitor_id)
      VALUES ($1,$2,$3,'2026-02-01T00:01:00Z','paid','USD',0,0,0,0,'{}',0,$4,$5)`,[id(34),id(10),id(20),id(87),id(74)]);
    assert.equal((await service.report('checkout-conversion',{...tracked,start:'2026-01-31',end:'2026-01-31'},owner)).totals[0].completed,1);
    assert.equal((await service.report('checkout-conversion',{...tracked,start:'2026-02-01',end:'2026-02-01'},owner)).totals[0].journeys,0);
    // Late payments remain outside the explicit 24-hour completion window.
    await client.query("UPDATE ticket_orders SET paid_at='2026-02-02T00:00:00Z' WHERE id=$1",[id(34)]);
    assert.equal((await service.report('checkout-conversion',{...tracked,start:'2026-01-31',end:'2026-01-31'},owner)).totals[0].abandoned,1);
    const now=new Date();const today=now.toISOString().slice(0,10);
    await record(75,88,20,'checkout_started',now.toISOString());
    const ongoing=await service.report('checkout-conversion',{...tracked,start:today,end:today},owner);
    assert.equal(ongoing.totals[0].pending,1);assert.equal(ongoing.totals[0].abandoned,0);
    console.log('Analytics integration checks passed: eight reports, tax, tracking cohorts, weighted rates, privacy scopes, boundaries, zero buckets, comparisons, currency isolation, refunds, membership/exports, migration reruns, tracking validation, deduplication, and rate limits.');
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
