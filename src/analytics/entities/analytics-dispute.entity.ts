import { Column, Entity, PrimaryColumn } from 'typeorm';
// Durable financial evidence from verified Stripe webhooks, not browser telemetry.
@Entity('analytics_disputes')
export class AnalyticsDisputeEntity {
  @PrimaryColumn({ type: 'varchar' }) id: string;
  @Column({ name: 'payment_intent_id', type: 'varchar' }) paymentIntentId: string;
  @Column({ name: 'amount_minor', type: 'bigint' }) amountMinor: string;
  @Column({ type: 'varchar' }) currency: string;
  @Column({ name: 'occurred_at', type: 'timestamptz' }) occurredAt: Date;
}
