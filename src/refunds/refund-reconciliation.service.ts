import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { RefundRequestEntity } from './entities/refund-request.entity';

type ProviderRefund = { id: string; status: string; amount: number; currency: string; payment_intent: string; metadata?: Record<string,string> };

@Injectable()
export class RefundReconciliationService {
 constructor(@InjectRepository(RefundRequestEntity) private readonly refunds: Repository<RefundRequestEntity>, private readonly config: ConfigService) {}
 private assertAdmin(role: Role) {
  if (![Role.ADMIN,Role.PLATFORM_ADMIN,Role.SUPER_ADMIN].includes(role)) throw new ForbiddenException('Platform administrator access required');
 }
 private async stripeGet(path: string) {
  const secret = this.config.get<string>('STRIPE_SECRET_KEY');
  if (!secret) throw new Error('Stripe is not configured');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {method:'GET', headers:{Authorization:`Bearer ${secret}`}, signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error(`Stripe lookup failed (${response.status}); check account, mode and credentials`);
  return response.json();
 }
 async report(page: number, actor: {role: Role}) {
  this.assertAdmin(actor.role);
  const pageSize=10;
  const [refunds,total]=await this.refunds.findAndCount({order:{createdAt:'DESC',id:'DESC'},take:pageSize,skip:(page-1)*pageSize});
  const rows=[];
  // Bound provider concurrency without writing a report, audit record or refund.
  for(let start=0;start<refunds.length;start+=2) rows.push(...await Promise.all(refunds.slice(start,start+2).map(r=>this.inspect(r))));
  return {generatedAt:new Date().toISOString(),readOnly:true,page,pageSize,total,rows};
 }
 private async inspect(refund: RefundRequestEntity) {
  const paymentId=refund.order?.stripePaymentIntentId;
  const base={id:refund.id,orderId:refund.orderId,customerEmail:refund.customerEmail,eventTitle:refund.order?.event?.title || '',localStatus:refund.status,localAmount:Number(refund.amount),currency:refund.currency,localRefundId:refund.stripeRefundId || null,paymentId:paymentId || null};
  const result=(finding:string,detail:string,providerRefunds:ProviderRefund[]=[],needsAttention=true)=>({...base,finding,detail,needsAttention,providerRefunds:providerRefunds.map(r=>({id:r.id,status:r.status,amount:r.amount/100,currency:r.currency}))});
  if (!paymentId || !/^pi_[A-Za-z0-9]+$/.test(paymentId)) return result('missing_payment_reference','Cannot verify payment. Locate the original Stripe payment manually; no conclusion about reimbursement is possible.');
  try {
   const all:ProviderRefund[]=[];let cursor='';let complete=false;
   for(let page=0;page<5;page++) {
    const query=new URLSearchParams({payment_intent:paymentId,limit:'100',...(cursor?{starting_after:cursor}:{})});
    const data=await this.stripeGet(`refunds?${query}`);
    if (!Array.isArray(data.data)) throw new Error('Invalid Stripe response');
    all.push(...data.data);
    if (!data.has_more) {complete=true;break;}
    cursor=data.data.at(-1)?.id;
    if (!cursor) throw new Error('Incomplete Stripe response');
   }
   const candidates=all.filter(r=>r.payment_intent===paymentId && (r.id===refund.stripeRefundId || r.metadata?.refundRequestId===refund.id));
   if (!complete) return result('incomplete_lookup','Provider pagination limit reached; review in Stripe. Do not infer that a refund is missing.',all);
   if (candidates.length>1) return result('multiple_matches','Multiple provider refunds reference this request. Review manually.',all);
   const match=candidates[0];
   if (!match) return all.length ? result('unlinked_refunds','Stripe has refunds for this payment, but none is linked to this request. Compare amounts and reasons before any action.',all) : result('no_refund_found','No Stripe refund found for this payment in the configured account/mode. Check disputes and external reimbursements before issuing money.');
   if (match.amount!==Math.round(Number(refund.amount)*100) || match.currency.toLowerCase()!==refund.currency.toLowerCase()) return result('amount_mismatch','Linked Stripe refund amount or currency differs from Venue Spice.',all);
   const expected=match.status==='succeeded'?'succeeded':['failed','canceled'].includes(match.status)?'failed':'processing';
   if (refund.status!==expected) return result('status_mismatch',`Stripe reports ${match.status}; Venue Spice reports ${refund.status}.`,all);
   if (expected==='processing') return result('provider_pending',`Stripe reports ${match.status}; follow up in Stripe.`,all);
   if (expected==='failed') return result('provider_failed',`Stripe reports ${match.status}; no successful refund is confirmed.`,all);
   if (match.id!==refund.stripeRefundId) return result('reference_mismatch','Stripe confirms the refund through request metadata, but the saved refund reference is missing or different. Review the local reference; do not refund again.',all);
   if (all.some(r=>r.id!==match.id && !['failed','canceled'].includes(r.status))) return result('additional_refunds','This request matches, but the payment has additional active or successful refunds. Review the full payment before any action.',all);
   return result('matched','Amount, currency and successful status match Stripe. Bank posting may still take time.',all,false);
  } catch (error) {return result('lookup_error',error instanceof Error?error.message:'Stripe lookup unavailable');}
 }
}
