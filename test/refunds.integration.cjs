// Synthetic PostgreSQL fixtures and mocked Stripe responses; never uses production secrets.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DataSource,getMetadataArgsStorage}=require('typeorm');
const {Client}=require('pg');
const {RefundsService}=require('../dist/refunds/refunds.service');
function entity(file,name){return require('../dist/'+file)[name];}
const Refund=entity('refunds/entities/refund-request.entity','RefundRequestEntity');
const Order=entity('ticket-orders/entities/ticket-order.entity','TicketOrderEntity');
const Ticket=entity('ticket-orders/entities/issued-ticket.entity','IssuedTicketEntity');
const Type=entity('events/entities/ticket-type.entity','TicketTypeEntity');
const User=entity('auth/entities/user.entity','UserEntity');
const Invoice=entity('invoices/entities/invoice.entity','InvoiceEntity');
const Payment=entity('payments/entities/payment-intent.entity','PaymentIntentEntity');
const Org=entity('organizations/entities/organization.entity','OrganizationEntity');
const Event=entity('events/entities/event.entity','EventEntity');
const Item=entity('ticket-orders/entities/ticket-order-item.entity','TicketOrderItemEntity');
function load(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())load(p);else if(p.endsWith('.entity.js'))require(p);}}
(async()=>{
 const port=Number(process.env.ANALYTICS_TEST_PORT||55439),schema=`refund_${Date.now()}`;
 const client=new Client({host:'127.0.0.1',port,user:'analytics_test',database:'postgres'});await client.connect();await client.query(`CREATE SCHEMA ${schema}`);await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
 load(path.join(__dirname,'../dist'));
 const db=new DataSource({type:'postgres',host:'127.0.0.1',port,username:'analytics_test',database:'postgres',schema,synchronize:true,entities:[...new Set(getMetadataArgsStorage().tables.map(t=>t.target))],extra:{options:`-c search_path=${schema},public`}});
 const originalFetch=global.fetch;
 try {
  await db.initialize();let secret='sk_test_synthetic';
  const service=new RefundsService(...[Refund,Order,Ticket,Type,User,Invoice,Payment].map(e=>db.getRepository(e)),{get:()=>secret},{log:async()=>{}},{});
  const notifications=[];service.notifyOrganizer=async(r,state)=>notifications.push([r.id,state]);
  const actor=await db.getRepository(User).save({email:'refund-admin@example.invalid',fullName:'Test',passwordHash:'unused',role:'super_admin'});
  const org=await db.getRepository(Org).save({name:'Refund test',slug:'refund-test',ownerUserId:actor.id});
  const event=await db.getRepository(Event).save({title:'Refund test',slug:'refund-test',organization:org,status:'published',startsAt:new Date('2099-01-01'),refundsAllowed:true});
  let count=0,calls=[];
  async function fixture(){
   const order=await db.getRepository(Order).save({event,organization:org,customerName:'Buyer',customerEmail:'buyer@example.invalid',total:50,subtotal:50,currency:'USD',status:'paid',stripePaymentIntentId:'pi_test'+(++count)});
   const type=await db.getRepository(Type).save({event,name:'General',price:50,quantity:10,quantitySold:1});
   await db.getRepository(Item).save({order,ticketType:type,ticketName:"General",quantity:1,unitPrice:50,lineTotal:50});
   const ticket=await db.getRepository(Ticket).save({order,event,ticketType:type,code:'ticket'+count,holderName:'Buyer',holderEmail:order.customerEmail});
   const refund=await db.getRepository(Refund).save({order,orderId:order.id,customerEmail:order.customerEmail,amount:50,currency:'USD',status:'requested'});
   return {order,type,ticket,refund};
  }
  function mock(f,status='succeeded',http=200){global.fetch=async(url,options)=>{calls.push({url,options});return {ok:http<400,status:http,json:async()=>http>=400?{error:{message:'Synthetic provider error'}}:{id:'re_'+f.refund.id,payment_intent:f.order.stripePaymentIntentId,amount:5000,currency:'usd',status}};};}
  async function untouched(f){assert.equal((await db.getRepository(Order).findOneBy({id:f.order.id})).status,'paid');assert.equal((await db.getRepository(Ticket).findOneBy({id:f.ticket.id})).status,'valid');assert.equal((await db.getRepository(Type).findOneBy({id:f.type.id})).quantitySold,1);}
  for(const invalid of [null,'txn_fake','not_a_payment']){const f=await fixture();await db.getRepository(Order).update(f.order.id,{stripePaymentIntentId:invalid});const n=calls.length;await assert.rejects(()=>service.approve(f.refund.id,{},actor),/valid Stripe/);assert.equal(calls.length,n);await untouched(f);}
  {const f=await fixture();secret='';await assert.rejects(()=>service.approve(f.refund.id,{},actor),/not configured/);secret='sk_test_synthetic';assert.equal((await db.getRepository(Refund).findOneBy({id:f.refund.id})).status,'requested');await untouched(f);}
  for(const status of ['pending','requires_action','failed','canceled',undefined]){const f=await fixture();mock(f,status===undefined?'unknown':status);const r=await service.approve(f.refund.id,{},actor);assert.equal(r.status,['failed','canceled'].includes(status)?'failed':'processing');assert.equal(r.completedAt,null);await untouched(f);assert.ok(!notifications.some(([id])=>id===r.id));}
  // Clear other processing fixtures to isolate the scheduled reconciliation test.
  await db.getRepository(Refund).update({status:'processing'},{status:'failed'});
  {const f=await fixture();mock(f,'pending');await service.approve(f.refund.id,{},actor);mock(f,'succeeded');await service.reconcileProcessingRefunds();assert.equal((await db.getRepository(Order).findOneBy({id:f.order.id})).status,'refunded');assert.equal((await db.getRepository(Ticket).findOneBy({id:f.ticket.id})).status,'refunded');assert.equal((await db.getRepository(Type).findOneBy({id:f.type.id})).quantitySold,0);await service.reconcileProcessingRefunds();assert.equal(notifications.filter(([id])=>id===f.refund.id).length,1);}
  {const f=await fixture();mock(f);const results=await Promise.allSettled([service.approve(f.refund.id,{},actor),service.approve(f.refund.id,{},actor)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls.filter(c=>c.options.headers['Idempotency-Key']==='venuespice-refund:'+f.refund.id).length,1);}
  {const f=await fixture();mock(f,'failed',400);await assert.rejects(()=>service.approve(f.refund.id,{},actor),/Synthetic/);assert.equal((await db.getRepository(Refund).findOneBy({id:f.refund.id})).status,'failed');await untouched(f);}
  {const f=await fixture();global.fetch=async(url,options)=>{calls.push({url,options});throw new Error('timeout');};await assert.rejects(()=>service.approve(f.refund.id,{},actor),/timeout/);assert.equal((await db.getRepository(Refund).findOneBy({id:f.refund.id})).status,'processing');await untouched(f);mock(f);await service.reconcileProcessingRefunds();const attempts=calls.filter(c=>c.options.headers['Idempotency-Key']==='venuespice-refund:'+f.refund.id);assert.equal(attempts.length,2);assert.equal(attempts[0].options.body.toString(),attempts[1].options.body.toString());assert.equal((await db.getRepository(Refund).findOneBy({id:f.refund.id})).status,'succeeded');}
  {const f=await fixture();mock(f,'pending');await service.approve(f.refund.id,{},actor);mock(f,'failed');await service.reconcileProcessingRefunds();assert.equal((await db.getRepository(Refund).findOneBy({id:f.refund.id})).status,'failed');await untouched(f);}
  {const f=await fixture();mock(f,'pending',500);await assert.rejects(()=>service.approve(f.refund.id,{},actor),/Synthetic/);await untouched(f);assert.equal((await db.getRepository(Refund).findOneBy({id:f.refund.id})).status,'processing');mock(f,'failed',401);await service.reconcileProcessingRefunds();assert.equal((await db.getRepository(Refund).findOneBy({id:f.refund.id})).status,'processing');mock(f);await service.reconcileProcessingRefunds();assert.equal((await db.getRepository(Refund).findOneBy({id:f.refund.id})).status,'succeeded');}
  {const f=await fixture();await db.getRepository(Refund).update(f.refund.id,{status:'processing',reviewedAt:new Date(Date.now()-24*3600000)});const n=calls.length;await service.reconcileProcessingRefunds();assert.equal(calls.length,n);await untouched(f);}
  console.log('Refund integration passed: invalid configuration/references, pending/action/failure states, confirmed completion, duplicate approvals, idempotent timeout recovery, and expired retry protection.');
 } finally {global.fetch=originalFetch;if(db.isInitialized)await db.destroy();await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
