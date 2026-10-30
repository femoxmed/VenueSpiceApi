import { BadRequestException } from '@nestjs/common';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';

export const REFUND_REASONS = ['voluntary', 'organizer_cancellation', 'platform_error'] as const;
export type RefundReason = typeof REFUND_REASONS[number];
export const REFUND_POLICY_VERSION = 'processing-retained-v1';

export function refundBreakdown(order: TicketOrderEntity, reason: RefundReason = 'voluntary') {
 if (!REFUND_REASONS.includes(reason)) throw new BadRequestException('Select a valid cancellation reason');
 const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
 const total = cents(order.total), tax = cents(order.tax), subtotal = cents(order.subtotal);
 const fees = total - subtotal - tax;
 if (![total, tax, subtotal, fees].every(n => Number.isFinite(n) && n >= 0)) throw new BadRequestException('Order totals require reconciliation before refunding');
 const usesNewPolicy = order.feeSnapshot?.refundPolicyVersion === REFUND_POLICY_VERSION;
 const feeValue = order.feeSnapshot?.buyerProcessingFee;
 // Never deduct organizer-paid fees or guess a mixed order's fee allocation.
 const processing = feeValue != null ? cents(feeValue) : order.feePayer === 'buyer' ? cents(order.processingFee) : order.feePayer === 'organizer' ? 0 : null;
 if (usesNewPolicy && (processing === null || !Number.isFinite(processing) || processing < 0 || processing > fees)) throw new BadRequestException('Buyer processing fee requires reconciliation before refunding');
 const buyerProcessing = processing !== null && Number.isFinite(processing) && processing >= 0 && processing <= fees ? processing : 0;
 const percentage = reason === 'voluntary' ? Math.min(100, Math.max(0, Number(order.event?.refundablePercentage ?? 100))) : 100;
 if (!Number.isFinite(percentage)) throw new BadRequestException('Invalid event refund percentage');
 const retainedProcessing = reason === 'voluntary' && usesNewPolicy ? buyerProcessing : 0;
 const refund = Math.round((total - retainedProcessing) * percentage / 100);
 const refundedSubtotal = Math.round(subtotal * percentage / 100);
 const refundedTax = Math.min(refund - refundedSubtotal, Math.round(tax * percentage / 100));
 // Assign any cent-rounding remainder to refundable fees so components add up exactly.
 const refundedFees = refund - refundedSubtotal - refundedTax;
 return {cancellationReason: reason, policyVersion: usesNewPolicy ? REFUND_POLICY_VERSION : 'legacy', percentage,
  total: total/100, subtotal: subtotal/100, tax: tax/100, buyerFees: fees/100,
  buyerProcessingFee: buyerProcessing/100, retainedProcessingFee: retainedProcessing/100,
  refundedSubtotal: refundedSubtotal/100, taxPortion: refundedTax/100, refundedFees: refundedFees/100,
  refundAmount: refund/100, totalRetained: (total-refund)/100};
}

export type RefundAmounts = { tickets: number; serviceFee: number; processingFee: number; tax: number };

/** Admin allocations use the recorded buyer charges, never organizer-paid costs. */
export function adminRefundBreakdown(order: TicketOrderEntity, reason: RefundReason, amounts?: RefundAmounts) {
 const policy = refundBreakdown(order, reason);
 const raw = order.feeSnapshot?.buyerProcessingFee;
 const processing = raw != null ? Number(raw) : order.feePayer === 'buyer' ? Number(order.processingFee || 0) : order.feePayer === 'organizer' || policy.buyerFees === 0 ? 0 : NaN;
 if (!Number.isFinite(processing) || processing < 0 || Math.round(processing*100) > Math.round(policy.buyerFees*100)) throw new BadRequestException('Buyer fee allocation requires reconciliation before selecting refund components');
 const round = (n: number) => Math.round(n*100)/100;
 const available: RefundAmounts = {tickets: policy.subtotal, serviceFee: round(policy.buyerFees-processing), processingFee: round(processing), tax: policy.tax};
 const defaultProcessing = policy.retainedProcessingFee > 0 ? 0 : Math.max(round(policy.refundedFees-available.serviceFee), Math.min(available.processingFee, round(available.processingFee*policy.percentage/100), policy.refundedFees));
 const defaults: RefundAmounts = {tickets: policy.refundedSubtotal, serviceFee: round(policy.refundedFees-defaultProcessing), processingFee: defaultProcessing, tax: policy.taxPortion};
 const chosen = amounts ?? defaults;
 for (const key of Object.keys(available) as Array<keyof RefundAmounts>) {
  const value=chosen[key];
  if (typeof value!=='number' || !Number.isFinite(value) || value<0 || Math.abs(value*100-Math.round(value*100))>0.000001 || Math.round(value*100)>Math.round(available[key]*100)) throw new BadRequestException(`Invalid ${key} refund amount; it must be between zero and the amount paid`);
 }
 const refundCents=(Object.keys(available) as Array<keyof RefundAmounts>).reduce((sum,key)=>sum+Math.round(chosen[key]*100),0);
 if (refundCents<=0 || refundCents>Math.round(policy.total*100)) throw new BadRequestException('Select a positive refund amount no greater than the original payment');
 return {...policy, availableComponents: available, refundComponents: {...chosen}, adminOverride: amounts !== undefined,
  refundedSubtotal: chosen.tickets, taxPortion: chosen.tax, refundedFees: round(chosen.serviceFee+chosen.processingFee),
  retainedProcessingFee: round(available.processingFee-chosen.processingFee), refundAmount: refundCents/100, totalRetained: round(policy.total-refundCents/100)};
}
