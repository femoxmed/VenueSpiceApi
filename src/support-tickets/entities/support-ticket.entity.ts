import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
	JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { SupportTicketMessageEntity } from './support-ticket-message.entity';
import { ServiceBookingEntity } from '../../service-bookings/entities/service-booking.entity';
import { ProductEntity } from '../../products/entities/product.entity';

export enum TicketPriority {
	LOW = 'low',
	MEDIUM = 'medium',
	HIGH = 'high',
	URGENT = 'urgent',
}

export enum TicketCategory {
	TECHNICAL = 'technical',
	BILLING = 'billing',
	ORDER = 'order',
	INSTALLATION = 'installation',
	GENERAL = 'general',
}

@Entity('support_tickets')
export class SupportTicketEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => UserEntity, { eager: true, onDelete: 'CASCADE' })
	customer: UserEntity;

	@Column()
	subject: string;

	@Column({ type: 'text' })
	description: string;

	@Column({ default: 'open' })
	status: string;

	@Column({
		type: 'enum',
		enum: TicketPriority,
		default: TicketPriority.MEDIUM,
	})
	priority: TicketPriority;

	@Column({
		type: 'enum',
		enum: TicketCategory,
		default: TicketCategory.GENERAL,
	})
	category: TicketCategory;

	@Column({ name: 'assigned_to', nullable: true })
	assignedTo?: string;

	@ManyToOne(() => UserEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	assignedUser: UserEntity | null;

	@ManyToOne(() => ServiceBookingEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'request_id' })
	request?: ServiceBookingEntity | null;

	@ManyToOne(() => ProductEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'product_id' })
	product?: ProductEntity | null;

	@Column({ name: 'email_thread_id', type: 'varchar', nullable: true })
	emailThreadId?: string | null;

	@Column({ name: 'chat_thread_id', type: 'varchar', nullable: true })
	chatThreadId?: string | null;

	@OneToMany(() => SupportTicketMessageEntity, (message) => message.ticket)
	messages: SupportTicketMessageEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
