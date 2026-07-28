import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { EventEntity } from './event.entity';

@Entity('ticket_types')
export class TicketTypeEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => EventEntity, (event) => event.ticketTypes, {
		onDelete: 'CASCADE',
	})
	event: EventEntity;

	@Column()
	name: string;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	price: number;

	@Column({ type: 'int' })
	quantity: number;

	@Column({ name: 'limit_per_person', type: 'int', nullable: true })
	limitPerPerson?: number | null;

	@Column({ type: 'text', nullable: true })
	description?: string | null;

	@Column({ name: 'include_charges', type: 'boolean', default: false })
	includeCharges: boolean;

	@Column({ name: 'quantity_sold', type: 'int', default: 0 })
	quantitySold: number;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'paused' | 'sold_out';
}
