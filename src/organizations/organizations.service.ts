import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateOrganizationMemberDto } from './dto/create-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';
import { OrganizationMemberEntity } from './entities/organization-member.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { AuditService } from '../audit/audit.service';
import { Request } from 'express';
import { UserEntity } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { NotificationsService } from '../notifications/notifications.service';

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

const STRIPE_COUNTRY_BY_NAME: Record<string, string> = {
	'argentina': 'AR',
	'australia': 'AU',
	'austria': 'AT',
	'belgium': 'BE',
	'brazil': 'BR',
	'bulgaria': 'BG',
	'canada': 'CA',
	'chile': 'CL',
	'croatia': 'HR',
	'cyprus': 'CY',
	'czech republic': 'CZ',
	'denmark': 'DK',
	'estonia': 'EE',
	'finland': 'FI',
	'france': 'FR',
	'germany': 'DE',
	'ghana': 'GH',
	'greece': 'GR',
	'hong kong': 'HK',
	'hungary': 'HU',
	'india': 'IN',
	'indonesia': 'ID',
	'ireland': 'IE',
	'italy': 'IT',
	'japan': 'JP',
	'kenya': 'KE',
	'latvia': 'LV',
	'liechtenstein': 'LI',
	'lithuania': 'LT',
	'luxembourg': 'LU',
	'malaysia': 'MY',
	'malta': 'MT',
	'mexico': 'MX',
	'netherlands': 'NL',
	'new zealand': 'NZ',
	'nigeria': 'NG',
	'norway': 'NO',
	'poland': 'PL',
	'portugal': 'PT',
	'romania': 'RO',
	'singapore': 'SG',
	'slovakia': 'SK',
	'slovenia': 'SI',
	'south africa': 'ZA',
	'spain': 'ES',
	'sweden': 'SE',
	'switzerland': 'CH',
	'thailand': 'TH',
	'united arab emirates': 'AE',
	'united kingdom': 'GB',
	'uk': 'GB',
	'united states': 'US',
	'united states of america': 'US',
	'usa': 'US',
};

const STRIPE_CARD_PAYMENTS_COUNTRIES = new Set([
	'AE',
	'AR',
	'AT',
	'AU',
	'BE',
	'BG',
	'BR',
	'CA',
	'CH',
	'CL',
	'CY',
	'CZ',
	'DE',
	'DK',
	'EE',
	'ES',
	'FI',
	'FR',
	'GB',
	'GH',
	'GI',
	'GR',
	'HK',
	'HR',
	'HU',
	'ID',
	'IE',
	'IN',
	'IT',
	'JP',
	'KE',
	'LI',
	'LT',
	'LU',
	'LV',
	'MT',
	'MX',
	'MY',
	'NL',
	'NO',
	'NZ',
	'PL',
	'PT',
	'RO',
	'SE',
	'SG',
	'SI',
	'SK',
	'TH',
	'US',
	'ZA',
]);

@Injectable()
export class OrganizationsService {
	constructor(
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		@InjectRepository(OrganizationMemberEntity)
		private readonly organizationMembersRepository: Repository<OrganizationMemberEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		private readonly configService: ConfigService,
		private readonly auditService: AuditService,
		private readonly notificationsService: NotificationsService,
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
		const organizerUsername = dto.organizerUsername
			? await this.getAvailableOrganizerUsernameOrThrow(dto.organizerUsername)
			: undefined;

		const organization = await this.organizationsRepository.save(
			this.organizationsRepository.create({ ...dto, slug, organizerUsername }),
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

		const { termsAccepted, organizerUsername, ...updates } = dto;
		Object.assign(organization, updates);
		if (organizerUsername !== undefined) {
			organization.organizerUsername = organizerUsername.trim()
				? await this.getAvailableOrganizerUsernameOrThrow(organizerUsername, organization.id)
				: null;
		}
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

	async checkOrganizerUsernameAvailability(username: string, organizationId?: string) {
		const normalized = this.normalizeOrganizerUsername(username);
		const validationMessage = this.validateOrganizerUsername(normalized);
		if (validationMessage) {
			return {
				username: normalized,
				available: false,
				valid: false,
				message: validationMessage,
			};
		}

		const existing = await this.organizationsRepository.findOne({
			where: { organizerUsername: normalized },
		});
		const available = !existing || existing.id === organizationId;

		return {
			username: normalized,
			available,
			valid: true,
			message: available ? 'Username is available' : 'Username is already taken',
		};
	}

	async suggestOrganizerUsernames(firstName: string, lastName: string) {
		const first = this.normalizeOrganizerUsername(firstName).replace(/[._-]+/g, '');
		const last = this.normalizeOrganizerUsername(lastName).replace(/[._-]+/g, '');
		const compactName = [first, last].filter(Boolean).join('');
		const dashedName = [first, last].filter(Boolean).join('-');
		const seed = compactName || dashedName || 'organizer';
		const year = new Date().getFullYear();
		const candidates = Array.from(
			new Set(
				[
					dashedName,
					compactName,
					`${seed}-events`,
					`${seed}-organizer`,
					`${seed}${year}`,
					`${seed}-hq`,
				]
					.map((candidate) => this.normalizeOrganizerUsername(candidate))
					.filter((candidate) => candidate && !this.validateOrganizerUsername(candidate)),
			),
		);

		const suggestions: string[] = [];
		for (const candidate of candidates) {
			const available = await this.checkOrganizerUsernameAvailability(candidate);
			if (available.available) suggestions.push(available.username);
			if (suggestions.length >= 3) break;
		}

		let suffix = 2;
		while (suggestions.length < 3 && suffix < 100) {
			const candidate = this.normalizeOrganizerUsername(`${seed}${suffix}`);
			const available = await this.checkOrganizerUsernameAvailability(candidate);
			if (available.available) suggestions.push(available.username);
			suffix += 1;
		}

		return { suggestions };
	}

	async listOrganizationMembers(id: string, user?: { id: string; email?: string; role?: string }) {
		const organization = await this.findOne(id);
		if (user) {
			await this.ensureOrganizationTeamManager(organization, user);
		}

		const members = await this.organizationMembersRepository.find({
			where: { organizationId: id },
			order: { createdAt: 'ASC' },
		});

		return members.map((member) => this.toOrganizationMemberDto(member));
	}

	async createOrganizationMember(
		id: string,
		dto: CreateOrganizationMemberDto,
		user?: { id: string; email?: string; role?: string },
		request?: Request,
	) {
		const organization = await this.findOne(id);
		if (user) {
			await this.ensureOrganizationTeamManager(organization, user);
		}
		const email = dto.email.trim().toLowerCase();
		const role = this.getOrganizationMemberRole(dto.role);
		let memberUser = await this.usersRepository.findOne({ where: { email } });
		const generatedPassword = dto.password || this.generateTemporaryPassword();

		if (!memberUser) {
			memberUser = await this.usersRepository.save(
				this.usersRepository.create({
					fullName: dto.fullName.trim(),
					email,
					passwordHash: await bcrypt.hash(generatedPassword, 10),
					role,
					accountType: 'organization',
					businessName: organization.name,
					isActive: true,
					verifiedAt: new Date(),
					activeAt: new Date(),
				}),
			);
		}

		const existingMember = await this.organizationMembersRepository.findOne({
			where: { organizationId: id, userId: memberUser.id },
		});
		if (existingMember) throw new BadRequestException('This user is already on the organizer team');

		const member = await this.organizationMembersRepository.save(
			this.organizationMembersRepository.create({
				organizationId: id,
				userId: memberUser.id,
				role,
				status: 'active',
			}),
		);

		await this.notificationsService.queueEmail(
			memberUser.email,
			`You have been added to ${organization.name} on Venue Spice`,
			this.buildOrganizationMemberInviteEmail(memberUser.fullName, organization.name, memberUser.email, generatedPassword, role),
		);
		await this.auditService.log(
			'organization.member.created',
			user,
			'organization',
			organization.id,
			{ after: { userId: memberUser.id, email: memberUser.email, role } },
			undefined,
			request,
		);

		const saved = await this.organizationMembersRepository.findOneOrFail({ where: { id: member.id } });
		return this.toOrganizationMemberDto(saved);
	}

	async updateOrganizationMember(
		id: string,
		memberId: string,
		dto: UpdateOrganizationMemberDto,
		user?: { id: string; email?: string; role?: string },
		request?: Request,
	) {
		const organization = await this.findOne(id);
		if (user) {
			await this.ensureOrganizationTeamManager(organization, user);
		}
		const member = await this.organizationMembersRepository.findOne({
			where: { id: memberId, organizationId: id },
		});
		if (!member) throw new NotFoundException('Team member not found');
		const before = { role: member.role, status: member.status };

		if (dto.role) {
			member.role = this.getOrganizationMemberRole(dto.role);
			await this.usersRepository.update(member.userId, { role: member.role });
		}
		if (dto.isActive !== undefined) {
			member.status = dto.isActive ? 'active' : 'inactive';
			await this.usersRepository.update(member.userId, { isActive: dto.isActive });
		}

		const saved = await this.organizationMembersRepository.save(member);
		await this.auditService.log(
			'organization.member.updated',
			user,
			'organization',
			organization.id,
			{ before, after: { role: saved.role, status: saved.status } },
			{ memberId },
			request,
		);

		const reloaded = await this.organizationMembersRepository.findOneOrFail({ where: { id: saved.id } });
		return this.toOrganizationMemberDto(reloaded);
	}

	private pickOrganizationAuditFields(organization: OrganizationEntity) {
		return {
			name: organization.name,
			slug: organization.slug,
			organizerUsername: organization.organizerUsername,
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

	private normalizeOrganizerUsername(value: string) {
		return value
			.trim()
			.replace(/^@+/, '')
			.toLowerCase()
			.replace(/\s+/g, '-');
	}

	private validateOrganizerUsername(value: string) {
		if (!value) return 'Enter an organizer username';
		if (value.length < 3) return 'Use at least 3 characters';
		if (value.length > 30) return 'Use 30 characters or fewer';
		if (!/^[a-z0-9._-]+$/.test(value)) {
			return 'Use only letters, numbers, dots, dashes, or underscores';
		}
		if (/^[._-]|[._-]$/.test(value)) {
			return 'Username cannot start or end with a symbol';
		}
		return '';
	}

	private async getAvailableOrganizerUsernameOrThrow(value: string, organizationId?: string) {
		const normalized = this.normalizeOrganizerUsername(value);
		const validationMessage = this.validateOrganizerUsername(normalized);
		if (validationMessage) throw new BadRequestException(validationMessage);
		const existing = await this.organizationsRepository.findOne({
			where: { organizerUsername: normalized },
		});
		if (existing && existing.id !== organizationId) {
			throw new BadRequestException('Organizer username is already taken');
		}
		return normalized;
	}

	private getOrganizationMemberRole(role?: Role) {
		if (!role) return Role.ORG_STAFF;
		if (role !== Role.ORG_ADMIN && role !== Role.ORG_STAFF) {
			throw new BadRequestException('Organizer team role must be org_admin or org_staff');
		}
		return role;
	}

	private toOrganizationMemberDto(member: OrganizationMemberEntity) {
		return {
			id: member.id,
			organizationId: member.organizationId,
			userId: member.userId,
			role: member.role,
			status: member.status,
			isActive: member.status === 'active' && member.user?.isActive !== false,
			fullName: member.user?.fullName || '',
			email: member.user?.email || '',
			createdAt: member.createdAt,
			updatedAt: member.updatedAt,
		};
	}

	private generateTemporaryPassword() {
		return `Venue${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}!`;
	}

	private buildOrganizationMemberInviteEmail(
		fullName: string,
		organizationName: string,
		email: string,
		password: string,
		role: Role,
	) {
		return `
			<div style="font-family:Arial,sans-serif;line-height:1.6;color:#151922">
				<h2>You have been added to ${organizationName}</h2>
				<p>Hello ${fullName || 'there'},</p>
				<p>You can now help manage ${organizationName} on Venue Spice.</p>
				<p><strong>Email:</strong> ${email}<br/><strong>Temporary password:</strong> ${password}<br/><strong>Role:</strong> ${role}</p>
				<p>Please sign in and update your password from your account settings.</p>
			</div>
		`;
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
			const account = await this.retrieveStripeAccountOrNull(
				organization.stripeAccountId,
				secretKey,
			);
			if (!account) {
				await this.createAndAttachStripeExpressAccount(organization, secretKey);
			} else if (
				(account.country && account.country !== this.getStripeCountry(organization)) ||
				this.accountNeedsRecipientServiceAgreement(account)
			) {
				await this.replaceStripeAccountForCountryChange(organization, secretKey);
			} else {
				await this.requestStripeRequiredCapabilities(organization.stripeAccountId, secretKey);
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
		const canReceiveTransfers =
			account.capabilities?.transfers === 'active' ||
			account.capabilities?.legacy_payments === 'active' ||
			account.capabilities?.crypto_transfers === 'active';
		organization.stripeChargesEnabled = Boolean(account.charges_enabled);
		organization.stripePayoutsEnabled = Boolean(account.payouts_enabled && canReceiveTransfers);
		organization.stripeDetailsSubmitted = Boolean(account.details_submitted);
		if (organization.stripeChargesEnabled && organization.stripePayoutsEnabled && organization.stripeDetailsSubmitted && !organization.stripeOnboardingCompletedAt) {
			organization.stripeOnboardingCompletedAt = new Date();
		}
		return this.organizationsRepository.save(organization);
	}

	private async createStripeExpressAccount(organization: OrganizationEntity, secretKey: string) {
		const params = new URLSearchParams();
		const country = this.getStripeCountry(organization);
		params.set('type', 'express');
		params.set('country', country);
		if (this.requiresRecipientServiceAgreement(country)) {
			params.set('tos_acceptance[service_agreement]', 'recipient');
		}
		if (organization.contactEmail) {
			params.set('email', organization.contactEmail);
		}
		this.appendStripeConnectCapabilities(params, country);
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

	private async replaceStripeAccountForCountryChange(organization: OrganizationEntity, secretKey: string) {
		organization.stripeAccountId = null;
		organization.stripeAccountType = null;
		organization.stripeChargesEnabled = false;
		organization.stripePayoutsEnabled = false;
		organization.stripeDetailsSubmitted = false;
		organization.stripeOnboardingCompletedAt = null;
		await this.organizationsRepository.save(organization);
		return this.createAndAttachStripeExpressAccount(organization, secretKey);
	}

	private async requestStripeRequiredCapabilities(accountId: string, secretKey: string) {
		const account = await this.retrieveStripeAccount(accountId, secretKey);
		const params = new URLSearchParams();
		this.appendStripeConnectCapabilities(params, account.country || 'US');
		await this.stripeRequest(`/v1/accounts/${encodeURIComponent(accountId)}`, secretKey, {
			method: 'POST',
			body: params,
		});
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
			id?: string;
			country?: string;
			charges_enabled?: boolean;
			payouts_enabled?: boolean;
			details_submitted?: boolean;
			tos_acceptance?: {
				service_agreement?: string;
			};
			capabilities?: {
				transfers?: string;
				card_payments?: string;
				legacy_payments?: string;
				crypto_transfers?: string;
			};
		}>(`/v1/accounts/${encodeURIComponent(accountId)}`, secretKey);
	}

	private async retrieveStripeAccountOrNull(accountId: string, secretKey: string) {
		if (accountId.startsWith('acct_mock_')) return null;
		return this.retrieveStripeAccount(accountId, secretKey).catch(() => null);
	}

	private appendStripeConnectCapabilities(params: URLSearchParams, country: string) {
		if (STRIPE_CARD_PAYMENTS_COUNTRIES.has(country)) {
			params.set('capabilities[card_payments][requested]', 'true');
		}
		params.set('capabilities[transfers][requested]', 'true');
	}

	private requiresRecipientServiceAgreement(country: string) {
		return !STRIPE_CARD_PAYMENTS_COUNTRIES.has(country.toUpperCase());
	}

	private accountNeedsRecipientServiceAgreement(account: { country?: string; tos_acceptance?: { service_agreement?: string } }) {
		const country = account.country?.toUpperCase();
		return Boolean(country && this.requiresRecipientServiceAgreement(country) && account.tos_acceptance?.service_agreement !== 'recipient');
	}

	private getStripeCountry(organization: OrganizationEntity) {
		const normalized = String(organization.country || '').trim().toLowerCase();
		if (/^[a-z]{2}$/i.test(normalized)) return normalized.toUpperCase();
		const countryCode = STRIPE_COUNTRY_BY_NAME[normalized];
		if (!countryCode) {
			throw new BadRequestException('Set your event organizer country before connecting Stripe payouts.');
		}
		return countryCode;
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

	private async ensureOrganizationTeamManager(organization: OrganizationEntity, user: { id: string; role?: string }) {
		if (['super_admin', 'platform_admin', 'admin'].includes(user.role || '')) return;
		if (organization.ownerUserId === user.id) return;
		const member = await this.organizationMembersRepository.findOne({
			where: { organizationId: organization.id, userId: user.id },
		});
		if (member?.status === 'active' && member.role === Role.ORG_ADMIN) return;
		throw new ForbiddenException('You cannot manage users for this organization');
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
