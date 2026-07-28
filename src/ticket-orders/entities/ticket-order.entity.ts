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

	@Column({ type: 'varchar', default: 'pending' })
	status: 'pending' | 'paid' | 'cancelled' | 'refunded';

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	subtotal: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
	tax: number;

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
