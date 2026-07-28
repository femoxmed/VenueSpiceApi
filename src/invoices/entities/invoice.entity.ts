import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { ServiceBookingEntity } from '../../service-bookings/entities/service-booking.entity';
import { InvoiceItemEntity } from './invoice-item.entity';

@Entity('invoices')
export class InvoiceEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'invoice_number', unique: true })
	invoiceNumber: string;

	@ManyToOne(() => UserEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	user?: UserEntity | null;

	@ManyToOne(() => OrderEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	order?: OrderEntity | null;

	@ManyToOne(() => ServiceBookingEntity, {
		nullable: true,
		onDelete: 'SET NULL',
	})
	serviceBooking?: ServiceBookingEntity | null;

	@Column({ default: 'pending' })
	status: string;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	subtotal: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
	tax: number;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	total: number;

	@Column({ name: 'issued_at', type: 'timestamptz' })
	issuedAt: Date;

	@Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
	lastSentAt?: Date | null;

	@Column({ name: 'last_sent_to', type: 'varchar', nullable: true })
	lastSentTo?: string | null;

	@Column({ name: 'send_count', default: 0 })
	sendCount: number;

	@OneToMany(() => InvoiceItemEntity, (item) => item.invoice, {
		cascade: true,
		eager: true,
	})
	items: InvoiceItemEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;
}
