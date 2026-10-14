import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
// Stripe v1 signatures cover the timestamp and the exact, unmodified request body.
export function verifyStripeWebhook(rawBody: Buffer | undefined, header: string | undefined, secret: string | undefined, now = Date.now()) {
  if (!secret) throw new ServiceUnavailableException('Stripe webhook signing secret is not configured');
  if (!rawBody || !header) throw new BadRequestException('Missing Stripe webhook signature');
  const fields = header.split(',').map(value=>value.trim().split('='));
  const timestamp = fields.find(([key])=>key==='t')?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now/1000-Number(timestamp))>300) throw new BadRequestException('Expired Stripe webhook signature');
  const expected = createHmac('sha256',secret).update(`${timestamp}.`).update(rawBody).digest();
  const valid = fields.filter(([key])=>key==='v1').some(([,signature]) => {
    if (!/^[a-f0-9]{64}$/i.test(signature || '')) return false;
    return timingSafeEqual(expected,Buffer.from(signature,'hex'));
  });
  if (!valid) throw new BadRequestException('Invalid Stripe webhook signature');
}
