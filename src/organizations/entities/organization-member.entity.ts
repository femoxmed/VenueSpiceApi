import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { Role } from '../../common/enums/role.enum';
import { OrganizationEntity } from './organization.entity';

@Entity('organization_members')
@Index(['organizationId', 'userId'], { unique: true })
export class OrganizationMemberEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'organization_id', type: 'uuid' })
	organizationId: string;

	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ type: 'enum', enum: Role, default: Role.ORG_STAFF })
	role: Role.ORG_ADMIN | Role.ORG_STAFF;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'inactive';

	@ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'organization_id' })
	organization: OrganizationEntity;

	@ManyToOne(() => UserEntity, { eager: true, onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: UserEntity;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
