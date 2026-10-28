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
  // Admin preview and direct issuance: no buyer request, no writes during preview.
  async function adminFixture() {const f=await fixture();await db.getRepository(Refund).delete(f.refund.id);return f;}
  function adminProvider(f,options={}) {
   global.fetch=async(url,init)=>{
    calls.push({url,options:init});
    if(init.method==='GET') return {ok:true,status:200,json:async()=>url.includes('payment_intents/')?{id:f.order.stripePaymentIntentId,status:'succeeded',currency:'usd',amount_received:5000,latest_charge:{disputed:!!options.disputed,amount_refunded:0}}:{data:options.existing?[{id:'re_existing',status:'pending'}]:[],has_more:false}};
    const body=init.body;return {ok:true,status:200,json:async()=>({id:'re_admin'+count,status:'pending',amount:5000,currency:'usd',payment_intent:f.order.stripePaymentIntentId,metadata:{refundRequestId:body.get('metadata[refundRequestId]')}})};
   };
  }
  {
   const f=await adminFixture();adminProvider(f);
   const before=await db.getRepository(Refund).count();
   const preview=await service.adminPreview(f.order.id,actor);assert.equal(preview.refundAmount,50);assert.equal(await db.getRepository(Refund).count(),before);await untouched(f);
   await assert.rejects(()=>service.adminPreview(f.order.id,{role:'org_admin'}),/administrator/);
   await assert.rejects(()=>service.adminIssue({orderId:f.order.id,reason:'Admin test',cancellationReason:'voluntary',expectedAmount:49,confirmed:true},actor),/amount changed/);
   await assert.rejects(()=>service.adminIssue({orderId:f.order.id,reason:'Admin test',cancellationReason:'voluntary',expectedAmount:50,confirmed:false},actor),/Confirmation/);
   const results=await Promise.allSettled([1,2].map(()=>service.adminIssue({orderId:f.order.id,reason:'Admin test',cancellationReason:'voluntary',expectedAmount:50,confirmed:true},actor)));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const created=results.find(r=>r.status==='fulfilled').value;
   assert.equal(created.status,'processing');assert.equal(created.reviewedById,actor.id);assert.match(created.reason,/Admin-initiated/);await untouched(f);
   await assert.rejects(()=>service.createRequest({orderId:f.order.id,customerEmail:f.order.customerEmail}),/already exists/);
   await assert.rejects(()=>service.adminIssue({orderId:f.order.id,reason:'Admin test',cancellationReason:'voluntary',expectedAmount:50,confirmed:true},actor),/exists/);
  }
  for(const flags of [{existing:true},{disputed:true}]) {const f=await adminFixture();adminProvider(f,flags);const n=await db.getRepository(Refund).count();await assert.rejects(()=>service.adminPreview(f.order.id,actor));assert.equal(await db.getRepository(Refund).count(),n);await untouched(f);}
  {const f=await adminFixture();await db.getRepository(Order).update(f.order.id,{subtotal:40,tax:5});await db.getRepository(Event).update(event.id,{refundablePercentage:50});adminProvider(f);
   const preview=await service.adminPreview(f.order.id,actor);assert.equal(preview.refundAmount,25);assert.equal(preview.taxPortion,2.5);assert.equal(preview.buyerFees,5);assert.equal(preview.allTicketsInvalidated,true);await untouched(f);
   await db.getRepository(Event).update(event.id,{refundablePercentage:100});}
  // Policy is purchase-versioned, excludes organizer-paid fees, and full cancellations bypass voluntary restrictions.
  const {refundBreakdown}=require('../dist/refunds/refund-policy');
  const policyOrder={total:60,subtotal:50,tax:5,processingFee:9,feePayer:'mixed',feeSnapshot:{refundPolicyVersion:'processing-retained-v1',buyerProcessingFee:2},event:{refundablePercentage:100}};
  assert.equal(refundBreakdown(policyOrder).refundAmount,58);
  assert.equal(refundBreakdown(policyOrder).retainedProcessingFee,2);
  policyOrder.event.refundablePercentage=50;
  const half=refundBreakdown(policyOrder);assert.equal(half.refundAmount,29);assert.equal(half.taxPortion,2.5);assert.equal(half.refundedSubtotal+half.taxPortion+half.refundedFees,half.refundAmount);
  for(const reason of ['organizer_cancellation','platform_error']) {const full=refundBreakdown(policyOrder,reason);assert.equal(full.refundAmount,60);assert.equal(full.retainedProcessingFee,0);assert.equal(full.taxPortion,5);}
  assert.equal(refundBreakdown({...policyOrder,feeSnapshot:{buyerProcessingFee:2}}).refundAmount,30);
  assert.equal(refundBreakdown({...policyOrder,total:55,feePayer:'organizer',feeSnapshot:{refundPolicyVersion:'processing-retained-v1'}}).retainedProcessingFee,0);
  assert.throws(()=>refundBreakdown({...policyOrder,feeSnapshot:{refundPolicyVersion:'processing-retained-v1'}}),/reconciliation/);
  assert.throws(()=>refundBreakdown(policyOrder,'invalid'),/valid cancellation/);
  const tiny=refundBreakdown({...policyOrder,total:0.02,subtotal:0.01,tax:0.01,feeSnapshot:{refundPolicyVersion:'processing-retained-v1',buyerProcessingFee:0}});assert.equal(tiny.refundedSubtotal+tiny.taxPortion+tiny.refundedFees,tiny.refundAmount);assert.ok(tiny.refundedFees>=0);
  for(const cancellationReason of ['organizer_cancellation','platform_error']) {
   const f=await adminFixture();await db.getRepository(Event).update(event.id,{refundablePercentage:0,refundsAllowed:false,startsAt:new Date('2020-01-01')});
   await db.getRepository(Order).update(f.order.id,{subtotal:40,tax:5,feeSnapshot:{refundPolicyVersion:'processing-retained-v1',buyerProcessingFee:2}});adminProvider(f);
   await assert.rejects(()=>service.adminPreview(f.order.id,actor,'voluntary'),/does not allow/);
   const preview=await service.adminPreview(f.order.id,actor,cancellationReason);assert.equal(preview.refundAmount,50);assert.equal(preview.retainedProcessingFee,0);
   await assert.rejects(()=>service.adminIssue({orderId:f.order.id,reason:'Event cancelled',cancellationReason,expectedAmount:50,confirmed:true},{...actor,role:'org_admin'}),/administrator/);
   const issued=await service.adminIssue({orderId:f.order.id,reason:'Event cancelled',cancellationReason,expectedAmount:50,confirmed:true},actor);
   assert.equal(issued.policySnapshot.cancellationReason,cancellationReason);assert.equal(Number(issued.amount),50);assert.equal(issued.status,'processing');
   await db.getRepository(Event).update(event.id,{refundablePercentage:100,refundsAllowed:true,startsAt:new Date('2099-01-01')});
  }
  {const f=await adminFixture();await db.getRepository(Order).update(f.order.id,{subtotal:40,tax:5,feeSnapshot:{refundPolicyVersion:'processing-retained-v1',buyerProcessingFee:2}});
   const requested=await service.createRequest({orderId:f.order.id,customerEmail:f.order.customerEmail,reason:'Changed plans'});assert.equal(requested.amount,48);assert.equal(requested.policySnapshot.retainedProcessingFee,2);
   global.fetch=async(url,init)=>{assert.equal(init.body.get('amount'),'4800');return {ok:true,json:async()=>({id:'re_policy',status:'succeeded',amount:4800,currency:'usd',payment_intent:f.order.stripePaymentIntentId})};};
   const approved=await service.approve(requested.id,{},actor);assert.equal(Number(approved.amount),48);assert.equal(approved.status,'succeeded');assert.equal(approved.policySnapshot.taxPortion,5);
  }
  // Read-only report uses a repository exposing only reads and a GET-only Stripe mock.
  const {RefundReconciliationService}=require('../dist/refunds/refund-reconciliation.service');
  const row={id:'local-request',orderId:'local-order',customerEmail:'report@example.invalid',amount:50,currency:'USD',status:'succeeded',stripeRefundId:'local_refund_fake',order:{stripePaymentIntentId:'pi_report',event:{title:'Test'}}};
  const readOnlyRepo={findAndCount:async()=>[[row],1]};
  const reporting=new RefundReconciliationService(readOnlyRepo,{get:()=>secret});
  let providerRows=[],providerHasMore=false,lookupOk=true;
  global.fetch=async(url,init)=>{assert.equal(init.method,'GET');return {ok:lookupOk,status:lookupOk?200:503,json:async()=>({data:providerRows,has_more:providerHasMore})};};
  const original=JSON.stringify(row);
  assert.equal((await reporting.report(1,actor)).rows[0].finding,'no_refund_found');
  providerRows=[{id:'re_other',payment_intent:'pi_report',status:'succeeded',amount:5000,currency:'usd'}];
  assert.equal((await reporting.report(1,actor)).rows[0].finding,'unlinked_refunds');
  providerRows[0].metadata={refundRequestId:row.id};assert.equal((await reporting.report(1,actor)).rows[0].finding,'reference_mismatch');
  row.stripeRefundId='re_other';assert.equal((await reporting.report(1,actor)).rows[0].finding,'matched');
  providerRows.push({...providerRows[0],id:'re_extra',metadata:{}});assert.equal((await reporting.report(1,actor)).rows[0].finding,'additional_refunds');providerRows.pop();row.stripeRefundId='local_refund_fake';
  providerRows[0].status='pending';assert.equal((await reporting.report(1,actor)).rows[0].finding,'status_mismatch');
  providerRows[0].amount=2500;assert.equal((await reporting.report(1,actor)).rows[0].finding,'amount_mismatch');
  providerHasMore=true;assert.equal((await reporting.report(1,actor)).rows[0].finding,'incomplete_lookup');providerHasMore=false;
  lookupOk=false;assert.equal((await reporting.report(1,actor)).rows[0].finding,'lookup_error');
  await assert.rejects(()=>reporting.report(1,{role:'org_admin'}),/administrator/);
  assert.equal(JSON.stringify(row),original);
  console.log('Admin refund and read-only reconciliation tests passed.');
  console.log('Refund integration passed: invalid configuration/references, pending/action/failure states, confirmed completion, duplicate approvals, idempotent timeout recovery, and expired retry protection.');
 } finally {global.fetch=originalFetch;if(db.isInitialized)await db.destroy();await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
