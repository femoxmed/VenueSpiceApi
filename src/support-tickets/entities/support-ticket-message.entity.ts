import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { SupportTicketEntity } from './support-ticket.entity';

export enum TicketMessageSource {
	APP = 'app',
	EMAIL = 'email',
	CHAT = 'chat',
	ADMIN = 'admin',
}

@Entity('support_ticket_messages')
export class SupportTicketMessageEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => SupportTicketEntity, {
		onDelete: 'CASCADE',
	})
	ticket: SupportTicketEntity;

	@ManyToOne(() => UserEntity, { eager: true, onDelete: 'CASCADE' })
	author: UserEntity;

	@Column({ type: 'text' })
	content: string;

	@Column({ name: 'is_internal_note', default: false })
	isInternalNote: boolean;

	@Column({ type: 'jsonb', nullable: true })
	attachments?: string[];

	@Column({
		type: 'enum',
		enum: TicketMessageSource,
		default: TicketMessageSource.APP,
	})
	source: TicketMessageSource;

	@Column({ name: 'external_message_id', type: 'varchar', nullable: true })
	externalMessageId?: string | null;

	@Column({ name: 'email_thread_id', type: 'varchar', nullable: true })
	emailThreadId?: string | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;
}
