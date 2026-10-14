const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { TicketOrdersController } = require('../dist/ticket-orders/ticket-orders.controller');
const payload = { type: 'checkout.session.completed', data: { object: { payment_status: 'paid' } } };
let calls = 0;
const service = { handleStripeWebhook: body => { calls++; assert.equal(body, payload); return { received: true }; } };
const controller = (flag, secret) => new TicketOrdersController(service, {get: (key, fallback) => {
  const value = key === 'STRIPE_WEBHOOK_VERIFY_SIGNATURE' ? flag : secret;
  return value === undefined ? fallback : value;
}});
const unsigned = { get: () => undefined };
for (const flag of [undefined, '', 'true', 'FALSE', '0', 'disabled']) {
  assert.throws(() => controller(flag, 'secret').handleStripeWebhook(payload, unsigned), /Missing Stripe webhook signature/);
  assert.throws(() => controller(flag).handleStripeWebhook(payload, unsigned), /not configured/);
}
assert.equal(calls, 0);
assert.deepEqual(controller('false').handleStripeWebhook(payload, unsigned), {received:true});
assert.deepEqual(controller('false', 'secret').handleStripeWebhook(payload, {rawBody:Buffer.from('{}'),get:()=> 'invalid'}), {received:true});
assert.equal(calls,2);
const rawBody = Buffer.from(JSON.stringify(payload));
const timestamp = Math.floor(Date.now()/1000);
const signature = createHmac('sha256','secret').update(`${timestamp}.`).update(rawBody).digest('hex');
const signed = {rawBody, get:()=>`t=${timestamp},v1=${signature}`};
controller(undefined,'secret').handleStripeWebhook(payload,signed);
controller('true','secret').handleStripeWebhook(payload,signed);
assert.equal(calls,4);
assert.throws(()=>controller('true','secret').handleStripeWebhook(payload,{...signed,rawBody:Buffer.from('{}')}),/Invalid Stripe webhook signature/);
assert.equal(calls,4);
console.log('Webhook verification checks passed: secure default, explicit opt-out, no secret needed only when disabled, signed delivery, and tamper rejection.');
