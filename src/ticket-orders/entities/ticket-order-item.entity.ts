import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TicketTypeEntity } from '../../events/entities/ticket-type.entity';
import { TicketOrderEntity } from './ticket-order.entity';

@Entity('ticket_order_items')
export class TicketOrderItemEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => TicketOrderEntity, (order) => order.items, {
		onDelete: 'CASCADE',
	})
	order: TicketOrderEntity;

	@ManyToOne(() => TicketTypeEntity, { eager: true, onDelete: 'RESTRICT' })
	ticketType: TicketTypeEntity;

	@Column({ name: 'ticket_name' })
	ticketName: string;

	@Column({ type: 'int' })
	quantity: number;

	@Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2 })
	unitPrice: number;

	@Column({ name: 'line_total', type: 'decimal', precision: 12, scale: 2 })
	lineTotal: number;

	@Column({ name: 'attendee_details', type: 'jsonb', nullable: true })
	attendeeDetails?: Array<{ name: string; email: string }> | null;
}
