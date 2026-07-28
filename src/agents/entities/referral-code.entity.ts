import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AgentEntity } from './agent.entity';
import { EventEntity } from '../../events/entities/event.entity';

@Entity('referral_codes')
export class ReferralCodeEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => AgentEntity, (agent) => agent.referralCodes, {
		onDelete: 'CASCADE',
	})
	agent: AgentEntity;

	@ManyToOne(() => EventEntity, { eager: true, nullable: true, onDelete: 'CASCADE' })
	event?: EventEntity | null;

	@Column({ unique: true })
	code: string;

	@Column({ name: 'uses_count', type: 'int', default: 0 })
	usesCount: number;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'paused' | 'archived';
}
