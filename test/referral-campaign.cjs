const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DiscountsService } = require('../dist/discounts/discounts.service');
const { TicketOrdersService } = require('../dist/ticket-orders/ticket-orders.service');

function fixture() {
 const service = Object.create(DiscountsService.prototype);
 const organization = {id:'org',name:'Host'};
 const event = {id:'event',title:'December event',startsAt:new Date('2026-12-06T02:00:00Z'),timezone:'America/Chicago',organization};
 const agent = {id:'agent',email:'promoter@example.test',fullName:'Promoter',organization,status:'active',user:{isActive:true}};
 const calls=[];
 Object.assign(service,{
  organizationsRepository:{findOne:async()=>organization},eventsRepository:{findOne:async()=>event},agentsRepository:{findOne:async()=>agent},
  couponsRepository:{findOne:async()=>null,create:x=>x,save:async x=>{calls.push('saved');return x;}},
  configService:{get:()=> 'https://example.test'},notificationsService:{buildBrandedEmail:x=>x,queueEmail:async(...args)=>{calls.push('email');service.email=args[2];}},
 });
 return {service,calls};
}
const dto={organizationId:'org',eventId:'event',agentId:'agent',code:'TEST',type:'percentage',value:10,startsAt:'2026-10-18',endsAt:'2026-12-07'};
test('invitation follows persistence and separates discount dates from event date',async()=>{
 const {service,calls}=fixture(); const coupon=await service.create(dto);
 assert.deepEqual(calls,['saved','email']);
 assert.equal(coupon.startsAt.toISOString(),'2026-10-18T00:00:00.000Z');
 const rows=Object.fromEntries(service.email.rows.map(r=>[r.label,r.value]));
 assert.match(rows['Discount starts'],/18 Oct 2026/); assert.ok(rows['Event date']); assert.equal(rows.Starts,undefined);
});
test('failed persistence sends no invitation',async()=>{
 const {service,calls}=fixture();service.couponsRepository.save=async()=>{throw Error('save failed');};
 await assert.rejects(()=>service.create(dto),/save failed/);assert.deepEqual(calls,[]);
});
test('invalid date window is rejected before save or email',async()=>{
 const {service,calls}=fixture();await assert.rejects(()=>service.create({...dto,endsAt:'2026-10-17'}),/before start/);assert.deepEqual(calls,[]);
});
test('missing discount dates are explicit, never replaced by event dates',async()=>{
 const {service}=fixture();await service.create({...dto,startsAt:undefined,endsAt:undefined});
 const rows=Object.fromEntries(service.email.rows.map(r=>[r.label,r.value]));assert.equal(rows['Discount starts'],'Immediately after campaign approval');assert.equal(rows['Discount ends'],'No expiry date');
});
test('checkout uses coupon date, not future event date, and explains blockers',async()=>{
 const service=Object.create(TicketOrdersService.prototype);
 const coupon={organization:{id:'org'},event:{id:'event'},startsAt:new Date('2000-10-18'),status:'active',approvedByInfluencerAt:new Date(),agent:{status:'active',user:{isActive:true}}};
 service.discountCouponsRepository={findOne:async()=>coupon};
 const event={id:'event',organization:{id:'org'},startsAt:new Date('2099-12-06')};
 assert.equal(await service.ensureDiscountCouponCanBeUsed('TEST',event),coupon);
 coupon.startsAt=new Date('2099-10-18');await assert.rejects(()=>service.ensureDiscountCouponCanBeUsed('TEST',event),/18 Oct 2099/);
 coupon.startsAt=null;coupon.approvedByInfluencerAt=null;await assert.rejects(()=>service.ensureDiscountCouponCanBeUsed('TEST',event),/accept the campaign/);
});
test('unknown codes are rejected instead of silently charging full price',async()=>{
 const service=Object.create(TicketOrdersService.prototype);
 const event={id:'event',status:'published',organization:{id:'org'},addOns:[]};
 Object.assign(service,{
 eventsRepository:{findOne:async()=>event},
 ticketTypesRepository:{find:async()=>[{id:'ticket',event,status:'active',name:'Regular',quantity:100,quantitySold:0,price:50}]},
 referralCodesRepository:{findOne:async()=>null},discountCouponsRepository:{findOne:async()=>null},
 });
 await assert.rejects(()=>service.prepareCheckout({eventId:'event',referralCode:'UNKNOWN',items:[{ticketTypeId:'ticket',quantity:1}]}),/code was not found/);
});
test('clearing the end date removes expiry at checkout; omitting it preserves the original instant', async () => {
 const {service}=fixture(); const coupon=await service.create(dto);
 const oldEnd=new Date('2001-01-02T15:23:00Z');
 Object.assign(coupon,{status:'active',approvedByInfluencerAt:new Date(),startsAt:null,endsAt:oldEnd});
 service.couponsRepository.findOne=async()=>coupon;
 await service.update('test',{});assert.equal(coupon.endsAt,oldEnd);
 await service.update('test',{endsAt:null});assert.equal(coupon.endsAt,null);
 const checkout=Object.create(TicketOrdersService.prototype);
 checkout.discountCouponsRepository={findOne:async()=>coupon};
 assert.equal(await checkout.ensureDiscountCouponCanBeUsed('TEST',coupon.event),coupon);
 coupon.status='paused';await service.update('test',{endsAt:null});
 await assert.rejects(()=>checkout.ensureDiscountCouponCanBeUsed('TEST',coupon.event),/paused/);
});
