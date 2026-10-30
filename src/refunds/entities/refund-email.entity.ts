import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Transactional outbox. Stable IDs also deduplicate jobs after a queue/database interruption.
@Entity('refund_email_outbox')
export class RefundEmailEntity {
 @PrimaryColumn() id: string;
 @Column() recipient: string;
 @Column() subject: string;
 @Column({type:'text'}) html: string;
 @Column({name:'queued_at',type:'timestamptz',nullable:true}) queuedAt?: Date | null;
 @CreateDateColumn({name:'created_at'}) createdAt: Date;
}
