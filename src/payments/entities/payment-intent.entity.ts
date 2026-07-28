import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { InvoiceEntity } from '../../invoices/entities/invoice.entity';
import { OrderEntity } from '../../orders/entities/order.entity';

@Entity('payment_intents')
export class PaymentIntentEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'idempotency_key', unique: true })
	idempotencyKey: string;

	@Column({ default: 'paystack' })
	provider: string;

	@Column({ default: 'pending' })
	status: string;

	@Column({ name: 'provider_status', type: 'varchar', nullable: true })
	providerStatus?: string | null;

	@Column({ name: 'provider_reference', unique: true })
	providerReference: string;

	@Column({ name: 'access_code', type: 'varchar', nullable: true })
	accessCode?: string | null;

	@Column({ name: 'authorization_url', nullable: true, type: 'text' })
	authorizationUrl?: string | null;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount: number;

	@Column({ default: 'NGN' })
	currency: string;

	@Column({ name: 'customer_email' })
	customerEmail: string;

	@ManyToOne(() => InvoiceEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	invoice?: InvoiceEntity | null;

	@ManyToOne(() => OrderEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	order?: OrderEntity | null;

	@Column({ name: 'provider_payload', type: 'jsonb', nullable: true })
	providerPayload?: Record<string, unknown> | null;

	@Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
	paidAt?: Date | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
