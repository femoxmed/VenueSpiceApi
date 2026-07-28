import {
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { TicketTypeEntity } from './ticket-type.entity';

@Entity('events')
export class EventEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => OrganizationEntity, (organization) => organization.events, {
		eager: true,
		onDelete: 'CASCADE',
	})
	organization: OrganizationEntity;

	@Column()
	title: string;

	@Column({ unique: true })
	slug: string;

	@Column({ type: 'text', nullable: true })
	description?: string | null;

	@Column({ type: 'varchar', nullable: true })
	category?: string | null;

	@Column({ name: 'organizer_name', type: 'varchar', nullable: true })
	organizerName?: string | null;

	@Column({ type: 'varchar', nullable: true })
	venue?: string | null;

	@Column({ type: 'varchar', nullable: true })
	country?: string | null;

	@Column({ type: 'varchar', nullable: true })
	city?: string | null;

	@Column({ type: 'varchar', nullable: true })
	state?: string | null;

	@Column({ name: 'street_address', type: 'varchar', nullable: true })
	streetAddress?: string | null;

	@Column({ name: 'timezone', type: 'varchar', nullable: true })
	timezone?: string | null;

	@Column({ name: 'is_virtual', type: 'boolean', default: false })
	isVirtual: boolean;

	@Column({ name: 'starts_at', type: 'timestamptz' })
	startsAt: Date;

	@Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
	endsAt?: Date | null;

	@Column({ name: 'cover_image_url', type: 'text', nullable: true })
	coverImageUrl?: string | null;

	@Column({ name: 'image_urls', type: 'jsonb', default: () => "'[]'" })
	imageUrls: string[];

	@Column({ name: 'social_links', type: 'jsonb', default: () => "'{}'" })
	socialLinks: Record<string, string>;

	@Column({ name: 'appearances', type: 'jsonb', default: () => "'[]'" })
	appearances: Array<Record<string, unknown>>;

	@Column({ name: 'add_ons', type: 'jsonb', default: () => "'[]'" })
	addOns: Array<Record<string, unknown>>;

	@Column({ type: 'varchar', default: 'draft' })
	status: 'draft' | 'published' | 'cancelled' | 'archived';

	@Column({ name: 'refund_cutoff_hours', type: 'int', default: 24 })
	refundCutoffHours: number;

	@OneToMany(() => TicketTypeEntity, (ticketType) => ticketType.event, {
		cascade: true,
		eager: true,
	})
	ticketTypes: TicketTypeEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
