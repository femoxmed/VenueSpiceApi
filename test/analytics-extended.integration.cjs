const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');
const {DataSource,getMetadataArgsStorage}=require('typeorm');
const {AnalyticsService}=require('../dist/analytics/analytics.service');
const {AnalyticsController}=require('../dist/analytics/analytics.controller');
const {TrackingService}=require('../dist/analytics/tracking.service');
const {reportXlsx}=require('../dist/analytics/report-xlsx');
const {reportCsv,REPORTS}=require('../dist/analytics/report-utils');
const {Workbook}=require('exceljs');
const {verifyStripeWebhook}=require('../dist/ticket-orders/stripe-webhook-signature');
const {createHmac}=require('node:crypto');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function load(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())load(f);else if(f.endsWith('.entity.js'))require(f);}}
async function main(){
 const port=Number(process.env.ANALYTICS_TEST_PORT||55439),client=new Client({host:'127.0.0.1',port,user:'analytics_test',database:'postgres'});await client.connect();
 const schema=`extended_${Date.now()}`;await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
 load(path.join(__dirname,'../dist'));let db;
 try{
 db=new DataSource({type:'postgres',host:'127.0.0.1',port,username:'analytics_test',database:'postgres',schema,synchronize:true,entities:[...new Set(getMetadataArgsStorage().tables.map(t=>t.target))],extra:{options:`-c search_path=${schema},public`}});await db.initialize();
 const sql=(q,args)=>client.query(q,args);
 for(const n of [1,2,3])await sql(`INSERT INTO users(id,full_name,email,password_hash,created_at) VALUES($1,'Buyer',$2,'unused','2025-01-01')`,[id(n),`buyer${n}@example.invalid`]);
 for(const n of [10,11])await sql(`INSERT INTO organizations(id,name,slug,owner_user_id,country,state_province,created_at) VALUES($1,$2,$2,$3,'NG','Lagos','2026-01-01')`,[id(n),`org${n}`,id(n===10?1:2)]);
 for(const [n,org,status,created] of [[20,10,'published','2026-01-01'],[21,11,'draft','2026-01-02'],[22,10,'published','2026-01-03']])await sql(`INSERT INTO events(id,"organizationId",title,slug,status,starts_at,country,state,city,created_at) VALUES($1,$2,$3,$3,$4,'2026-01-05T00:00:00Z','NG','Lagos','Ikeja',$5)`,[id(n),id(org),n===20?'=HYPERLINK("bad")':`event${n}`,status,created]);
 await sql(`INSERT INTO agents(id,"organizationId",full_name,email) VALUES($1,$2,'Promoter','promoter@example.invalid')`,[id(40),id(10)]);
 await sql(`INSERT INTO referral_codes(id,"agentId","eventId",code) VALUES($1,$2,$3,'PROMO')`,[id(41),id(40),id(20)]);
 for(const [n,org,event,email,paid,currency] of [[30,10,20,1,'2026-01-10','USD'],[31,11,21,2,'2026-01-11','NGN'],[32,10,20,1,'2025-12-15','USD'],[33,10,22,3,'2025-01-01','USD']]){
 await sql(`INSERT INTO ticket_orders(id,"organizationId","eventId",customer_name,customer_email,status,subtotal,total,tax,paid_at,currency,fee_snapshot,buyer_billing_address_snapshot,"referralCodeId",analytics_visitor_id,analytics_session_id,stripe_payment_intent_id) VALUES($1,$2,$3,'Buyer',$4,'paid',100,110,7,$5,$6,'{"influencerCommission":5}','{"country":"US","state":"CA","city":"Oakland"}',$7,$8,$9,$10)`,[id(n),id(org),id(event),`buyer${email}@example.invalid`,paid+'T00:00:00Z',currency,n===30?id(41):null,id(50),id(51),`pi_${n}`]);
 }
 // Need a real ticket type for the synchronized FK schema.
 await sql(`INSERT INTO ticket_types(id,"eventId",name,price,quantity) VALUES($1,$2,'General',50,100)`,[id(60),id(20)]);
 await sql(`INSERT INTO ticket_order_items(id,"orderId","ticketTypeId",quantity,unit_price,line_total,ticket_name) VALUES($1,$2,$3,2,50,100,'General')`,[id(61),id(30),id(60)]);
 await sql(`INSERT INTO financial_ledger_entries(id,idempotency_key,"organizationId","eventId","orderId",type,status,amount,currency) VALUES($1,'ledger-test',$2,$3,$4,'organizer_net','available',80,'USD')`,[id(70),id(10),id(20),id(30)]);
 await sql(`INSERT INTO payment_intents(id,idempotency_key,provider_reference,status,provider_status,amount,currency,customer_email,updated_at) VALUES($1,$2,'pi_failed','failed','payment_failed',110,'USD','buyer1@example.invalid','2026-01-09')`,[id(71),`ticket-order:${id(30)}`]);
 await sql(`INSERT INTO analytics_disputes VALUES('dp_test','pi_30',5000,'USD','2026-01-12T00:00:00Z')`);
 await sql(`INSERT INTO analytics_events(id,name,visitor_id,session_id,event_id,page,source,country,state,city,received_at) VALUES($1,'page_view',$2,$3,$4,'event_detail','google','NG','Lagos','Ikeja','2026-01-09T23:30:00Z'),($5,'page_view',$2,$3,$4,'event_detail','google','NG','Lagos','Ikeja','2026-01-09T23:40:00Z')`,[id(80),id(50),id(51),id(20),id(81)]);
 await sql(`INSERT INTO analytics_events(id,name,visitor_id,session_id,event_id,page,referral_code_id,received_at) VALUES($1,'referral_click',$2,$3,$4,'event_detail',$5,'2026-01-09T00:00:00Z'),($6,'referral_click',$2,$3,$4,'event_detail',$5,'2026-01-09T00:00:00Z')`,[id(82),id(50),id(51),id(20),id(41),id(83)]);
 const service=new AnalyticsService(db),admin={id:id(1),role:'admin'},owner={id:id(1),role:'user'},query={start:'2026-01-01',end:'2026-01-31',groupBy:'day',organizationId:id(10)};
 assert.equal(REPORTS.length,15);
 const reports={};for(const report of REPORTS){reports[report]=await service.report(report,report==='registrations'?{...query,organizationId:undefined}:query,admin);assert.ok(reports[report].columns.length);if(report!=='registrations'){
 await assert.rejects(()=>service.report(report,{...query,organizationId:id(11)},owner),/cannot access/);
 await assert.rejects(()=>service.report(report,{...query,eventId:id(21)},owner),/does not belong/);
 assert.deepEqual((await service.report(report,query,owner)).totals,reports[report].totals);
 }}
 assert.equal(reports['traffic-source'].totals[0].visitors,1);assert.equal(reports['traffic-source'].breakdown[0].source,'google');
 assert.equal(reports['event-status'].totals[0].published,2);assert.equal(reports['event-status'].totals[0].completed,2);
 const performance=reports['event-performance'];assert.equal(performance.totals[0].views,2);assert.equal(performance.totals[0].orders,1);assert.equal(performance.totals[0].tickets,2);assert.equal(performance.totals[0].conversionRate,100);assert.equal(performance.breakdown[0].eventId,id(20));
 const payment=reports['payment-refund'].totals[0];assert.equal(payment.failed,1);assert.equal(payment.successful,1);assert.equal(payment.chargebacks,1);assert.equal(payment.chargebackAmount,5000);assert.equal(payment.outstanding,80);
 const promoter=reports['promoter-referral'];assert.equal(promoter.totals.find(r=>r.currency==='').clicks,1);assert.equal(promoter.totals.find(r=>r.currency==='USD').commissions,5);assert.equal(promoter.breakdown.find(r=>r.currency==='USD').promoter,'Promoter');
 const geo=reports.geographic;assert.equal(geo.totals[0].purchases,1);assert.equal(geo.breakdown.find(r=>r.country==='US').purchases,1);assert.equal(geo.totals[0].organizers,1);assert.equal(geo.totals[0].visitors,1);
 const retention=reports['user-retention'].totals[0];assert.equal(retention.buyers,1);assert.equal(retention.returningBuyers,1);assert.equal(retention.repeatPurchases,1);assert.equal(retention.repeatOrganizers,1);assert.equal(retention.inactiveAccounts,1);
 assert.match(reportCsv(performance),/"breakdown"/);assert.match(reportCsv(performance),/"'=HYPERLINK/);
 const workbook=new Workbook();await workbook.xlsx.load(await reportXlsx(performance));const cells=[];workbook.getWorksheet('Analytics').eachRow(row=>row.eachCell(c=>cells.push(c)));assert.ok(cells.some(c=>c.value===100));assert.ok(cells.some(c=>c.value==='=HYPERLINK("bad")' && c.type===3));assert.ok(!cells.some(c=>c.formula));
 const controller=new AnalyticsController(service,new TrackingService(db),{get:(_k,f)=>f});for(const format of ['csv','xlsx'])await assert.rejects(()=>controller.export('geographic',{...query,organizationId:id(11),format},{user:owner},{}),/cannot access/);
 const tracker=new TrackingService(db);const dto={id:id(90),name:'referral_click',visitorId:id(50),sessionId:id(51),eventId:id(20),page:'event_detail',referralCode:'PROMO'};assert.equal((await tracker.record(dto)).accepted,true);assert.equal((await tracker.record({...dto,id:id(91),eventId:id(21)})).accepted,false);
 await db.synchronize();assert.equal((await sql('SELECT COUNT(*)::int AS n FROM analytics_disputes')).rows[0].n,1);
 const body=Buffer.from('{"type":"test"}'),now=Date.now(),timestamp=Math.floor(now/1000);const signature=createHmac('sha256','secret').update(`${timestamp}.`).update(body).digest('hex');verifyStripeWebhook(body,`t=${timestamp},v1=${signature}`,'secret',now);assert.throws(()=>verifyStripeWebhook(Buffer.from('{}'),`t=${timestamp},v1=${signature}`,'secret',now));assert.throws(()=>verifyStripeWebhook(body,`t=${timestamp},v1=${signature}`,'secret',now+301000));assert.throws(()=>verifyStripeWebhook(body,undefined,'secret'));assert.throws(()=>verifyStripeWebhook(body,`t=${timestamp},v1=${signature}`,undefined));

 // New report grouping must not change period totals; both periods export with tenant scope.
 for(const name of ['traffic-source','event-status','event-performance','payment-refund','promoter-referral','geographic','user-retention']) {
   for(const groupBy of ['week','month']) assert.deepEqual((await service.report(name,{...query,groupBy},owner)).totals,reports[name].totals);
   const empty=await service.report(name,{...query,start:'2024-01-01',end:'2024-01-02'},owner);
   assert.ok(empty.totals.every(r=>Object.entries(r).filter(([k])=>empty.columns.some(c=>c.key===k)).every(([,v])=>v===0||v===null)));
 }
 const headers={},response={setHeader:(k,v)=>headers[k]=v,send:b=>b};
 const exported=await controller.export('event-performance',{...query,format:'xlsx'},{user:owner},response);
 assert.match(headers['Content-Type'],/spreadsheetml/);assert.match(headers['Content-Disposition'],/xlsx/);assert.ok(Buffer.isBuffer(exported));
 // Coupon landings are attributed even before checkout creates a referral-code record.
 await sql(`INSERT INTO discount_coupons(id,"organizationId","eventId","agentId",code,value,status) VALUES($1,$2,$3,$4,'COUPON',10,'active')`,[id(92),id(10),id(20),id(40)]);
 assert.equal((await tracker.record({...dto,id:id(93),referralCode:'COUPON'},{country:'NG',state:'Lagos',city:'Ikeja'})).accepted,true);
 const captured=(await sql('SELECT promoter_id, country FROM analytics_events WHERE id=$1',[id(93)])).rows[0];assert.equal(captured.promoter_id,id(40));assert.equal(captured.country,'NG');
 // Exercise Nest raw-body handling and signed webhook delivery, not only the signature helper.
 const {TicketOrdersService}=require('../dist/ticket-orders/ticket-orders.service');
 const {TicketOrdersController}=require('../dist/ticket-orders/ticket-orders.controller');
 const {TicketOrderEntity}=require('../dist/ticket-orders/entities/ticket-order.entity');
 const {PaymentIntentEntity}=require('../dist/payments/entities/payment-intent.entity');
 const {ConfigService}=require('@nestjs/config');const {Module}=require('@nestjs/common');const {NestFactory}=require('@nestjs/core');
 const handler=Object.create(TicketOrdersService.prototype);handler.ticketOrdersRepository=db.getRepository(TicketOrderEntity);handler.paymentIntentsRepository=db.getRepository(PaymentIntentEntity);
 class WebhookTestModule{};Module({controllers:[TicketOrdersController],providers:[{provide:TicketOrdersService,useValue:handler},{provide:ConfigService,useValue:{get:()=> 'secret'}}]})(WebhookTestModule);
 const app=await NestFactory.create(WebhookTestModule,{rawBody:true,logger:false});
 try{
 await app.listen(0,'127.0.0.1');const url=(await app.getUrl())+'/ticket-orders/stripe/webhook';
 const event={type:'charge.dispute.created',data:{object:{id:'dp_second',payment_intent:'pi_30',amount:700,currency:'usd',created:Math.floor(Date.now()/1000)}}};
 const payload=JSON.stringify(event);const stamp=Math.floor(Date.now()/1000);const digest=createHmac('sha256','secret').update(`${stamp}.${payload}`).digest('hex');
 const send=signature=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(signature?{'Stripe-Signature':signature}:{})},body:payload});
 assert.equal((await send()).status,400);assert.equal((await send(`t=${stamp},v1=${'0'.repeat(64)}`)).status,400);
 assert.equal((await send(`t=${stamp},v1=${digest}`)).status,201);assert.equal((await send(`t=${stamp},v1=${digest}`)).status,201);
 assert.equal((await sql("SELECT COUNT(*)::int AS n FROM analytics_disputes WHERE id='dp_second'")).rows[0].n,1);
 await sql("UPDATE payment_intents SET status='succeeded' WHERE id=$1",[id(71)]);
 await handler.handleStripeWebhook({type:'payment_intent.payment_failed',data:{object:{metadata:{ticketOrderId:id(30)}}}});
 assert.equal((await sql('SELECT status FROM payment_intents WHERE id=$1',[id(71)])).rows[0].status,'succeeded');
 await sql("UPDATE payment_intents SET status='pending' WHERE id=$1",[id(71)]);
 await handler.handleStripeWebhook({type:'checkout.session.expired',data:{object:{metadata:{ticketOrderId:id(30)}}}});
 assert.equal((await sql('SELECT provider_status FROM payment_intents WHERE id=$1',[id(71)])).rows[0].provider_status,'expired');
 let finalized=false;handler.markCheckoutSessionPaid=async()=>{finalized=true;return {received:true}};
 await handler.handleStripeWebhook({type:'checkout.session.completed',data:{object:{payment_status:'unpaid'}}});assert.equal(finalized,false);
 await handler.handleStripeWebhook({type:'checkout.session.async_payment_succeeded',data:{object:{payment_status:'paid'}}});assert.equal(finalized,true);
 }finally{await app.close();}
 console.log('All 15 reports, tenant isolation, distinct breakdowns, sales attribution, geography, retention, ledger payouts, typed Excel/formula safety, referral validation, dispute persistence and webhook signature tests passed.');
 }finally{if(db?.isInitialized)await db.destroy();await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
