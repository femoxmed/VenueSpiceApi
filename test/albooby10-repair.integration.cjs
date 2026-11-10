// Local disposable PostgreSQL only. Run after npm run build.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { DataSource, getMetadataArgsStorage } = require('typeorm');
const { Client } = require('pg');
const { repairAlbooby10 } = require('../dist/repairs/albooby10');
const title = 'Runtown Live in Dallas — Mad Over You | Thanksgiving Friday 2026';
function load(dir) {
  for (const file of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir,file.name);
    if (file.isDirectory()) load(p); else if (p.endsWith('.entity.js')) require(p);
  }
}
(async () => {
  const port = Number(process.env.ANALYTICS_TEST_PORT || 55459), schema = 'coupon_test_' + Date.now();
  const options = {host:'127.0.0.1', port, database:'postgres'};
  const client = new Client({...options,user:'analytics_test'}); await client.connect();
  await client.query('CREATE SCHEMA ' + schema);
  load(path.join(__dirname,'../dist'));
  const db = new DataSource({...options,type:'postgres',username:'analytics_test',schema,synchronize:true,entities:[...new Set(getMetadataArgsStorage().tables.map(t=>t.target))],extra:{options:'-c search_path='+schema+',public'}});
  try {
    await db.initialize();
    const save = (entity,data) => db.getRepository(entity).save(data);
    const user = await save('UserEntity',{email:'test@example.invalid',passwordHash:'unused',fullName:'Fixture'});
    const org = await save('OrganizationEntity',{name:'Fixture',slug:'fixture',ownerUserId:user.id});
    const event = await save('EventEntity',{title:'Different event',slug:'fixture',organization:org,startsAt:new Date('2099-01-01'),status:'published'});
    const agent = await save('AgentEntity',{organization:org,user,fullName:'Fixture',email:user.email,status:'active'});
    const coupon = await save('DiscountCouponEntity',{code:'ALBOOBY10',event,organization:org,agent,status:'expired',value:10,approvedByInfluencerAt:new Date(),endsAt:new Date('2020-01-01')});
    const run = mode => repairAlbooby10(db, mode);
    assert.match(await run('apply'), /no exact campaign/);
    await db.getRepository('EventEntity').update(event.id,{title});
    assert.match(await run('preview'), /would restore/);
    const coupons = db.getRepository('DiscountCouponEntity');
    assert.equal((await coupons.findOneBy({id:coupon.id})).status,'expired');
    await coupons.update(coupon.id,{status:'paused'});
    assert.match(await run('apply'), /not eligible/);
    await coupons.update(coupon.id,{status:'expired',endsAt:new Date('2098-01-01')});
    assert.match(await run('apply'), /future end date/);
    await coupons.update(coupon.id,{endsAt:new Date('2020-01-01')});
    assert.deepEqual((await Promise.all([run('apply'),run('apply')])).sort(),['already processed','restored active with no end date']);
    const repaired = await coupons.findOneBy({id:coupon.id});
    assert.equal(repaired.endsAt,null); assert.equal(repaired.status,'active');
    await coupons.update(coupon.id,{status:'paused'});
    assert.equal(await run('apply'),'already processed');
    assert.equal((await coupons.findOneBy({id:coupon.id})).status,'paused');
    assert.equal(await db.getRepository('AuditLogEntity').count(),1);
    const { AgentsService } = require('../dist/agents/agents.service');
    const { DiscountsService } = require('../dist/discounts/discounts.service');
    const discounts = Object.assign(Object.create(DiscountsService.prototype), {couponsRepository:coupons});
    const list = new AgentsService(db.getRepository('AgentEntity'), db.getRepository('ReferralCodeEntity'), db.getRepository('OrganizationEntity'));
    const second = await save('DiscountCouponEntity',{code:'SECOND',organization:org,agent,status:'active',value:15,endsAt:new Date('2098-01-01')});
    const page = () => list.findAll(org.id,{id:user.id,role:'user'},{page:1,pageSize:1});
    const result = await page();
    assert.equal(result.total,1);
    assert.equal(result.items[0].campaigns.length,2);
    const firstCampaign = result.items[0].campaigns.find(c=>c.id===coupon.id);
    assert.equal(firstCampaign.event.title,title);
    assert.equal(firstCampaign.status,'paused');
    assert.equal(firstCampaign.endsAt,null);
    await discounts.update(second.id,{},user);
    assert.equal((await coupons.findOneBy({id:second.id})).endsAt.toISOString(),'2098-01-01T00:00:00.000Z');
    await discounts.update(second.id,{endsAt:null},user);
    const secondCampaign = (await page()).items[0].campaigns.find(c=>c.id===second.id);
    assert.equal(secondCampaign.endsAt,null);
    assert.equal(secondCampaign.status,'active');
    assert.equal(secondCampaign.event,null);
    console.log('Repair regression passed');
  } finally {
    if (db.isInitialized) await db.destroy();
    await client.query('DROP SCHEMA '+schema+' CASCADE'); await client.end();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
