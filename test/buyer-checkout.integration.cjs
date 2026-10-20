// Localhost-only synthetic integration suite. Never reads production environment files.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {Client}=require('pg');
const {DataSource,getMetadataArgsStorage}=require('typeorm');
const {JwtService}=require('@nestjs/jwt');
const {BuyerAuthService}=require('../dist/auth/buyer-auth.service');
const {BuyerLoginChallengeEntity:Challenge,BuyerLoginLimitEntity:Limit}=require('../dist/auth/entities/buyer-login.entity');
const {UserEntity:User}=require('../dist/auth/entities/user.entity');
const {AuthService}=require('../dist/auth/auth.service');
const {TicketOrdersService}=require('../dist/ticket-orders/ticket-orders.service');
const {TicketOrderEntity:Order}=require('../dist/ticket-orders/entities/ticket-order.entity');
const {TicketOrderItemEntity:Item}=require('../dist/ticket-orders/entities/ticket-order-item.entity');
const {OrganizationEntity:Org}=require('../dist/organizations/entities/organization.entity');
const {OrganizationMemberEntity:Member}=require('../dist/organizations/entities/organization-member.entity');
const {EventEntity:Event}=require('../dist/events/entities/event.entity');
const {JwtStrategy}=require('../dist/auth/jwt.strategy');
const {BuyerJwtStrategy}=require('../dist/auth/buyer-jwt.strategy');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function load(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())load(p);else if(p.endsWith('.entity.js'))require(p);}}
(async()=>{
 const port=Number(process.env.ANALYTICS_TEST_PORT||55439),schema=`buyer_${Date.now()}`;
 const client=new Client({host:'127.0.0.1',port,user:'analytics_test',database:'postgres'});await client.connect();await client.query(`CREATE SCHEMA ${schema}`);
 await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
 load(path.join(__dirname,'../dist'));
 const db=new DataSource({type:'postgres',host:'127.0.0.1',port,username:'analytics_test',database:'postgres',schema,synchronize:true,entities:[...new Set(getMetadataArgsStorage().tables.map(t=>t.target))],extra:{options:`-c search_path=${schema},public`}});
 try{
 await db.initialize();
 const settings={JWT_SECRET:'synthetic-test-secret',JWT_REFRESH_SECRET:'synthetic-refresh-secret',CHECKOUT_ACCOUNT_REQUIRED:'true'};
 const config={get:(key,fallback)=>settings[key]??fallback};
 const jwt=new JwtService({secret:settings.JWT_SECRET,signOptions:{expiresIn:'1d'}});
 const auth=Object.create(AuthService.prototype);Object.assign(auth,{usersRepository:db.getRepository(User),jwtService:jwt,configService:config});
 const emails=[];const mail={buildBrandedEmail:x=>x,queueEmail:async(email,subject,body)=>emails.push({email,code:body.intro.match(/\b\d{6}\b/)[0]})};
 const service=new BuyerAuthService(db,config,jwt,mail,auth);
 async function login(email){const request=await service.request(email,'127.0.0.1',true);return service.verify(email,request.challengeId,emails.at(-1).code);}
 const first=await login(' NEW@example.invalid ');
 assert.equal(first.user.accountType,'customer');assert.equal(first.user.sessionScope,'buyer');assert.equal(first.user.email,'new@example.invalid');assert.ok(first.user.verifiedAt);assert.equal(first.user.passwordHash,undefined);
 const claim=await db.getRepository(Challenge).findOneBy({email:first.user.email});assert.notEqual(claim.codeHash,emails[0].code);
 await assert.rejects(()=>service.verify(first.user.email,claim.challengeId,emails[0].code),/Invalid or expired/);
 await assert.rejects(()=>service.request(first.user.email,'127.0.0.1',true),/60 seconds/);
 await assert.rejects(()=>service.request('no-consent@example.invalid','127.0.0.1',false),/terms/);
 // Every existing account keeps its identity and privileges, while email-code tokens are ticket-scoped.
 for(const [i,role,accountType] of [[10,'super_admin',null],[11,'org_admin','organization'],[12,'agent','influencer'],[13,'user','vendor']]){
  const email=`role${i}@example.invalid`;await db.getRepository(User).save({id:id(i),email,fullName:'Existing',passwordHash:'unchanged',role,accountType,isActive:true,verifiedAt:new Date()});
  const session=await login(email);assert.equal(session.user.id,id(i));assert.equal(session.user.role,role);assert.equal(session.user.accountType,accountType);assert.equal((await db.getRepository(User).findOneBy({id:id(i)})).passwordHash,'unchanged');
 }
 const normalStrategy=new JwtStrategy(config,auth),buyerStrategy=new BuyerJwtStrategy(config,auth);
 const payload=jwt.verify(first.accessToken);
 await assert.rejects(()=>normalStrategy.validate(payload),/password/);
 assert.equal((await buyerStrategy.validate(payload)).id,first.user.id);
 await assert.rejects(()=>buyerStrategy.validate({...payload,type:'refresh'}));
 await assert.rejects(()=>auth.verifyEmail({email:first.user.email,code:'000000'}),/sign in/);
 assert.equal((await normalStrategy.validate({sub:first.user.id})).id,first.user.id);
 const refreshed=await auth.refresh(first.refreshToken);const refreshedClaims=jwt.verify(refreshed.accessToken);assert.equal(refreshedClaims.scope,'buyer');assert.equal(refreshedClaims.emailProofAt,payload.emailProofAt);
 const wrong=await service.request('wrong@example.invalid','127.0.0.1',true);const validCode=emails.at(-1).code;
 for(let i=0;i<5;i++)await assert.rejects(()=>service.verify('wrong@example.invalid',wrong.challengeId,'000000'));
 await assert.rejects(()=>service.verify('wrong@example.invalid',wrong.challengeId,validCode));
 assert.equal((await db.getRepository(Challenge).findOneBy({email:'wrong@example.invalid'})).attempts,5);
 const expired=await service.request('expired@example.invalid','127.0.0.1',true);await db.getRepository(Challenge).update({email:'expired@example.invalid'},{expiresAt:new Date(0)});
 await assert.rejects(()=>service.verify('expired@example.invalid',expired.challengeId,emails.at(-1).code));
 await db.getRepository(User).save({id:id(20),email:'disabled@example.invalid',fullName:'Disabled',passwordHash:'unused',role:'user',isActive:false});
 await assert.rejects(()=>login('disabled@example.invalid'));
 const race=await service.request('race@example.invalid','127.0.0.1',true),raceCode=emails.at(-1).code;
 const raceResults=await Promise.allSettled([service.verify('race@example.invalid',race.challengeId,raceCode),service.verify('race@example.invalid',race.challengeId,raceCode)]);assert.equal(raceResults.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(await db.getRepository(User).countBy({email:'race@example.invalid'}),1);
 for(let i=0;i<5;i++){
  await service.request('limited@example.invalid','other-ip',true);
  await db.getRepository(Challenge).update({email:'limited@example.invalid'},{sentAt:new Date(Date.now()-61000)});
 }
 await assert.rejects(()=>service.request('limited@example.invalid','other-ip',true),/Too many/);
 const orders=Object.create(TicketOrdersService.prototype);Object.assign(orders,{ticketOrdersRepository:db.getRepository(Order),ticketOrderItemsRepository:db.getRepository(Item),usersRepository:db.getRepository(User),organizationMembersRepository:db.getRepository(Member),configService:config});
 await assert.rejects(()=>orders.createCheckoutSession({termsAccepted:true}),/Sign in/);
 await assert.rejects(()=>orders.createCheckoutSession({termsAccepted:true},{id:first.user.id}),/name and valid phone/);
 await assert.rejects(()=>orders.buyerProfile(first.user.id,{fullName:'Buyer',phone:'bad'}),/valid phone/);
 await orders.buyerProfile(first.user.id,{fullName:'Buyer Snapshot',phone:'+12025550123'});
 const org=await db.getRepository(Org).save({id:id(30),name:'Org A',slug:'orga',ownerUserId:id(11)});
 const otherOrg=await db.getRepository(Org).save({id:id(31),name:'Org B',slug:'orgb',ownerUserId:id(13)});
 const event=await db.getRepository(Event).save({id:id(40),title:'Synthetic Event',slug:'synthetic-event',organization:org,status:'published',startsAt:new Date('2099-01-01')});
 const otherEvent=await db.getRepository(Event).save({id:id(41),title:'Other Event',slug:'other-event',organization:otherOrg,status:'published',startsAt:new Date('2099-01-01')});
 orders.prepareCheckout=async()=>({event,referralCode:null,discount:null,items:[]});
 orders.calculateCheckoutFees=async()=>({subtotal:50,total:50,tax:0,platformFee:0,processingFee:0,organizerNet:50,feePayer:'buyer'});
 orders.createStripeSession=async()=>({id:'cs_'+require('crypto').randomUUID(),url:'https://example.invalid/pay'});
 orders.createDemoInvoiceAndTransaction=async()=>({invoice:null,transaction:null});
 const order=await orders.createCheckoutSession({termsAccepted:true,customerName:'Forged',customerEmail:'someone@example.invalid',customerPhone:'+12025550199'},{id:first.user.id});
 assert.equal(order.buyerUserId,first.user.id);assert.equal(order.customerEmail,first.user.email);assert.equal(order.customerName,'Buyer Snapshot');assert.equal(order.customerPhone,'+12025550123');
 await orders.buyerProfile(first.user.id,{fullName:'Updated Profile',phone:'+12025550124'});
 assert.equal((await db.getRepository(Order).findOneBy({id:order.id})).customerName,'Buyer Snapshot');
 assert.equal((await orders.myOrders(id(11))).length,0);assert.equal((await orders.myOrders(first.user.id)).length,1);
 settings.CHECKOUT_ACCOUNT_REQUIRED='false';
 const legacy=await orders.createCheckoutSession({termsAccepted:true,customerName:'Legacy',customerEmail:first.user.email});assert.equal(legacy.buyerUserId,null);
 await assert.rejects(()=>orders.claimPreviousOrders({id:first.user.id,email:first.user.email}),/Verify your email/);
 const claimResult=await orders.claimPreviousOrders({id:first.user.id,email:first.user.email,emailProofAt:Date.now()});assert.equal(claimResult.claimed,1);
 assert.equal((await orders.claimPreviousOrders({id:first.user.id,email:first.user.email,emailProofAt:Date.now()})).claimed,0);
 await db.getRepository(Order).save({event:otherEvent,organization:otherOrg,customerName:'Other',customerEmail:'other@example.invalid',total:99,subtotal:99,status:'paid',currency:'USD'});
 const scoped=await orders.customerDirectory({id:id(11),role:'org_admin'},org.id);assert.equal(scoped.length,1);assert.equal(scoped[0].email,first.user.email);
 await assert.rejects(()=>orders.customerDirectory({id:id(11),role:'org_admin'},otherOrg.id),/cannot view/);
 await assert.rejects(()=>orders.customerDirectory({id:first.user.id,role:'customer'}),/Select an organization/);
 assert.equal((await orders.customerDirectory({id:id(10),role:'super_admin'})).length,2);
 // Exercise real HTTP guards, DTO validation and token scopes on a localhost-only Nest app.
 const {Module,ValidationPipe}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core'),{ConfigService}=require('@nestjs/config');
 const {PassportModule}=require('@nestjs/passport');
 const {TicketOrdersController}=require('../dist/ticket-orders/ticket-orders.controller');
 const {BuyerAuthController}=require('../dist/auth/buyer-auth.controller');
 class TestModule {}
 Module({imports:[PassportModule],controllers:[TicketOrdersController,BuyerAuthController],providers:[{provide:TicketOrdersService,useValue:orders},{provide:BuyerAuthService,useValue:service},{provide:AuthService,useValue:auth},{provide:ConfigService,useValue:config},JwtStrategy,BuyerJwtStrategy]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
 await app.listen(0,'127.0.0.1');
 try {
  const base=await app.getUrl();
  const call=(route,token,body)=>fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await call('/ticket-orders/mine',first.accessToken)).status,200);
  assert.equal((await call('/ticket-orders/mine')).status,401);
  assert.equal((await call('/ticket-orders/customers',first.accessToken)).status,401);
  const adminToken=jwt.sign({sub:id(10)});assert.equal((await call('/ticket-orders/customers',adminToken)).status,200);
  assert.equal((await call('/ticket-orders/buyer-profile',first.accessToken,{fullName:'Buyer',phone:'bad'})).status,400);
  assert.equal((await call('/ticket-orders/buyer-profile',first.accessToken,{fullName:'Buyer',phone:'+12025550123',role:'admin'})).status,400);
  const body={eventId:event.id,customerName:'Buyer',customerEmail:first.user.email,termsAccepted:true};
  assert.equal((await call('/ticket-orders/checkout','invalid',body)).status,401);
  settings.CHECKOUT_ACCOUNT_REQUIRED='true';assert.equal((await call('/ticket-orders/checkout',null,body)).status,401);
  assert.equal((await call('/auth/buyer/request-code',null,{email:'bad',termsAccepted:true})).status,400);
  assert.equal((await call('/auth/buyer/request-code',null,{email:'new@example.invalid',termsAccepted:false})).status,400);
 } finally {await app.close();}
 // A free checkout takes the existing free-payment path with the same account link.
 const savedFees=orders.calculateCheckoutFees;
 orders.calculateCheckoutFees=async()=>({subtotal:0,total:0,tax:0,platformFee:0,processingFee:0,organizerNet:0,feePayer:'buyer'});
 orders.completeFreeCheckout=async order=>({order:await db.getRepository(Order).save({...order,status:'paid'}),invoice:{total:0},transaction:{amount:0}});
 const free=await orders.createCheckoutSession({termsAccepted:true},{id:first.user.id});assert.equal(free.paymentMode,'free');assert.equal(free.buyerUserId,first.user.id);assert.equal(free.status,'paid');
 orders.calculateCheckoutFees=savedFees;
 const before=await db.getRepository(Order).count();await db.synchronize();assert.equal(await db.getRepository(Order).count(),before);assert.equal((await db.getRepository(Order).findOneBy({id:order.id})).buyerUserId,first.user.id);
 // Simulate upgrading an existing deployment with guest orders and no buyer schema.
 await db.query('ALTER TABLE ticket_orders DROP COLUMN buyer_user_id CASCADE');
 await db.query('ALTER TABLE users DROP COLUMN customer_terms_accepted_at');
 await db.query('DROP TABLE buyer_login_challenges, buyer_login_limits');
 await db.synchronize();assert.equal(await db.getRepository(Order).count(),before);assert.equal((await db.getRepository(Order).findOneBy({id:order.id})).buyerUserId,null);
 await db.query('ALTER TABLE ticket_orders DROP COLUMN buyer_user_id CASCADE');
 await db.query('ALTER TABLE users DROP COLUMN customer_terms_accepted_at');
 await db.query('DROP TABLE buyer_login_challenges, buyer_login_limits');
 const migration=fs.readFileSync(path.join(__dirname,'../sql/20261020-buyer-checkout.sql'),'utf8');await db.query(migration);await db.query(migration);await db.synchronize();assert.equal(await db.getRepository(Order).count(),before);
 console.log('Buyer integration passed: free-order linkage, idempotent SQL alternative, HTTP guards and DTOs, legacy-schema upgrade, verification bypass regression, new/existing roles, scopes and refresh, hashed expiring single-use codes, persisted attempt/send limits, concurrent verification, inactive users, required auth/phone, trusted buyer snapshots, guest rollout, ownership, verified claims, tenant-scoped customers, repeat synchronization.');
 }finally{if(db.isInitialized)await db.destroy();await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
