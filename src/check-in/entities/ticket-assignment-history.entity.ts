import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
} from 'typeorm';
import { EventEntity } from '../../events/entities/event.entity';
import { IssuedTicketEntity } from '../../ticket-orders/entities/issued-ticket.entity';

@Entity('ticket_assignment_history')
export class TicketAssignmentHistoryEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => IssuedTicketEntity, { onDelete: 'CASCADE' })
	ticket: IssuedTicketEntity;

	@ManyToOne(() => EventEntity, { onDelete: 'CASCADE' })
	event: EventEntity;

	@Column({ name: 'order_id', type: 'uuid', nullable: true })
	orderId?: string | null;

	@Column({ name: 'previous_holder_name' })
	previousHolderName: string;

	@Column({ name: 'previous_holder_email' })
	previousHolderEmail: string;

	@Column({ name: 'new_holder_name' })
	newHolderName: string;

	@Column({ name: 'new_holder_email' })
	newHolderEmail: string;

	@Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
	changedByUserId?: string | null;

	@Column({ name: 'changed_by_email', type: 'varchar', nullable: true })
	changedByEmail?: string | null;

	@Column({ type: 'text', nullable: true })
	note?: string | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;
}
