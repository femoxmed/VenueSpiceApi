import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { InvoiceEntity } from './invoice.entity';

@Entity('invoice_items')
export class InvoiceItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => InvoiceEntity, (invoice) => invoice.items, { onDelete: 'CASCADE' })
  invoice: InvoiceEntity;

  @Column()
  description: string;

  @Column({ type: 'int' })
  qty: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  lineTotal: number;
}
