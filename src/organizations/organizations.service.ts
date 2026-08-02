import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationEntity } from './entities/organization.entity';
import { AuditService } from '../audit/audit.service';
import { Request } from 'express';

type MockStripeOnboardingDto = {
	businessType?: string;
	legalBusinessName?: string;
	businessWebsite?: string;
	businessMcc?: string;
	addressLine1?: string;
	city?: string;
	state?: string;
	postalCode?: string;
	country?: string;
	representativeFirstName?: string;
	representativeLastName?: string;
	representativeEmail?: string;
	representativePhone?: string;
	representativeDob?: string;
	taxIdLast4?: string;
	bankAccountHolderName?: string;
	bankRoutingLast4?: string;
	bankAccountLast4?: string;
	termsAccepted?: boolean;
};

@Injectable()
export class OrganizationsService {
	constructor(
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		private readonly configService: ConfigService,
		private readonly auditService: AuditService,
	) {}

	findAll() {
		return this.organizationsRepository.find({ order: { createdAt: 'DESC' } });
	}

	findMine(ownerUserId: string) {
		return this.organizationsRepository.find({
			where: { ownerUserId },
			order: { createdAt: 'DESC' },
		});
	}

	async findPublicVendors(filters: { query?: string; category?: string; location?: string } = {}) {
		const query = this.organizationsRepository
			.createQueryBuilder('organization')
			.where('organization.type = :type', { type: 'vendor' })
			.andWhere('organization.status = :status', { status: 'active' })
			.andWhere('organization.vendorProfileCompletedAt IS NOT NULL')
			.orderBy('organization.vendorProfileCompletedAt', 'DESC')
			.addOrderBy('organization.createdAt', 'DESC')
			.take(85);

		const search = filters.query?.trim();
		if (search) {
			query.andWhere(
				new Brackets((builder) => {
					builder
						.where('LOWER(organization.name) LIKE :search')
						.orWhere('LOWER(organization.businessCategory) LIKE :search')
						.orWhere('LOWER(organization.description) LIKE :search');
				}),
				{ search: `%${search.toLowerCase()}%` },
			);
		}

		const category = filters.category?.trim();
		if (category) {
			query.andWhere('LOWER(organization.businessCategory) LIKE :category', {
				category: `%${category.toLowerCase()}%`,
			});
		}

		const location = filters.location?.trim();
		if (location) {
			query.andWhere(
				new Brackets((builder) => {
					builder
						.where('LOWER(organization.country) LIKE :location')
						.orWhere('LOWER(organization.stateProvince) LIKE :location');
				}),
				{ location: `%${location.toLowerCase()}%` },
			);
		}

		return query.getMany();
	}

	async findPublicVendor(slugOrId: string) {
		const value = slugOrId.trim();
		const query = this.organizationsRepository
			.createQueryBuilder('organization')
			.where('organization.type = :type', { type: 'vendor' })
			.andWhere('organization.status = :status', { status: 'active' })
			.andWhere('organization.vendorProfileCompletedAt IS NOT NULL');

		if (this.isUuid(value)) {
			query.andWhere(
				new Brackets((builder) => {
					builder
						.where('organization.id = :value', { value })
						.orWhere('organization.slug = :value', { value });
				}),
			);
		} else {
			query.andWhere('organization.slug = :value', { value });
		}

		const organization = await query.getOne();
		if (!organization) throw new NotFoundException('Vendor not found');
		return organization;
	}

	async findOne(id: string) {
		const organization = await this.organizationsRepository.findOne({
			where: { id },
		});
		if (!organization) throw new NotFoundException('Organization not found');
		return organization;
	}

	async create(dto: CreateOrganizationDto, user?: { id: string; email?: string; role?: string }, request?: Request) {
		const slug = dto.slug || this.slugify(dto.name);
		const existing = await this.organizationsRepository.findOne({
			where: { slug },
		});
		if (existing) throw new BadRequestException('Organization slug already exists');

		const organization = await this.organizationsRepository.save(
			this.organizationsRepository.create({ ...dto, slug }),
		);
		await this.auditService.log(
			'organization.created',
			user,
			'organization',
			organization.id,
			{ after: this.pickOrganizationAuditFields(organization) },
			undefined,
			request,
		);
		return organization;
	}

	async update(id: string, dto: Partial<CreateOrganizationDto>, user?: { id: string; email?: string; role?: string }, request?: Request) {
		const organization = await this.findOne(id);
		if (user) {
			this.ensureOwnerOrAdmin(organization, user);
		}
		const before = this.pickOrganizationAuditFields(organization);
		if (dto.slug && dto.slug !== organization.slug) {
			const existing = await this.organizationsRepository.findOne({
				where: { slug: dto.slug },
			});
			if (existing) throw new BadRequestException('Organization slug already exists');
		}

		const { termsAccepted, ...updates } = dto;
		Object.assign(organization, updates);
		if (termsAccepted) {
			organization.termsAcceptedAt = organization.termsAcceptedAt ?? new Date();
		}
		if (organization.type === 'vendor' && this.hasCompletedVendorProfile(organization)) {
			organization.vendorProfileCompletedAt = organization.vendorProfileCompletedAt ?? new Date();
		}
		const saved = await this.organizationsRepository.save(organization);
		await this.auditService.log(
			'organization.updated',
			user,
			'organization',
			saved.id,
			this.buildChanges(before, this.pickOrganizationAuditFields(saved)),
			{ updatedFields: Object.keys(dto) },
			request,
		);
		return saved;
	}

	private pickOrganizationAuditFields(organization: OrganizationEntity) {
		return {
			name: organization.name,
			slug: organization.slug,
			type: organization.type,
			status: organization.status,
			contactEmail: organization.contactEmail,
			contactPhone: organization.contactPhone,
			businessCategory: organization.businessCategory,
			country: organization.country,
			stateProvince: organization.stateProvince,
			website: organization.website,
			vendorProfileCompletedAt: organization.vendorProfileCompletedAt,
		};
	}

	private buildChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
		const changes: Record<string, { before: unknown; after: unknown }> = {};
		Object.keys(after).forEach((key) => {
			if (before[key] !== after[key]) {
				changes[key] = { before: before[key], after: after[key] };
			}
		});
		return changes;
	}

	async createStripeConnectLink(
		id: string,
		user: { id: string; role?: string },
		returnUrl?: string,
	) {
		const organization = await this.findOne(id);
		this.ensureOwnerOrAdmin(organization, user);
		const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
		if (!secretKey) {
			throw new BadRequestException('Stripe secret key is not configured');
		}

		if (!organization.stripeAccountId) {
			await this.createAndAttachStripeExpressAccount(organization, secretKey);
		} else {
			const accountExists = await this.stripeAccountBelongsToCurrentPlatform(
				organization.stripeAccountId,
				secretKey,
			);
			if (!accountExists) {
				await this.createAndAttachStripeExpressAccount(organization, secretKey);
			}
		}

		const appUrl = this.configService.get<string>('WEB_APP_URL', 'http://localhost:3000');
		const redirectUrl = returnUrl || `${appUrl}/dashboard?stripe=return&organizationId=${organization.id}`;
		const refreshUrl = `${appUrl}/dashboard?stripe=refresh&organizationId=${organization.id}`;
		const stripeAccountId = organization.stripeAccountId;
		if (!stripeAccountId) {
			throw new BadRequestException('Stripe account could not be created');
		}
		const accountLink = await this.createStripeAccountLink(
			stripeAccountId,
			redirectUrl,
			refreshUrl,
			secretKey,
		);
		return {
			url: accountLink.url,
			accountId: organization.stripeAccountId,
			mode: 'live',
			message: 'Stripe Express onboarding link generated.',
		};
	}

	async completeMockStripeOnboarding(id: string, user: { id: string; role?: string }, dto: MockStripeOnboardingDto = {}) {
		const organization = await this.findOne(id);
		this.ensureOwnerOrAdmin(organization, user);
		this.validateMockStripeOnboarding(dto);

		if (!organization.stripeAccountId) {
			organization.stripeAccountId = `acct_mock_${organization.id.replace(/-/g, '').slice(0, 18)}`;
			organization.stripeAccountType = 'express';
		}
		organization.stripeChargesEnabled = true;
		organization.stripePayoutsEnabled = true;
		organization.stripeDetailsSubmitted = true;
		organization.stripeOnboardingCompletedAt = new Date();
		organization.stripeMockOnboardingData = this.maskMockStripeOnboarding(dto);

		return this.organizationsRepository.save(organization);
	}

	async getStripeStatus(id: string, user: { id: string; role?: string }) {
		const organization = await this.findOne(id);
		this.ensureOwnerOrAdmin(organization, user);
		await this.syncStripeAccountStatus(organization);
		return this.toStripeStatus(organization);
	}

	toStripeStatus(organization: OrganizationEntity) {
		return {
			organizationId: organization.id,
			accountId: organization.stripeAccountId,
			accountType: organization.stripeAccountType,
			chargesEnabled: Boolean(organization.stripeChargesEnabled),
			payoutsEnabled: Boolean(organization.stripePayoutsEnabled),
			detailsSubmitted: Boolean(organization.stripeDetailsSubmitted),
			onboardingCompletedAt: organization.stripeOnboardingCompletedAt,
			readyForPaidEvents: Boolean(organization.stripeChargesEnabled && organization.stripePayoutsEnabled && organization.stripeDetailsSubmitted),
			mode: organization.stripeAccountId?.startsWith('acct_mock_') ? 'mock' : 'live',
		};
	}

	async syncStripeAccountStatus(organization: OrganizationEntity) {
		const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
		if (!secretKey || !organization.stripeAccountId || organization.stripeAccountId.startsWith('acct_mock_')) {
			return organization;
		}
		const account = await this.retrieveStripeAccount(organization.stripeAccountId, secretKey).catch(() => null);
		if (!account) {
			organization.stripeAccountId = null;
			organization.stripeAccountType = null;
			organization.stripeChargesEnabled = false;
			organization.stripePayoutsEnabled = false;
			organization.stripeDetailsSubmitted = false;
			organization.stripeOnboardingCompletedAt = null;
			return this.organizationsRepository.save(organization);
		}
		organization.stripeChargesEnabled = Boolean(account.charges_enabled);
		organization.stripePayoutsEnabled = Boolean(account.payouts_enabled);
		organization.stripeDetailsSubmitted = Boolean(account.details_submitted);
		if (organization.stripeChargesEnabled && organization.stripePayoutsEnabled && organization.stripeDetailsSubmitted && !organization.stripeOnboardingCompletedAt) {
			organization.stripeOnboardingCompletedAt = new Date();
		}
		return this.organizationsRepository.save(organization);
	}

	private async createStripeExpressAccount(organization: OrganizationEntity, secretKey: string) {
		const params = new URLSearchParams();
		params.set('type', 'express');
		params.set('country', 'US');
		if (organization.contactEmail) {
			params.set('email', organization.contactEmail);
		}
		params.set('capabilities[card_payments][requested]', 'true');
		params.set('capabilities[transfers][requested]', 'true');
		params.set('business_profile[name]', organization.name);
		params.set('metadata[organizationId]', organization.id);
		const payload = await this.stripeRequest<{ id: string }>('/v1/accounts', secretKey, {
			method: 'POST',
			body: params,
		});
		return payload;
	}

	private async createAndAttachStripeExpressAccount(organization: OrganizationEntity, secretKey: string) {
		const account = await this.createStripeExpressAccount(organization, secretKey);
		organization.stripeAccountId = account.id;
		organization.stripeAccountType = 'express';
		organization.stripeChargesEnabled = false;
		organization.stripePayoutsEnabled = false;
		organization.stripeDetailsSubmitted = false;
		organization.stripeOnboardingCompletedAt = null;
		await this.organizationsRepository.save(organization);
		return organization;
	}

	private async stripeAccountBelongsToCurrentPlatform(accountId: string, secretKey: string) {
		if (accountId.startsWith('acct_mock_')) return false;
		try {
			await this.retrieveStripeAccount(accountId, secretKey);
			return true;
		} catch {
			return false;
		}
	}

	private async createStripeAccountLink(accountId: string, returnUrl: string, refreshUrl: string, secretKey: string) {
		const params = new URLSearchParams();
		params.set('account', accountId);
		params.set('type', 'account_onboarding');
		params.set('return_url', returnUrl);
		params.set('refresh_url', refreshUrl);
		return this.stripeRequest<{ url: string }>('/v1/account_links', secretKey, {
			method: 'POST',
			body: params,
		});
	}

	private async retrieveStripeAccount(accountId: string, secretKey: string) {
		return this.stripeRequest<{
			charges_enabled?: boolean;
			payouts_enabled?: boolean;
			details_submitted?: boolean;
		}>(`/v1/accounts/${encodeURIComponent(accountId)}`, secretKey);
	}

	private async stripeRequest<T>(path: string, secretKey: string, init: RequestInit = {}) {
		const response = await fetch(`https://api.stripe.com${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${secretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				...(init.headers ?? {}),
			},
		});
		const payload = (await response.json()) as T & { error?: { message?: string } };
		if (!response.ok) {
			throw new BadRequestException(payload.error?.message ?? 'Stripe request failed');
		}
		return payload;
	}

	private ensureOwnerOrAdmin(organization: OrganizationEntity, user: { id: string; role?: string }) {
		if (['super_admin', 'platform_admin', 'admin', 'org_admin', 'org_staff'].includes(user.role || '')) return;
		if (organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot manage payouts for this organization');
		}
	}

	private validateMockStripeOnboarding(dto: MockStripeOnboardingDto) {
		const required: Array<[keyof MockStripeOnboardingDto, string]> = [
			['businessType', 'Business type'],
			['legalBusinessName', 'Legal business name'],
			['addressLine1', 'Business address'],
			['city', 'City'],
			['state', 'State'],
			['postalCode', 'Postal code'],
			['country', 'Country'],
			['representativeFirstName', 'Representative first name'],
			['representativeLastName', 'Representative last name'],
			['representativeEmail', 'Representative email'],
			['representativeDob', 'Representative date of birth'],
			['taxIdLast4', 'Tax ID last 4'],
			['bankAccountHolderName', 'Bank account holder name'],
			['bankRoutingLast4', 'Routing number last 4'],
			['bankAccountLast4', 'Account number last 4'],
		];

		for (const [key, label] of required) {
			if (!String(dto[key] ?? '').trim()) {
				throw new BadRequestException(`${label} is required for mock Stripe onboarding`);
			}
		}

		if (!dto.termsAccepted) {
			throw new BadRequestException('Stripe terms must be accepted for mock onboarding');
		}
	}

	private hasCompletedVendorProfile(organization: OrganizationEntity) {
		return Boolean(
			organization.name &&
				organization.businessCategory &&
				organization.country &&
				organization.stateProvince &&
				organization.website &&
				organization.description &&
				organization.legalBusinessName &&
				organization.businessRole &&
				organization.businessEmail &&
				organization.businessPhone &&
				organization.coverImageUrls?.length &&
				organization.termsAcceptedAt,
		);
	}

	private maskMockStripeOnboarding(dto: MockStripeOnboardingDto) {
		return {
			...dto,
			taxIdLast4: String(dto.taxIdLast4 || '').slice(-4),
			bankRoutingLast4: String(dto.bankRoutingLast4 || '').slice(-4),
			bankAccountLast4: String(dto.bankAccountLast4 || '').slice(-4),
		};
	}

	private slugify(value: string) {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)+/g, '');
	}

	private isUuid(value: string) {
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
	}
}
