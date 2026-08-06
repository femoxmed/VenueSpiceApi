import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { EventEntity } from '../../events/entities/event.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { ReferralCodeEntity } from '../../agents/entities/referral-code.entity';
import { TicketOrderItemEntity } from './ticket-order-item.entity';
import { IssuedTicketEntity } from './issued-ticket.entity';

@Entity('ticket_orders')
export class TicketOrderEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => OrganizationEntity, { eager: true, onDelete: 'RESTRICT' })
	organization: OrganizationEntity;

	@ManyToOne(() => EventEntity, { eager: true, onDelete: 'RESTRICT' })
	event: EventEntity;

	@ManyToOne(() => ReferralCodeEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	referralCode?: ReferralCodeEntity | null;

	@Column({ name: 'customer_name' })
	customerName: string;

	@Column({ name: 'customer_email' })
	customerEmail: string;

	@Column({ name: 'customer_phone', type: 'varchar', nullable: true })
	customerPhone?: string | null;

	@Column({ name: 'terms_accepted_at', type: 'timestamptz', nullable: true })
	termsAcceptedAt?: Date | null;

	@Column({ name: 'terms_version', type: 'varchar', nullable: true })
	termsVersion?: string | null;

	@Column({ name: 'privacy_version', type: 'varchar', nullable: true })
	privacyVersion?: string | null;

	@Column({ name: 'refund_policy_version', type: 'varchar', nullable: true })
	refundPolicyVersion?: string | null;

	@Column({ name: 'pricing_policy_version', type: 'varchar', nullable: true })
	pricingPolicyVersion?: string | null;

	@Column({ type: 'varchar', default: 'pending' })
	status: 'pending' | 'paid' | 'cancelled' | 'refunded';

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	subtotal: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
	tax: number;

	@Column({ name: 'platform_fee', type: 'decimal', precision: 12, scale: 2, default: 0 })
	platformFee: number;

	@Column({ name: 'processing_fee', type: 'decimal', precision: 12, scale: 2, default: 0 })
	processingFee: number;

	@Column({ name: 'organizer_net', type: 'decimal', precision: 12, scale: 2, default: 0 })
	organizerNet: number;

	@Column({ name: 'fee_payer', type: 'varchar', default: 'buyer' })
	feePayer: 'buyer' | 'organizer' | 'mixed';

	@Column({ name: 'platform_fee_percent', type: 'decimal', precision: 8, scale: 5, default: 0 })
	platformFeePercent: number;

	@Column({ name: 'platform_fee_fixed', type: 'decimal', precision: 12, scale: 2, default: 0 })
	platformFeeFixed: number;

	@Column({ name: 'processing_fee_percent', type: 'decimal', precision: 8, scale: 5, default: 0 })
	processingFeePercent: number;

	@Column({ name: 'processing_fee_fixed', type: 'decimal', precision: 12, scale: 2, default: 0 })
	processingFeeFixed: number;

	@Column({ name: 'fee_snapshot', type: 'jsonb', nullable: true })
	feeSnapshot?: Record<string, unknown> | null;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	total: number;

	@Column({ default: 'USD' })
	currency: string;

	@Column({ name: 'stripe_checkout_session_id', type: 'varchar', unique: true, nullable: true })
	stripeCheckoutSessionId?: string | null;

	@Column({ name: 'stripe_payment_intent_id', type: 'varchar', nullable: true })
	stripePaymentIntentId?: string | null;

	@Column({ name: 'checkout_url', type: 'text', nullable: true })
	checkoutUrl?: string | null;

	@Column({ name: 'provider_payload', type: 'jsonb', nullable: true })
	providerPayload?: Record<string, unknown> | null;

	@Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
	paidAt?: Date | null;

	@OneToMany(() => TicketOrderItemEntity, (item) => item.order, {
		cascade: true,
		eager: true,
	})
	items: TicketOrderItemEntity[];

	@OneToMany(() => IssuedTicketEntity, (ticket) => ticket.order, {
		cascade: true,
		eager: true,
	})
	tickets: IssuedTicketEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
