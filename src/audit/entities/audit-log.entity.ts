import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLogEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'user_id', nullable: true })
	userId?: string;

	@Column({ name: 'user_email', nullable: true })
	userEmail?: string;

	@Column({ name: 'user_role', nullable: true })
	userRole?: string;

	@Column()
	action: string;

	@Column({ name: 'entity_type', nullable: true })
	entityType?: string;

	@Column({ name: 'entity_id', nullable: true })
	entityId?: string;

	@Column({ type: 'jsonb', nullable: true })
	changes?: Record<string, unknown>;

	@Column({ type: 'jsonb', nullable: true })
	metadata?: Record<string, unknown>;

	@Column({ name: 'ip_address', nullable: true })
	ipAddress?: string;

	@Column({ name: 'user_agent', nullable: true })
	userAgent?: string;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;
}
