import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrderItemEntity } from './order-item.entity';

@Entity('orders')
export class OrderEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => UserEntity, (user) => user.orders, {
		eager: true,
		onDelete: 'CASCADE',
	})
	user: UserEntity;

	@Column({ type: 'varchar' })
	status: string;

	@Column({
		name: 'idempotency_key',
		type: 'varchar',
		nullable: true,
		unique: true,
	})
	idempotencyKey?: string | null;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	total: number;

	@Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
	tax: number;

	@Column({ name: 'delivery_fee', type: 'decimal', precision: 12, scale: 2, default: 0 })
	deliveryFee: number;

	@Column({ name: 'checkout_details', type: 'jsonb', nullable: true })
	checkoutDetails?: Record<string, unknown> | null;

	@OneToMany(() => OrderItemEntity, (item) => item.order, {
		cascade: true,
		eager: true,
	})
	items: OrderItemEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;
}
