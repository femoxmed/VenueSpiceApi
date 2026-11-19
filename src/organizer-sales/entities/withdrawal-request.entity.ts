import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';

export type WithdrawalRequestStatus =
	| 'pending_review'
	| 'approved'
	| 'processing'
	| 'paid'
	| 'rejected'
	| 'failed'
	| 'cancelled';
export type WithdrawalRequestType = 'normal' | 'early' | 'instant';

@Entity('withdrawal_requests')
export class WithdrawalRequestEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => OrganizationEntity, { eager: true, onDelete: 'RESTRICT' })
	organization: OrganizationEntity;

	@Index()
	@Column({ type: 'varchar', default: 'pending_review' })
	status: WithdrawalRequestStatus;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount: number;

	@Column({ name: 'withdrawal_type', type: 'varchar', default: 'normal' })
	withdrawalType: WithdrawalRequestType;

	@Column({ name: 'fee_percent', type: 'decimal', precision: 8, scale: 6, default: 0 })
	feePercent: number;

	@Column({ name: 'fee_amount', type: 'decimal', precision: 12, scale: 2, default: 0 })
	feeAmount: number;

	@Column({ name: 'net_amount', type: 'decimal', precision: 12, scale: 2, nullable: true })
	netAmount?: number | null;

	@Column({ name: 'fee_snapshot', type: 'jsonb', nullable: true })
	feeSnapshot?: Record<string, unknown> | null;

	@Column({ type: 'varchar', default: 'USD' })
	currency: string;

	@Column({ name: 'available_balance_snapshot', type: 'decimal', precision: 12, scale: 2, default: 0 })
	availableBalanceSnapshot: number;

	@Column({ name: 'stripe_account_id', type: 'varchar', nullable: true })
	stripeAccountId?: string | null;

	@Column({ name: 'requested_by_user_id', type: 'varchar', nullable: true })
	requestedByUserId?: string | null;

	@Column({ name: 'requested_by_email', type: 'varchar', nullable: true })
	requestedByEmail?: string | null;

	@Column({ name: 'reviewed_by_user_id', type: 'varchar', nullable: true })
	reviewedByUserId?: string | null;

	@Column({ name: 'reviewed_by_email', type: 'varchar', nullable: true })
	reviewedByEmail?: string | null;

	@Column({ name: 'requester_note', type: 'text', nullable: true })
	requesterNote?: string | null;

	@Column({ name: 'admin_note', type: 'text', nullable: true })
	adminNote?: string | null;

	@Column({ name: 'stripe_transfer_id', type: 'varchar', nullable: true })
	stripeTransferId?: string | null;

	@Column({ name: 'stripe_payout_id', type: 'varchar', nullable: true })
	stripePayoutId?: string | null;

	@Column({ name: 'source_entry_ids', type: 'jsonb', nullable: true })
	sourceEntryIds?: string[] | null;

	@Column({ type: 'jsonb', nullable: true })
	metadata?: Record<string, unknown> | null;

	@Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
	reviewedAt?: Date | null;

	@Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
	paidAt?: Date | null;

	@Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
	failedAt?: Date | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
