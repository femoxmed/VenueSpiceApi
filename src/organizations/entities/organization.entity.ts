import {
	Column,
	CreateDateColumn,
	Entity,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';
import { EventEntity } from '../../events/entities/event.entity';
import { AgentEntity } from '../../agents/entities/agent.entity';

@Entity('organizations')
export class OrganizationEntity {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column()
	name: string;

	@Column({ unique: true })
	slug: string;

	@Column({ type: 'varchar', default: 'active' })
	status: 'active' | 'suspended' | 'archived';

	@Column({ type: 'varchar', default: 'organization' })
	type: 'vendor' | 'organization' | 'influencer';

	@Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
	ownerUserId?: string | null;

	@Column({ name: 'contact_email', type: 'varchar', nullable: true })
	contactEmail?: string | null;

	@Column({ name: 'contact_phone', type: 'varchar', nullable: true })
	contactPhone?: string | null;

	@Column({ name: 'business_category', type: 'varchar', nullable: true })
	businessCategory?: string | null;

	@Column({ name: 'logo_url', type: 'varchar', nullable: true })
	logoUrl?: string | null;

	@Column({ name: 'website', type: 'varchar', nullable: true })
	website?: string | null;

	@Column({ type: 'varchar', nullable: true })
	country?: string | null;

	@Column({ name: 'postal_code', type: 'varchar', nullable: true })
	postalCode?: string | null;

	@Column({ name: 'state_province', type: 'varchar', nullable: true })
	stateProvince?: string | null;

	@Column({ name: 'legal_business_name', type: 'varchar', nullable: true })
	legalBusinessName?: string | null;

	@Column({ name: 'business_role', type: 'varchar', nullable: true })
	businessRole?: string | null;

	@Column({ name: 'business_email', type: 'varchar', nullable: true })
	businessEmail?: string | null;

	@Column({ name: 'business_phone', type: 'varchar', nullable: true })
	businessPhone?: string | null;

	@Column({ name: 'ein_registered', type: 'boolean', default: false })
	einRegistered: boolean;

	@Column({ name: 'ein_registration_number', type: 'varchar', nullable: true })
	einRegistrationNumber?: string | null;

	@Column({ name: 'cover_image_urls', type: 'jsonb', nullable: true })
	coverImageUrls?: string[] | null;

	@Column({ name: 'terms_accepted_at', type: 'timestamptz', nullable: true })
	termsAcceptedAt?: Date | null;

	@Column({ name: 'vendor_profile_completed_at', type: 'timestamptz', nullable: true })
	vendorProfileCompletedAt?: Date | null;

	@Column({ name: 'influencer_platform', type: 'varchar', nullable: true })
	influencerPlatform?: string | null;

	@Column({ name: 'influencer_handle', type: 'varchar', nullable: true })
	influencerHandle?: string | null;

	@Column({ name: 'influencer_profile_url', type: 'varchar', nullable: true })
	influencerProfileUrl?: string | null;

	@Column({ name: 'influencer_niche', type: 'varchar', nullable: true })
	influencerNiche?: string | null;

	@Column({ name: 'influencer_audience_size', type: 'int', nullable: true })
	influencerAudienceSize?: number | null;

	@Column({ name: 'influencer_engagement_rate', type: 'decimal', precision: 5, scale: 2, nullable: true })
	influencerEngagementRate?: number | null;

	@Column({ type: 'text', nullable: true })
	description?: string | null;

	@Column({ name: 'stripe_account_id', type: 'varchar', nullable: true })
	stripeAccountId?: string | null;

	@Column({ name: 'stripe_account_type', type: 'varchar', nullable: true })
	stripeAccountType?: 'express' | 'custom' | 'standard' | null;

	@Column({ name: 'stripe_charges_enabled', type: 'boolean', default: false })
	stripeChargesEnabled: boolean;

	@Column({ name: 'stripe_payouts_enabled', type: 'boolean', default: false })
	stripePayoutsEnabled: boolean;

	@Column({ name: 'stripe_details_submitted', type: 'boolean', default: false })
	stripeDetailsSubmitted: boolean;

	@Column({ name: 'stripe_onboarding_completed_at', type: 'timestamp', nullable: true })
	stripeOnboardingCompletedAt?: Date | null;

	@Column({ name: 'stripe_mock_onboarding_data', type: 'jsonb', nullable: true })
	stripeMockOnboardingData?: Record<string, unknown> | null;

	@Column({ name: 'refund_policy', type: 'text', nullable: true })
	refundPolicy?: string | null;

	@OneToMany(() => EventEntity, (event) => event.organization)
	events: EventEntity[];

	@OneToMany(() => AgentEntity, (agent) => agent.organization)
	agents: AgentEntity[];

	@CreateDateColumn({ name: 'created_at' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at' })
	updatedAt: Date;
}
