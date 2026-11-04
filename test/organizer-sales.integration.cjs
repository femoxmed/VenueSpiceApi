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
 const port=Number(process.env.ANALYTICS_TEST_PORT||55439),schema=`sales_${Date.now()}`;
 const client=new Client({host:'127.0.0.1',port,user:'analytics_test',database:'postgres'});await client.connect();await client.query(`CREATE SCHEMA ${schema}`);await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
 load(path.join(__dirname,'../dist'));
 const db=new DataSource({type:'postgres',host:'127.0.0.1',port,username:'analytics_test',database:'postgres',schema,synchronize:true,entities:[...new Set(getMetadataArgsStorage().tables.map(t=>t.target))],extra:{options:`-c search_path=${schema},public`}});

 try {
  await db.initialize();
  const {OrganizerSalesService}=require('../dist/organizer-sales/organizer-sales.service');
  const Member=entity('organizations/entities/organization-member.entity','OrganizationMemberEntity');
  const Withdrawal=entity('organizer-sales/entities/withdrawal-request.entity','WithdrawalRequestEntity');
  let balanceCalls=0;
  const ledger={syncOrganizationOrders:async()=>{throw new Error('Redundant full ledger sync');},getBalance:async()=>{balanceCalls++;return {pending:0,available:42,paidOut:0,reversed:0};}};
  const sales=new OrganizerSalesService(...[User,Org,Member,Order,Type,Withdrawal].map(e=>db.getRepository(e)),ledger,{}, {}, {});
  const actor=await db.getRepository(User).save({email:'sales@example.invalid',fullName:'Owner',passwordHash:'unused',role:'user'});
  const org=await db.getRepository(Org).save({name:'Sales test',slug:'sales-test',ownerUserId:actor.id});
  const other=await db.getRepository(Org).save({name:'Other',slug:'other-test',ownerUserId:actor.id});
  const event=await db.getRepository(Event).save({title:'Sales event',slug:'sales-event',organization:org,status:'published',startsAt:new Date('2099-01-01')});
  const type=await db.getRepository(Type).save({event,name:'General',price:50,quantity:100,quantitySold:4});
  for(const [i,status] of ['paid','paid','pending','refunded'].entries()) {
   const order=await db.getRepository(Order).save({event,organization:org,customerName:'Buyer '+i,customerEmail:'buyer@example.invalid',status,total:60,subtotal:50,tax:5,platformFee:3,processingFee:2,organizerNet:45,currency:'USD',paidAt:new Date(2026,0,i+1),feeSnapshot:{discountCode:'PROMO',grossSubtotal:55,discountAmount:5,influencerCommission:1}});
   await db.getRepository(Item).save({order,ticketType:type,ticketName:'General',quantity:1,unitPrice:50,lineTotal:50});
   await db.getRepository(Ticket).save({order,event,ticketType:type,code:'sale-ticket-'+i,holderName:'Buyer',holderEmail:'buyer@example.invalid'});
  }
  const optimized=await sales.summary(org.id,actor);assert.equal(balanceCalls,1);assert.equal(optimized.summary.orders,2);assert.equal(optimized.summary.buyerPaid,120);assert.equal(optimized.byItemType.tickets[0].id,type.id);
  const light=await sales.getOrders(org.id);assert.ok(light.every(o=>!o.tickets && !o.organization));
  const originalGet=sales.getOrders.bind(sales);
  sales.getOrders=id=>db.getRepository(Order).find({where:{organization:{id}},order:{paidAt:'DESC',createdAt:'DESC'}});
  const baseline=await sales.summary(org.id,actor);assert.deepEqual(optimized,baseline);
  const oldEvent=await sales.eventDetail(org.id,event.id,actor);sales.getOrders=originalGet;
  assert.deepEqual(await sales.eventDetail(org.id,event.id,actor),oldEvent);
  assert.deepEqual(await sales.metrics(org.id,actor),{currency:baseline.currency,summary:baseline.summary,activity:baseline.activity});
  assert.deepEqual(await sales.itemBreakdown(org.id,actor),baseline.byItemType);
  assert.deepEqual(await sales.influencerBreakdown(org.id,actor),baseline.influencers);
  for (const method of ['metrics','itemBreakdown','influencerBreakdown']) {
   await assert.rejects(()=>sales[method](org.id,{id:'00000000-0000-4000-8000-000000000000',role:'user'}),/cannot access/);
  }
  assert.equal((await sales.metrics(other.id,actor)).summary.orders,0);
  assert.deepEqual(await sales.itemBreakdown(other.id,actor),{tickets:[],merchandise:[]});
  assert.deepEqual(await sales.influencerBreakdown(other.id,actor),[]);
  const page=await sales.orders(org.id,actor,{page:1,pageSize:1,status:'paid',search:'Buyer'});assert.equal(page.total,2);assert.equal(page.items.length,1);
  assert.equal((await sales.orders(other.id,actor,{page:1,pageSize:8})).total,0);
  await assert.rejects(()=>sales.orders(org.id,{id:'00000000-0000-4000-8000-000000000000',role:'user'},{page:1}),/cannot access/);
  assert.equal(balanceCalls,2);console.log('Sales regression passed: unchanged summary/detail, light relations, filtered pagination, organization isolation, no ledger sync for order lists.');
 } finally {if(db.isInitialized)await db.destroy();await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
