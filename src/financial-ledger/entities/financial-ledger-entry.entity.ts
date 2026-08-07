import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { EventEntity } from '../../events/entities/event.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { TicketOrderEntity } from '../../ticket-orders/entities/ticket-order.entity';

export type FinancialLedgerEntryType =
	| 'gross_sale'
	| 'tax'
	| 'platform_fee'
	| 'processing_fee'
	| 'influencer_commission'
	| 'organizer_net'
	| 'refund'
	| 'payout';

export type FinancialLedgerEntryStatus =
	| 'pending'
	| 'available'
	| 'paid_out'
	| 'reversed';

@Entity('financial_ledger_entries')
export class FinancialLedgerEntryEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index({ unique: true })
	@Column({ name: 'idempotency_key' })
	idempotencyKey: string;

	@ManyToOne(() => OrganizationEntity, { eager: true, onDelete: 'RESTRICT' })
	organization: OrganizationEntity;

	@ManyToOne(() => EventEntity, { eager: true, nullable: true, onDelete: 'SET NULL' })
	event?: EventEntity | null;

	@ManyToOne(() => TicketOrderEntity, { eager: true, nullable: true, onDelete: 'SET NULL' })
	order?: TicketOrderEntity | null;

	@Column({ type: 'varchar' })
	type: FinancialLedgerEntryType;

	@Column({ type: 'varchar', default: 'pending' })
	status: FinancialLedgerEntryStatus;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount: number;

	@Column({ default: 'USD' })
	currency: string;

	@Column({ name: 'available_at', type: 'timestamptz', nullable: true })
	availableAt?: Date | null;

	@Column({ name: 'paid_out_at', type: 'timestamptz', nullable: true })
	paidOutAt?: Date | null;

	@Column({ type: 'jsonb', nullable: true })
	metadata?: Record<string, unknown> | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
