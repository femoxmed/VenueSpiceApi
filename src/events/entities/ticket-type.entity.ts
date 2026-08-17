import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { EventEntity } from './event.entity';

export type TicketAdmissionType = 'single' | 'group';

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

	@Column({ name: 'admission_type', type: 'varchar', default: 'single' })
	admissionType: TicketAdmissionType;

	@Column({ name: 'group_size', type: 'int', nullable: true })
	groupSize?: number | null;

	@Column({ name: 'collect_group_attendee_details', type: 'boolean', default: false })
	collectGroupAttendeeDetails: boolean;

	@Column({ name: 'attendee_details_required', type: 'boolean', default: false })
	attendeeDetailsRequired: boolean;

	@Column({ name: 'sales_start_at', type: 'timestamptz', nullable: true })
	salesStartAt?: Date | null;

	@Column({ name: 'sales_end_at', type: 'timestamptz', nullable: true })
	salesEndAt?: Date | null;

	@Column({ type: 'text', nullable: true })
	description?: string | null;

	@Column({ name: 'include_charges', type: 'boolean', default: false })
	includeCharges: boolean;

	@Column({ name: 'quantity_sold', type: 'int', default: 0 })
	quantitySold: number;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'paused' | 'sold_out';
}
