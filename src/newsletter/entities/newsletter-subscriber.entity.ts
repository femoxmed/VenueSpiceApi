import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('newsletter_subscribers')
@Index(['email'], { unique: true })
export class NewsletterSubscriberEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column()
	email: string;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'unsubscribed';

	@Column({ type: 'varchar', nullable: true })
	source?: string | null;

	@Column({ name: 'subscribed_at', type: 'timestamptz' })
	subscribedAt: Date;

	@Column({ name: 'unsubscribed_at', type: 'timestamptz', nullable: true })
	unsubscribedAt?: Date | null;

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
