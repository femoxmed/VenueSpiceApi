import {
	Index,
	Column,
	CreateDateColumn,
	Entity,
	ManyToOne,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { EventPrivateAccessTokenEntity } from './event-private-access-token.entity';
import { TicketTypeEntity } from './ticket-type.entity';

@Entity('events')
@Index('analytics_events_created_idx', ['createdAt', 'organization'])
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

	@Column({ name: 'venue_postal_code', type: 'varchar', nullable: true })
	venuePostalCode?: string | null;

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

	@Column({ name: 'faqs', type: 'jsonb', default: () => "'[]'" })
	faqs: Array<{ question: string; answer: string }>;

	@Column({ type: 'varchar', default: 'draft' })
	status: 'draft' | 'published' | 'cancelled' | 'archived';

	@Column({ type: 'varchar', default: 'public' })
	visibility: 'public' | 'private';

	@Column({ name: 'private_access_token', type: 'varchar', nullable: true })
	privateAccessToken?: string | null;

	@Column({ name: 'private_access_token_hash', type: 'varchar', nullable: true })
	privateAccessTokenHash?: string | null;

	@Column({ name: 'access_code_hash', type: 'varchar', nullable: true })
	accessCodeHash?: string | null;

	@Column({ name: 'access_code_updated_at', type: 'timestamptz', nullable: true })
	accessCodeUpdatedAt?: Date | null;

	@Column({ name: 'refund_cutoff_hours', type: 'int', default: 24 })
	refundCutoffHours: number;

	@Column({ name: 'refunds_allowed', type: 'boolean', default: true })
	refundsAllowed: boolean;

	@Column({ name: 'refundable_percentage', type: 'int', default: 100 })
	refundablePercentage: number;

	@Column({ name: 'tax_collection_mode', type: 'varchar', default: 'none' })
	taxCollectionMode: 'stripe_tax' | 'organizer_manual' | 'none';

	@Column({ name: 'tax_responsibility', type: 'varchar', default: 'organizer' })
	taxResponsibility: 'venue_spice' | 'organizer';

	@Column({ name: 'organizer_tax_rate', type: 'decimal', precision: 8, scale: 5, default: 0 })
	organizerTaxRate: number;

	@Column({ name: 'organizer_tax_label', type: 'varchar', nullable: true })
	organizerTaxLabel?: string | null;

	@Column({ name: 'organizer_tax_permit_confirmed', type: 'boolean', default: false })
	organizerTaxPermitConfirmed: boolean;

	@Column({ name: 'organizer_tax_consent_at', type: 'timestamptz', nullable: true })
	organizerTaxConsentAt?: Date | null;

	@Column({ name: 'organizer_tax_consent_text', type: 'text', nullable: true })
	organizerTaxConsentText?: string | null;

	@Column({ name: 'venue_address_tax_confirmed', type: 'boolean', default: false })
	venueAddressTaxConfirmed: boolean;

	@Column({ name: 'venue_address_tax_confirmed_at', type: 'timestamptz', nullable: true })
	venueAddressTaxConfirmedAt?: Date | null;

	@Column({ name: 'venue_address_tax_consent_text', type: 'text', nullable: true })
	venueAddressTaxConsentText?: string | null;

	@Column({ name: 'tax_code', type: 'varchar', nullable: true })
	taxCode?: string | null;

	@OneToMany(() => TicketTypeEntity, (ticketType) => ticketType.event, {
		cascade: true,
		eager: true,
	})
	ticketTypes: TicketTypeEntity[];

	@OneToMany(() => EventPrivateAccessTokenEntity, (token) => token.event, {
		cascade: true,
	})
	privateAccessTokens: EventPrivateAccessTokenEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
