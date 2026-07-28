import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { AgentEntity } from '../../agents/entities/agent.entity';
import { EventEntity } from '../../events/entities/event.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';

@Entity('discount_coupons')
export class DiscountCouponEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => OrganizationEntity, { eager: true, onDelete: 'CASCADE' })
	organization: OrganizationEntity;

	@ManyToOne(() => EventEntity, { eager: true, nullable: true, onDelete: 'CASCADE' })
	event?: EventEntity | null;

	@ManyToOne(() => AgentEntity, { eager: true, nullable: true, onDelete: 'SET NULL' })
	agent?: AgentEntity | null;

	@Column({ unique: true })
	code: string;

	@Column({ type: 'varchar', default: 'percentage' })
	type: 'percentage' | 'fixed';

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	value: number;

	@Column({ name: 'influencer_commission_percent', type: 'decimal', precision: 5, scale: 2, default: 0 })
	influencerCommissionPercent: number;

	@Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
	startsAt?: Date | null;

	@Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
	endsAt?: Date | null;

	@Column({ name: 'uses_count', type: 'int', default: 0 })
	usesCount: number;

	@Column({ name: 'max_uses', type: 'int', nullable: true })
	maxUses?: number | null;

	@Column({ type: 'varchar', default: 'pending_influencer_approval' })
	status:
		| 'pending_influencer_signup'
		| 'pending_influencer_approval'
		| 'active'
		| 'declined'
		| 'paused'
		| 'expired'
		| 'archived';

	@Column({ name: 'approved_by_influencer_at', type: 'timestamptz', nullable: true })
	approvedByInfluencerAt?: Date | null;

	@Column({ name: 'declined_by_influencer_at', type: 'timestamptz', nullable: true })
	declinedByInfluencerAt?: Date | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
