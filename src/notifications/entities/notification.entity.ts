import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';

@Entity('notifications')
export class NotificationEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => UserEntity, { eager: true, onDelete: 'CASCADE' })
	user: UserEntity;

	@Column({ name: 'user_id' })
	userId: string;

	@Column({ type: 'varchar' })
	type: string;

	@Column({ type: 'varchar' })
	title: string;

	@Column({ type: 'text' })
	message: string;

	@Column({ name: 'action_url', type: 'text', nullable: true })
	actionUrl?: string | null;

	@Column({ type: 'jsonb', nullable: true })
	metadata?: Record<string, unknown> | null;

	@Column({ name: 'read_at', type: 'timestamptz', nullable: true })
	readAt?: Date | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
