import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { TicketOrderEntity } from '../../ticket-orders/entities/ticket-order.entity';
import { UserEntity } from '../../auth/entities/user.entity';

@Entity('refund_requests')
export class RefundRequestEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => TicketOrderEntity, { eager: true, onDelete: 'CASCADE' })
	order: TicketOrderEntity;

	@Column({ name: 'order_id' })
	orderId: string;

	@Column({ name: 'customer_email' })
	customerEmail: string;

	@Column({ type: 'text', nullable: true })
	reason?: string | null;

	@Column({ type: 'varchar', default: 'requested' })
	status: 'requested' | 'approved' | 'processing' | 'succeeded' | 'declined' | 'failed';

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount: number;

	@Column({ default: 'USD' })
	currency: string;

	@Column({ name: 'stripe_refund_id', type: 'varchar', nullable: true })
	stripeRefundId?: string | null;

	@Column({ name: 'provider_payload', type: 'jsonb', nullable: true })
	providerPayload?: Record<string, unknown> | null;

	@ManyToOne(() => UserEntity, { eager: true, nullable: true, onDelete: 'SET NULL' })
	reviewedBy?: UserEntity | null;

	@Column({ name: 'reviewed_by_id', type: 'varchar', nullable: true })
	reviewedById?: string | null;

	@Column({ name: 'review_note', type: 'text', nullable: true })
	reviewNote?: string | null;

	@Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
	reviewedAt?: Date | null;

	@Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
	completedAt?: Date | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
