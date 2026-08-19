import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { EventEntity } from './event.entity';

@Entity('event_private_access_tokens')
export class EventPrivateAccessTokenEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => EventEntity, (event) => event.privateAccessTokens, {
		onDelete: 'CASCADE',
	})
	event: EventEntity;

	@Index()
	@Column({ name: 'token_hash', type: 'varchar' })
	tokenHash: string;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'revoked';

	@Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
	createdByUserId?: string | null;

	@Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
	revokedByUserId?: string | null;

	@Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
	lastUsedAt?: Date | null;

	@Column({ name: 'use_count', type: 'int', default: 0 })
	useCount: number;

	@Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
	revokedAt?: Date | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
