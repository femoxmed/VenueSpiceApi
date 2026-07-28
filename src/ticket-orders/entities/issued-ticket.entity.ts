import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
} from 'typeorm';
import { EventEntity } from '../../events/entities/event.entity';
import { TicketTypeEntity } from '../../events/entities/ticket-type.entity';
import { TicketOrderEntity } from './ticket-order.entity';

@Entity('issued_tickets')
export class IssuedTicketEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => TicketOrderEntity, (order) => order.tickets, {
		onDelete: 'CASCADE',
	})
	order: TicketOrderEntity;

	@ManyToOne(() => EventEntity, { eager: true, onDelete: 'RESTRICT' })
	event: EventEntity;

	@ManyToOne(() => TicketTypeEntity, { eager: true, onDelete: 'RESTRICT' })
	ticketType: TicketTypeEntity;

	@Column({ unique: true })
	code: string;

	@Column({ name: 'holder_name' })
	holderName: string;

	@Column({ name: 'holder_email' })
	holderEmail: string;

	@Column({ type: 'varchar', default: 'valid' })
	status: 'valid' | 'checked_in' | 'void' | 'refunded';

	@Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
	checkedInAt?: Date | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;
}
