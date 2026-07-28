import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { ServiceTypeEntity } from '../../service-types/entities/service-type.entity';
import { InvoiceEntity } from '../../invoices/entities/invoice.entity';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';

@Entity('service_bookings')
export class ServiceBookingEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => UserEntity, (user) => user.serviceBookings, {
		eager: true,
		onDelete: 'CASCADE',
	})
	user: UserEntity;

	@ManyToOne(() => UserEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	technician?: UserEntity | null;

	@ManyToOne(() => ServiceTypeEntity, { eager: true, onDelete: 'RESTRICT' })
	serviceType: ServiceTypeEntity;

	@ManyToOne(() => InvoiceEntity, (invoice) => invoice.serviceBooking, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	invoice?: InvoiceEntity | null;

	@ManyToOne(() => OrderItemEntity, {
		eager: true,
		nullable: true,
		onDelete: 'SET NULL',
	})
	paidItem?: OrderItemEntity | null;

	@Column({ name: 'preferred_date', type: 'date' })
	preferredDate: string;

	@Column()
	status: string;

	@Column({ type: 'text' })
	issue: string;

	@Column({ name: 'billing_mode', default: 'fixed' })
	billingMode: string;

	@Column({
		name: 'price',
		type: 'decimal',
		precision: 12,
		scale: 2,
		default: 0,
	})
	price: number;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
