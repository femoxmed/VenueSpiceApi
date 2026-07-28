import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('service_types')
export class ServiceTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  code: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  basePrice: number;

  @Column({ name: 'billing_mode', default: 'fixed' })
  billingMode: string;

  @Column({ name: 'requires_technician', default: true })
  requiresTechnician: boolean;

  @Column({ name: 'estimated_duration_minutes', type: 'int', default: 60 })
  estimatedDurationMinutes: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
