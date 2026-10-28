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
