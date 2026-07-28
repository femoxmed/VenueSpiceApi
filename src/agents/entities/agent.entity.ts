import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { ReferralCodeEntity } from './referral-code.entity';

@Entity('agents')
export class AgentEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => OrganizationEntity, (organization) => organization.agents, {
		eager: true,
		onDelete: 'CASCADE',
	})
	organization: OrganizationEntity;

	@ManyToOne(() => UserEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	user?: UserEntity | null;

	@Column({ name: 'full_name' })
	fullName: string;

	@Column()
	email: string;

	@Column({ type: 'varchar', nullable: true })
	phone?: string | null;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'paused' | 'pending_invite' | 'archived';

	@OneToMany(() => ReferralCodeEntity, (code) => code.agent, {
		cascade: true,
		eager: true,
	})
	referralCodes: ReferralCodeEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
