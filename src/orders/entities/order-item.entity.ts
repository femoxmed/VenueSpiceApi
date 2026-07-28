import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { OrderEntity } from './order.entity';
import { ProductEntity } from '../../products/entities/product.entity';

@Entity('order_items')
export class OrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, (order) => order.items, { onDelete: 'CASCADE' })
  order: OrderEntity;

  @ManyToOne(() => ProductEntity, (product) => product.orderItems, { eager: true, onDelete: 'RESTRICT' })
  product: ProductEntity;

  @Column({ type: 'int' })
  qty: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice: number;

  @Column({ type: 'jsonb', nullable: true })
  variant?: {
    id?: string;
    label?: string;
    value?: string;
    imageUrl?: string;
  } | null;

  @Column({ name: 'delivered_at', type: 'date', nullable: true })
  deliveredAt?: string | null;

  @Column({ name: 'activated_at', type: 'date', nullable: true })
  activatedAt?: string | null;

  @Column({ name: 'installed_at', type: 'date', nullable: true })
  installedAt?: string | null;

  @Column({ name: 'installer_name', type: 'varchar', nullable: true })
  installerName?: string | null;

  @Column({ name: 'warranty_months', type: 'int', default: 12 })
  warrantyMonths: number;

  @Column({ name: 'warranty_expires_at', type: 'date', nullable: true })
  warrantyExpiresAt?: string | null;

  @Column({ name: 'maintenance_required', type: 'boolean', default: false })
  maintenanceRequired: boolean;

  @Column({ name: 'maintenance_status', type: 'varchar', default: 'not_required' })
  maintenanceStatus: string;

  @Column({ name: 'next_maintenance_date', type: 'date', nullable: true })
  nextMaintenanceDate?: string | null;

  @Column({ name: 'device_serial', type: 'varchar', nullable: true })
  deviceSerial?: string | null;
}
