import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Request } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { Role } from '../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { FinancialLedgerService } from '../financial-ledger/financial-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { EventEntity } from './entities/event.entity';
import { EventPrivateAccessTokenEntity } from './entities/event-private-access-token.entity';
import { TicketTypeEntity } from './entities/ticket-type.entity';
import { VerifyPrivateEventAccessDto } from './dto/verify-private-event-access.dto';

const MIN_PAID_PRICE = 1;

@Injectable()
export class EventsService {
	constructor(
		@InjectRepository(EventEntity)
		private readonly eventsRepository: Repository<EventEntity>,
		@InjectRepository(EventPrivateAccessTokenEntity)
		private readonly privateAccessTokensRepository: Repository<EventPrivateAccessTokenEntity>,
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		@InjectRepository(TicketTypeEntity)
		private readonly ticketTypesRepository: Repository<TicketTypeEntity>,
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
		private readonly organizationsService: OrganizationsService,
		private readonly auditService: AuditService,
		private readonly financialLedgerService: FinancialLedgerService,
		private readonly notificationsService: NotificationsService,
		private readonly configService: ConfigService,
		private readonly platformSettingsService: PlatformSettingsService,
	) {}

	findAll(organizationId?: string, user?: { id: string; role: Role }) {
		if (user && !this.isAdminRole(user.role)) {
			if (!organizationId) {
				return this.eventsRepository.find({
					where: { organization: { ownerUserId: user.id } },
					order: { startsAt: 'ASC', createdAt: 'DESC' },
				}).then((events) => events.map((event) => this.toDashboardEvent(event)));
			}
			return this.findAllForOwner(organizationId, user.id);
		}

		return this.eventsRepository.find({
			where: organizationId ? { organization: { id: organizationId } } : {},
			order: { startsAt: 'ASC', createdAt: 'DESC' },
		}).then((events) => events.map((event) => this.toDashboardEvent(event)));
	}

	private async findAllForOwner(organizationId: string, ownerUserId: string) {
		await this.ensureOrganizationAccess(organizationId, ownerUserId);
		return this.eventsRepository.find({
			where: { organization: { id: organizationId } },
			order: { startsAt: 'ASC', createdAt: 'DESC' },
		}).then((events) => events.map((event) => this.toDashboardEvent(event)));
	}

	findPublic() {
		const now = new Date();
		return this.eventsRepository
			.createQueryBuilder('event')
			.leftJoinAndSelect('event.organization', 'organization')
			.leftJoinAndSelect('event.ticketTypes', 'ticketTypes')
			.where('event.status = :status', { status: 'published' })
			.andWhere(
				new Brackets((builder) => {
					builder
						.where('event.endsAt IS NOT NULL AND event.endsAt >= :now', { now })
						.orWhere('event.endsAt IS NULL AND event.startsAt >= :now', { now });
				}),
			)
			.orderBy('event.startsAt', 'ASC')
			.take(24)
			.getMany()
			.then((events) => events.map((event) => this.toPublicListingEvent(event)));
	}

	async findPublicOne(idOrSlug: string, accessToken?: string) {
		const where = this.isUuid(idOrSlug)
			? [
					{ id: idOrSlug, status: 'published' as const },
					{ slug: idOrSlug, status: 'published' as const },
				]
			: [{ slug: idOrSlug, status: 'published' as const }];
		const event = await this.eventsRepository.findOne({
			where,
		});
		if (!event) throw new NotFoundException('Published event not found');
		const access = await this.getPrivateEventAccessState(event, accessToken);
		if (!access.allowed) return this.toPrivateAccessGate(access.reason);
		return this.toPublicEvent(event);
	}

	async verifyPrivateAccess(slug: string, dto: VerifyPrivateEventAccessDto) {
		const event = await this.eventsRepository.findOne({
			where: this.isUuid(slug)
				? [{ id: slug, status: 'published' as const }, { slug, status: 'published' as const }]
				: [{ slug, status: 'published' as const }],
		});
		if (!event) throw new NotFoundException('Published event not found');
		if ((event.visibility || 'public') !== 'private') {
			return { event: this.toPublicEvent(event), privateAccessToken: null };
		}

		const tokenAccess = await this.getPrivateEventAccessState(event, dto.privateAccessToken);
		if (tokenAccess.allowed && dto.privateAccessToken) {
			return { event: this.toPublicEvent(event), privateAccessToken: dto.privateAccessToken.trim() };
		}

		const accessCode = dto.accessCode?.trim();
		if (!accessCode || !this.safeCompareHash(accessCode, event.accessCodeHash)) {
			return this.toPrivateAccessGate('invalid_code');
		}

		const privateAccessToken = this.generatePrivateAccessToken();
		await this.createPrivateAccessTokenRecord(event, privateAccessToken, null);
		return { event: this.toPublicEvent(event), privateAccessToken };
	}

	async findPublicOrganizerProfile(username: string) {
		const normalized = username.trim().replace(/^@+/, '').toLowerCase();
		if (!normalized) throw new NotFoundException('Organizer not found');

		const organization = await this.organizationsRepository.findOne({
			where: [
				{ organizerUsername: normalized, status: 'active' },
				{ slug: normalized, status: 'active' },
			],
		});
		if (!organization || organization.type !== 'organization') {
			throw new NotFoundException('Organizer not found');
		}

		const now = new Date();
		const events = await this.eventsRepository
			.createQueryBuilder('event')
			.leftJoinAndSelect('event.organization', 'organization')
			.leftJoinAndSelect('event.ticketTypes', 'ticketTypes')
			.where('event.status = :status', { status: 'published' })
			.andWhere('organization.id = :organizationId', { organizationId: organization.id })
			.orderBy('event.startsAt', 'ASC')
			.addOrderBy('event.createdAt', 'DESC')
			.getMany();

		const publicEvents = events.map((event) => this.toPublicListingEvent(event));
		const upcomingEvents = publicEvents.filter((event) => {
			const endTime = event.endsAt ? new Date(event.endsAt).getTime() : new Date(event.startsAt).getTime();
			return endTime >= now.getTime();
		});
		const pastEvents = publicEvents
			.filter((event) => {
				const endTime = event.endsAt ? new Date(event.endsAt).getTime() : new Date(event.startsAt).getTime();
				return endTime < now.getTime();
			})
			.reverse();

		return {
			organizer: {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				organizerUsername: organization.organizerUsername,
				logoUrl: organization.logoUrl,
				coverImageUrls: organization.coverImageUrls || [],
				description: organization.description,
				website: organization.website,
				country: organization.country,
				stateProvince: organization.stateProvince,
				businessCategory: organization.businessCategory,
			},
			stats: {
				upcomingEvents: upcomingEvents.length,
				pastEvents: pastEvents.length,
				totalPublishedEvents: publicEvents.length,
			},
			upcomingEvents,
			pastEvents,
		};
	}

	async findOne(idOrSlug: string, user?: { id: string; role: Role }) {
		const event = await this.findOneEntity(idOrSlug, user);
		return this.toDashboardEvent(event);
	}

	private async findOneEntity(idOrSlug: string, user?: { id: string; role: Role }) {
		const event = await this.eventsRepository.findOne({
			where: [{ id: idOrSlug }, { slug: idOrSlug }],
		});
		if (!event) throw new NotFoundException('Event not found');
		if (user && !this.isAdminRole(user.role)) {
			this.ensureEventAccess(event, user.id);
		}
		return event;
	}

	async create(dto: CreateEventDto, user?: { id: string; role: Role }) {
		this.validatePricing(dto);
		const organization = await this.organizationsRepository.findOne({
			where: { id: dto.organizationId },
		});
		if (!organization) throw new BadRequestException('Organization not found');
		if (user && !this.isAdminRole(user.role) && organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot create events for this organization');
		}
		await this.validatePaidEventPayoutReadiness(dto, organization);

		const slug = dto.slug || this.slugify(dto.title);
		const existing = await this.eventsRepository.findOne({ where: { slug } });
		if (existing) throw new BadRequestException('Event slug already exists');
		const startsAt = new Date(dto.startsAt);
		const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
		this.validateCreateDate(startsAt);
		this.validateTicketSalesWindowsForEvent(dto.ticketTypes || [], endsAt || startsAt);
		const taxSettings = await this.resolveEventTaxSettings(dto, dto.status || 'draft');
		this.validateDraftTransition({
			currentStatus: 'draft',
			nextStatus: dto.status || 'draft',
			currentEndsAt: endsAt || startsAt,
			nextEndsAt: endsAt || startsAt,
			isCreate: true,
		});

		const privateAccessToken = dto.visibility === 'private' ? this.generatePrivateAccessToken() : null;
		const accessCode = this.normalizeSecret(dto.accessCode);
		const event = this.eventsRepository.create({
			...dto,
			slug,
			startsAt,
			endsAt,
			organization,
			visibility: dto.visibility || 'public',
			privateAccessToken,
			privateAccessTokenHash: privateAccessToken ? this.hashSecret(privateAccessToken) : null,
			accessCodeHash: accessCode ? this.hashSecret(accessCode) : null,
			accessCodeUpdatedAt: accessCode ? new Date() : null,
			...taxSettings,
			refundsAllowed: dto.refundsAllowed ?? true,
			refundCutoffHours: this.normalizeRefundCutoffHours(dto.refundCutoffHours),
			refundablePercentage: this.normalizeRefundablePercentage(dto.refundablePercentage),
			ticketTypes: dto.ticketTypes || [],
			imageUrls: dto.imageUrls || [],
			socialLinks: dto.socialLinks || {},
			appearances: dto.appearances || [],
			addOns: dto.addOns || [],
			faqs: this.normalizeFaqs(dto.faqs),
		});
		const saved = await this.eventsRepository.save(event);
		if (privateAccessToken) {
			await this.createPrivateAccessTokenRecord(saved, privateAccessToken, user?.id ?? null);
			return this.withPrivateAccessToken(saved, privateAccessToken);
		}
		return this.toDashboardEvent(saved);
	}

	async clone(id: string, user?: { id: string; role: Role }, request?: Request) {
		const source = await this.findOneEntity(id, user);
		const organization = source.organization;
		if (!organization) throw new BadRequestException('Event organizer not found');

		const title = await this.buildClonedEventTitle(source.title);
		const slug = await this.buildUniqueSlug(this.slugify(title));
		const clonedEvent = this.eventsRepository.create({
			title,
			slug,
			description: source.description,
			category: source.category,
			organizerName: source.organizerName,
			venue: source.venue,
			country: source.country,
			city: source.city,
			state: source.state,
			streetAddress: source.streetAddress,
			venuePostalCode: source.venuePostalCode,
			timezone: source.timezone,
			isVirtual: source.isVirtual,
			startsAt: source.startsAt,
			endsAt: source.endsAt,
			coverImageUrl: source.coverImageUrl,
			imageUrls: [...(source.imageUrls || [])],
			socialLinks: { ...(source.socialLinks || {}) },
			appearances: this.cloneJson(source.appearances || []),
			addOns: this.cloneJson(source.addOns || []),
			faqs: this.normalizeFaqs(source.faqs),
			status: 'draft',
			visibility: source.visibility || 'public',
			privateAccessToken: null,
			privateAccessTokenHash: null,
			accessCodeHash: null,
			accessCodeUpdatedAt: null,
			refundsAllowed: source.refundsAllowed,
			refundCutoffHours: this.normalizeRefundCutoffHours(source.refundCutoffHours),
			refundablePercentage: this.normalizeRefundablePercentage(source.refundablePercentage),
			taxCollectionMode: source.taxCollectionMode,
			taxResponsibility: source.taxResponsibility,
			organizerTaxRate: Number(source.organizerTaxRate || 0),
			organizerTaxLabel: source.organizerTaxLabel,
			organizerTaxPermitConfirmed: source.organizerTaxPermitConfirmed,
			organizerTaxConsentAt: source.organizerTaxConsentAt,
			organizerTaxConsentText: source.organizerTaxConsentText,
			venueAddressTaxConfirmed: source.venueAddressTaxConfirmed,
			venueAddressTaxConfirmedAt: source.venueAddressTaxConfirmedAt,
			venueAddressTaxConsentText: source.venueAddressTaxConsentText,
			taxCode: source.taxCode,
			organization,
			ticketTypes: (source.ticketTypes || []).map((ticket) => this.ticketTypesRepository.create({
				name: ticket.name,
				price: Number(ticket.price || 0),
				quantity: Number(ticket.quantity || 0),
				limitPerPerson: ticket.limitPerPerson,
				admissionType: ticket.admissionType ?? 'single',
				groupSize: ticket.groupSize,
				collectGroupAttendeeDetails: Boolean(ticket.collectGroupAttendeeDetails),
				attendeeDetailsRequired: Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails),
				salesStartAt: ticket.salesStartAt,
				salesEndAt: ticket.salesEndAt,
				description: ticket.description,
				includeCharges: ticket.includeCharges,
				quantitySold: 0,
				status: 'active',
			})),
		});
		const saved = await this.eventsRepository.save(clonedEvent);
		await this.auditService.log(
			'event.cloned',
			user,
			'event',
			saved.id,
			{
				sourceEventId: { before: null, after: source.id },
				status: { before: source.status, after: 'draft' },
				title: { before: source.title, after: saved.title },
			},
			{
				organizationId: organization.id,
				organizationName: organization.name,
				sourceEventId: source.id,
				sourceEventTitle: source.title,
				clonedEventId: saved.id,
				clonedEventTitle: saved.title,
			},
			request,
		);
		return this.toDashboardEvent(saved);
	}

	async update(
		id: string,
		dto: Partial<CreateEventDto> & { status?: EventEntity['status'] },
		user?: { id: string; role: Role },
		request?: Request,
	) {
		this.validatePricing(dto);
		const event = await this.findOneEntity(id, user);
		const before = this.pickEventAuditFields(event);
		const previousPayoutAnchor = event.endsAt || event.startsAt;
		let nextSlug = event.slug;
		if (dto.slug !== undefined) {
			const normalizedSlug = this.slugify(dto.slug);
			if (!normalizedSlug) throw new BadRequestException('Event slug is required');
			const existing = await this.eventsRepository.findOne({ where: { slug: normalizedSlug } });
			if (existing && existing.id !== event.id) throw new BadRequestException('Event slug already exists');
			nextSlug = normalizedSlug;
		} else if (event.status === 'draft' && dto.title?.trim() && dto.title.trim() !== event.title) {
			nextSlug = await this.buildUniqueSlug(this.slugify(dto.title), event.id);
		}

		const {
			ticketTypes,
			slug: _slug,
			accessCode: _accessCode,
			dateChangeConfirmed,
			dateChangeReason,
			taxCollectionMode: _taxCollectionMode,
			taxResponsibility: _taxResponsibility,
			organizerTaxRate: _organizerTaxRate,
			organizerTaxLabel: _organizerTaxLabel,
			organizerTaxPermitConfirmed: _organizerTaxPermitConfirmed,
			organizerTaxConsentText: _organizerTaxConsentText,
			venueAddressTaxConfirmed: _venueAddressTaxConfirmed,
			venueAddressTaxConsentText: _venueAddressTaxConsentText,
			taxCode: _taxCode,
			...eventPatch
		} = dto;
		const nextStartsAt = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
		const nextEndsAt = dto.endsAt ? new Date(dto.endsAt) : event.endsAt || nextStartsAt;
		const dateChange = this.getEventDateChange(event, nextStartsAt, nextEndsAt, dto.timezone);
		const impactedOrderCount = dateChange.changed ? await this.countImpactedOrders(event.id) : 0;
		this.validateOrganizerDateChangePolicy({
			event,
			nextStartsAt,
			nextEndsAt,
			dateChange,
			impactedOrderCount,
			dateChangeConfirmed,
		});
		this.validateTicketSalesWindowsForEvent(
			ticketTypes || event.ticketTypes.map((ticket) => ({
				name: ticket.name,
				price: Number(ticket.price || 0),
				quantity: Number(ticket.quantity || 0),
				salesEndAt: ticket.salesEndAt ? ticket.salesEndAt.toISOString() : undefined,
			})),
			nextEndsAt,
		);
		this.validateDraftTransition({
			currentStatus: event.status,
			nextStatus: dto.status || event.status,
			currentEndsAt: event.endsAt || event.startsAt,
			nextEndsAt,
		});
		await this.validatePaidEventPayoutReadiness(
			{
				...dto,
				status: dto.status || event.status,
				ticketTypes: dto.ticketTypes || event.ticketTypes.map((ticket) => ({
					name: ticket.name,
					price: Number(ticket.price || 0),
					quantity: Number(ticket.quantity || 0),
					limitPerPerson: ticket.limitPerPerson ?? undefined,
					admissionType: ticket.admissionType ?? 'single',
					groupSize: ticket.groupSize ?? undefined,
					attendeeDetailsRequired: Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails),
					collectGroupAttendeeDetails: ticket.admissionType === 'group' ? Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails) : false,
					salesStartAt: ticket.salesStartAt ? ticket.salesStartAt.toISOString() : undefined,
					salesEndAt: ticket.salesEndAt ? ticket.salesEndAt.toISOString() : undefined,
					description: ticket.description ?? undefined,
					includeCharges: ticket.includeCharges,
				})),
				addOns: dto.addOns ?? event.addOns,
			},
			event.organization,
		);
		const taxSettings = await this.resolveEventTaxSettings(
			{ ...this.eventToTaxDto(event), ...dto },
			dto.status || event.status,
			event,
		);

		let generatedPrivateAccessToken: string | null = null;
		const nextVisibility = dto.visibility ?? event.visibility;
		if (nextVisibility === 'private' && (event.visibility !== 'private' || !event.privateAccessTokenHash)) {
			generatedPrivateAccessToken = this.generatePrivateAccessToken();
		}

		Object.assign(event, {
			...eventPatch,
			slug: nextSlug,
			startsAt: nextStartsAt,
			endsAt: nextEndsAt,
			visibility: nextVisibility,
			privateAccessToken: nextVisibility === 'public'
				? null
				: generatedPrivateAccessToken || event.privateAccessToken || null,
			privateAccessTokenHash: nextVisibility === 'public'
				? null
				: generatedPrivateAccessToken
					? this.hashSecret(generatedPrivateAccessToken)
					: event.privateAccessTokenHash || (event.privateAccessToken ? this.hashSecret(event.privateAccessToken) : null),
			...taxSettings,
			refundsAllowed: dto.refundsAllowed ?? event.refundsAllowed,
			refundCutoffHours: dto.refundCutoffHours !== undefined ? this.normalizeRefundCutoffHours(dto.refundCutoffHours) : event.refundCutoffHours,
			refundablePercentage: dto.refundablePercentage !== undefined ? this.normalizeRefundablePercentage(dto.refundablePercentage) : event.refundablePercentage,
			imageUrls: dto.imageUrls ?? event.imageUrls,
			socialLinks: dto.socialLinks ?? event.socialLinks,
			appearances: dto.appearances ?? event.appearances,
			addOns: dto.addOns ?? event.addOns,
			faqs: dto.faqs !== undefined ? this.normalizeFaqs(dto.faqs) : event.faqs,
		});

		if (dto.accessCode !== undefined) {
			const normalizedAccessCode = this.normalizeSecret(dto.accessCode);
			event.accessCodeHash = normalizedAccessCode ? this.hashSecret(normalizedAccessCode) : null;
			event.accessCodeUpdatedAt = normalizedAccessCode ? new Date() : null;
		}
		if (nextVisibility === 'public') {
			event.accessCodeHash = null;
			event.accessCodeUpdatedAt = null;
		}

		if (ticketTypes) {
			event.ticketTypes = await this.reconcileTicketTypes(event, ticketTypes);
		}

		const saved = await this.eventsRepository.save(event);
		await this.financialLedgerService.delayPendingOrganizerNetForEventDateChange(
			saved,
			previousPayoutAnchor,
			saved.endsAt || saved.startsAt,
			user,
		);
		if (generatedPrivateAccessToken) {
			await this.revokePrivateAccessTokens(saved.id, user?.id ?? null);
			await this.createPrivateAccessTokenRecord(saved, generatedPrivateAccessToken, user?.id ?? null);
		}
		if (nextVisibility === 'public' && event.visibility === 'public') {
			await this.revokePrivateAccessTokens(saved.id, user?.id ?? null);
		}
		await this.auditService.log(
			'event.updated',
			user,
			'event',
			saved.id,
			this.buildChanges(before, this.pickEventAuditFields(saved)),
			{
				organizationId: saved.organization?.id,
				organizationName: saved.organization?.name,
				eventTitle: saved.title,
				...(dateChange.changed ? {
					dateChange: {
						...dateChange,
						confirmed: Boolean(dateChangeConfirmed),
						reason: dateChangeReason?.trim() || null,
						impactedOrderCount,
					},
				} : {}),
			},
			request,
		);
		if (dateChange.changed && impactedOrderCount > 0 && dateChangeConfirmed) {
			await this.notifyTicketBuyersAboutDateChange(saved, dateChange, dateChangeReason);
		}
		return generatedPrivateAccessToken ? this.withPrivateAccessToken(saved, generatedPrivateAccessToken) : this.toDashboardEvent(saved);
	}

	updateStatus(id: string, status: EventEntity['status'], user?: { id: string; role: Role }, request?: Request) {
		return this.update(id, { status }, user, request);
	}

	async ensurePrivateLink(id: string, user?: { id: string; role: Role }, request?: Request) {
		const event = await this.findOneEntity(id, user);
		if ((event.visibility || 'public') !== 'private') {
			throw new BadRequestException('Only private events can have private links.');
		}
		if (event.privateAccessToken) {
			return {
				event: this.toDashboardEvent(event),
				privateAccessToken: event.privateAccessToken,
				urlPath: `/events/${event.slug}?access=${encodeURIComponent(event.privateAccessToken)}`,
			};
		}

		if (event.privateAccessTokenHash) {
			await this.ensurePrivateAccessTokenRecordFromHash(event, event.privateAccessTokenHash, user?.id ?? null);
		}

		const privateAccessToken = this.generatePrivateAccessToken();
		event.privateAccessToken = privateAccessToken;
		event.privateAccessTokenHash = this.hashSecret(privateAccessToken);
		const saved = await this.eventsRepository.save(event);
		await this.createPrivateAccessTokenRecord(saved, privateAccessToken, user?.id ?? null);
		await this.auditService.log(
			'event.private_link.created',
			user,
			'event',
			saved.id,
			{ privateAccessToken: { before: 'missing', after: 'created' } },
			{
				organizationId: saved.organization?.id,
				organizationName: saved.organization?.name,
				eventTitle: saved.title,
			},
			request,
		);
		return {
			event: this.withPrivateAccessToken(saved, privateAccessToken),
			privateAccessToken,
			urlPath: `/events/${saved.slug}?access=${encodeURIComponent(privateAccessToken)}`,
		};
	}

	async regeneratePrivateLink(id: string, user?: { id: string; role: Role }, request?: Request) {
		const event = await this.findOneEntity(id, user);
		if ((event.visibility || 'public') !== 'private') {
			throw new BadRequestException('Only private events can have private links.');
		}
		const privateAccessToken = this.generatePrivateAccessToken();
		event.privateAccessToken = privateAccessToken;
		event.privateAccessTokenHash = this.hashSecret(privateAccessToken);
		const saved = await this.eventsRepository.save(event);
		await this.revokePrivateAccessTokens(saved.id, user?.id ?? null);
		await this.createPrivateAccessTokenRecord(saved, privateAccessToken, user?.id ?? null);
		await this.auditService.log(
			'event.private_link.regenerated',
			user,
			'event',
			saved.id,
			{ privateAccessToken: { before: 'revoked', after: 'regenerated' } },
			{
				organizationId: saved.organization?.id,
				organizationName: saved.organization?.name,
				eventTitle: saved.title,
			},
			request,
		);
		return {
			event: this.withPrivateAccessToken(saved, privateAccessToken),
			privateAccessToken,
			urlPath: `/events/${saved.slug}?access=${encodeURIComponent(privateAccessToken)}`,
		};
	}

	private async reconcileTicketTypes(
		event: EventEntity,
		ticketTypes: NonNullable<CreateEventDto['ticketTypes']>,
	) {
		const existingTypes = await this.ticketTypesRepository.find({
			where: { event: { id: event.id } },
		});
		const nextTypes: TicketTypeEntity[] = [];
		const usedExistingIds = new Set<string>();

		for (const ticket of ticketTypes) {
			const existing = ticket.id
				? existingTypes.find((item) => item.id === ticket.id)
				: existingTypes.find((item) => item.name.toLowerCase() === ticket.name.toLowerCase());
			if (existing) {
				if (Number(ticket.quantity) < Number(existing.quantitySold || 0)) {
					throw new BadRequestException(`${existing.name} quantity cannot be lower than tickets already sold`);
				}
				Object.assign(existing, {
					name: ticket.name,
					price: ticket.price,
					quantity: ticket.quantity,
					limitPerPerson: ticket.limitPerPerson ?? null,
					admissionType: ticket.admissionType ?? existing.admissionType ?? 'single',
					groupSize: ticket.admissionType === 'group' ? Math.max(2, Number(ticket.groupSize || existing.groupSize || 2)) : null,
					attendeeDetailsRequired: Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails),
					collectGroupAttendeeDetails: ticket.admissionType === 'group' ? Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails) : false,
					salesStartAt: this.toDateOrNull(ticket.salesStartAt),
					salesEndAt: this.toDateOrNull(ticket.salesEndAt),
					description: ticket.description ?? null,
					includeCharges: ticket.includeCharges ?? false,
					status: Number(ticket.quantity) <= Number(existing.quantitySold || 0) ? 'sold_out' : existing.status === 'sold_out' ? 'active' : existing.status,
				});
				usedExistingIds.add(existing.id);
				nextTypes.push(existing);
			} else {
				nextTypes.push(this.ticketTypesRepository.create({
					...ticket,
					admissionType: ticket.admissionType ?? 'single',
					groupSize: ticket.admissionType === 'group' ? Math.max(2, Number(ticket.groupSize || 2)) : null,
					attendeeDetailsRequired: Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails),
					collectGroupAttendeeDetails: ticket.admissionType === 'group' ? Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails) : false,
					salesStartAt: this.toDateOrNull(ticket.salesStartAt),
					salesEndAt: this.toDateOrNull(ticket.salesEndAt),
					event,
				}));
			}
		}

		const removedTypes = existingTypes.filter((ticket) => !usedExistingIds.has(ticket.id));
		for (const removed of removedTypes) {
			if (Number(removed.quantitySold || 0) > 0) {
				removed.status = 'paused';
				nextTypes.push(removed);
				continue;
			}
			await this.ticketTypesRepository.delete({ id: removed.id });
		}

		return nextTypes;
	}

	private isAdminRole(role: Role) {
		return [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF].includes(role);
	}

	private validatePricing(dto: Partial<CreateEventDto>) {
		dto.ticketTypes?.forEach((ticket, index) => {
			this.validatePaidMinimum(ticket.price, `ticketTypes[${index}].price`);
			this.validateTicketSalesWindow(ticket, `ticketTypes[${index}]`);
		});

		dto.addOns?.forEach((addOn, index) => {
			if (!addOn || typeof addOn !== 'object' || !('price' in addOn)) return;
			this.validatePaidMinimum((addOn as { price?: unknown }).price, `addOns[${index}].price`);
		});
	}

	private getEventDateChange(
		event: EventEntity,
		nextStartsAt: Date,
		nextEndsAt: Date,
		nextTimezone?: string,
	) {
		const previousStartsAt = this.toDateOrNull(event.startsAt);
		const previousEndsAt = this.toDateOrNull(event.endsAt || event.startsAt);
		const normalizedNextStartsAt = this.toDateOrNull(nextStartsAt);
		const normalizedNextEndsAt = this.toDateOrNull(nextEndsAt || nextStartsAt);
		const previousTimezone = event.timezone || null;
		const normalizedNextTimezone = nextTimezone === undefined ? previousTimezone : nextTimezone || null;
		const previousStartMs = previousStartsAt?.getTime() ?? null;
		const previousEndMs = previousEndsAt?.getTime() ?? null;
		const nextStartMs = normalizedNextStartsAt?.getTime() ?? null;
		const nextEndMs = normalizedNextEndsAt?.getTime() ?? null;

		return {
			changed:
				previousStartMs !== nextStartMs ||
				previousEndMs !== nextEndMs ||
				previousTimezone !== normalizedNextTimezone,
			previousStartsAt: previousStartsAt?.toISOString() ?? null,
			previousEndsAt: previousEndsAt?.toISOString() ?? null,
			nextStartsAt: normalizedNextStartsAt?.toISOString() ?? null,
			nextEndsAt: normalizedNextEndsAt?.toISOString() ?? null,
			previousTimezone,
			nextTimezone: normalizedNextTimezone,
			startChanged: previousStartMs !== nextStartMs,
			endChanged: previousEndMs !== nextEndMs,
			timezoneChanged: previousTimezone !== normalizedNextTimezone,
		};
	}

	private async countImpactedOrders(eventId: string) {
		return this.ticketOrdersRepository
			.createQueryBuilder('ticket_order')
			.where('ticket_order."eventId" = :eventId', { eventId })
			.andWhere('ticket_order.status = :status', { status: 'paid' })
			.getCount();
	}

	private validateOrganizerDateChangePolicy({
		event,
		nextStartsAt,
		nextEndsAt,
		dateChange,
		impactedOrderCount,
		dateChangeConfirmed,
	}: {
		event: EventEntity;
		nextStartsAt: Date;
		nextEndsAt: Date;
		dateChange: ReturnType<EventsService['getEventDateChange']>;
		impactedOrderCount: number;
		dateChangeConfirmed?: boolean;
	}) {
		if (!dateChange.changed) return;

		const currentStartsAt = this.toDateOrNull(event.startsAt);
		const currentEndsAt = this.toDateOrNull(event.endsAt || event.startsAt);
		const normalizedNextStartsAt = this.toDateOrNull(nextStartsAt);
		const normalizedNextEndsAt = this.toDateOrNull(nextEndsAt || nextStartsAt);

		if (!currentStartsAt || !currentEndsAt) {
			throw new BadRequestException('Current event date is invalid. Please refresh and try again.');
		}
		if (!normalizedNextStartsAt || !normalizedNextEndsAt) {
			throw new BadRequestException('Enter a valid event start and end date.');
		}
		if (normalizedNextEndsAt.getTime() < normalizedNextStartsAt.getTime()) {
			throw new BadRequestException('Event end date must be after the start date.');
		}

		const now = Date.now();
		const eventStarted = currentStartsAt.getTime() <= now;
		const eventEnded = currentEndsAt.getTime() <= now;

		if (eventStarted && normalizedNextStartsAt.getTime() !== currentStartsAt.getTime()) {
			throw new BadRequestException('This event has already started. You can only extend the event end time.');
		}

		if (eventStarted && normalizedNextEndsAt.getTime() < currentEndsAt.getTime()) {
			throw new BadRequestException('This event has already started. You can only extend the event end time.');
		}

		if (eventEnded && normalizedNextEndsAt.getTime() <= currentEndsAt.getTime()) {
			throw new BadRequestException('This event has ended. Use the extend flow by setting a later end time.');
		}

		if (event.status !== 'draft' && impactedOrderCount > 0 && !dateChangeConfirmed) {
			throw new BadRequestException(
				'DATE_CHANGE_CONFIRMATION_REQUIRED: Changing the event date or time may affect ticket holders, refunds, influencer campaigns, and check-in. Buyers will be notified of this change.',
			);
		}
	}

	private async notifyTicketBuyersAboutDateChange(
		event: EventEntity,
		dateChange: ReturnType<EventsService['getEventDateChange']>,
		reason?: string,
	) {
		const orders = await this.ticketOrdersRepository.find({
			where: { event: { id: event.id }, status: 'paid' },
			order: { paidAt: 'DESC', createdAt: 'DESC' },
		});
		const recipients = new Map<string, { name: string; email: string }>();
		orders.forEach((order) => {
			const email = order.customerEmail?.trim().toLowerCase();
			if (!email || recipients.has(email)) return;
			recipients.set(email, { name: order.customerName || 'there', email: order.customerEmail });
		});
		if (!recipients.size) return;

		const eventUrl = this.getPublicEventUrl(event);
		const rows = [
			{ label: 'Event', value: event.title },
			{ label: 'Previous date/time', value: this.formatEventDateRange(dateChange.previousStartsAt, dateChange.previousEndsAt, dateChange.previousTimezone) },
			{ label: 'New date/time', value: this.formatEventDateRange(dateChange.nextStartsAt, dateChange.nextEndsAt, dateChange.nextTimezone) },
			{ label: 'Timezone', value: dateChange.nextTimezone || dateChange.previousTimezone || 'Event timezone' },
			...(reason?.trim() ? [{ label: 'Reason', value: reason.trim() }] : []),
		];

		await Promise.all(
			Array.from(recipients.values()).map((recipient) =>
				this.notificationsService.queueEmail(
					recipient.email,
					`Update: ${event.title} date/time changed`,
					this.notificationsService.buildBrandedEmail({
						eyebrow: 'Event update',
						title: 'An event you booked has a new date or time',
						greeting: `Hello ${recipient.name},`,
						intro: `The organiser updated the schedule for ${event.title}. Please review the new date and time below.`,
						rows,
						action: eventUrl ? { label: 'View Event', url: eventUrl } : undefined,
						note: 'Your ticket remains valid. If this change affects your plans, please review the event refund policy or contact support.',
					}),
				),
			),
		);
	}

	private formatEventDateRange(start?: string | null, end?: string | null, timeZone?: string | null) {
		const startDate = this.toDateOrNull(start);
		const endDate = this.toDateOrNull(end);
		const formatter = new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: timeZone || 'UTC',
		});
		const formattedStart = startDate ? formatter.format(startDate) : 'Not set';
		const formattedEnd = endDate ? formatter.format(endDate) : 'Not set';
		return formattedStart === formattedEnd ? formattedStart : `${formattedStart} - ${formattedEnd}`;
	}

	private getPublicEventUrl(event: EventEntity) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL') || this.configService.get<string>('APP_URL');
		if (!frontendUrl) return null;
		return `${frontendUrl.replace(/\/+$/, '')}/events/${event.slug || event.id}`;
	}

	private async resolveEventTaxSettings(
		dto: Partial<CreateEventDto>,
		nextStatus: EventEntity['status'],
		existing?: EventEntity,
	) {
		const settings = await this.platformSettingsService.getPricingSettings();
		const country = dto.country ?? existing?.country ?? null;
		const state = dto.state ?? existing?.state ?? null;
		const isVirtual = dto.isVirtual ?? existing?.isVirtual ?? false;
		const supported = !isVirtual && this.isSupportedVenueSpiceTaxRegion(country, state, settings.supportedTaxRegions);
		const defaultTaxCode = settings.stripeTaxCode?.trim() || null;
		const venuePostalCode = dto.venuePostalCode?.trim() || existing?.venuePostalCode || null;
		const venueAddressTaxConfirmed = Boolean(dto.venueAddressTaxConfirmed ?? existing?.venueAddressTaxConfirmed ?? false);
		const venueAddressTaxConsentText = dto.venueAddressTaxConsentText?.trim()
			|| existing?.venueAddressTaxConsentText
			|| this.defaultVenueAddressTaxConsentText();

		if (supported && settings.stripeAutomaticTaxEnabled) {
			if (nextStatus === 'published') {
				if (!venuePostalCode) {
					throw new BadRequestException('Venue ZIP/postal code is required for tax calculation.');
				}
				if (!venueAddressTaxConfirmed) {
					throw new BadRequestException('Confirm that the venue address and ZIP/postal code are accurate for tax calculation.');
				}
			}
			const addressConfirmationChanged = (
				dto.venueAddressTaxConfirmed !== undefined ||
				dto.venueAddressTaxConsentText !== undefined ||
				existing?.taxCollectionMode !== 'stripe_tax'
			);
			return {
				taxCollectionMode: 'stripe_tax' as const,
				taxResponsibility: 'venue_spice' as const,
				organizerTaxRate: 0,
				organizerTaxLabel: null,
				organizerTaxPermitConfirmed: false,
				organizerTaxConsentAt: null,
				organizerTaxConsentText: null,
				venueAddressTaxConfirmed,
				venueAddressTaxConfirmedAt: venueAddressTaxConfirmed
					? addressConfirmationChanged
						? new Date()
						: existing?.venueAddressTaxConfirmedAt ?? new Date()
					: null,
				venueAddressTaxConsentText: venueAddressTaxConfirmed ? venueAddressTaxConsentText : null,
				taxCode: dto.taxCode?.trim() || existing?.taxCode || defaultTaxCode,
			};
		}

		const requestedMode = dto.taxCollectionMode ?? existing?.taxCollectionMode ?? 'none';
		const manualTaxRequested = requestedMode === 'organizer_manual';
		const organizerTaxRate = this.roundTaxRate(dto.organizerTaxRate ?? existing?.organizerTaxRate ?? 0);
		const organizerTaxPermitConfirmed = Boolean(dto.organizerTaxPermitConfirmed ?? existing?.organizerTaxPermitConfirmed ?? false);
		const organizerTaxConsentText = dto.organizerTaxConsentText?.trim()
			|| existing?.organizerTaxConsentText
			|| this.defaultOrganizerTaxConsentText();

		if (requestedMode === 'stripe_tax' && !supported) {
			throw new BadRequestException('Venue Spice tax collection is currently available only for supported tax regions.');
		}
		if (manualTaxRequested && !settings.allowOrganizerManualTax) {
			throw new BadRequestException('Organizer manual tax collection is currently disabled.');
		}
		if (nextStatus === 'published' && manualTaxRequested) {
			if (organizerTaxRate <= 0) {
				throw new BadRequestException('Enter the organizer tax rate before publishing this event.');
			}
			if (!organizerTaxPermitConfirmed) {
				throw new BadRequestException('Confirm that you have authority to collect and remit this event tax.');
			}
		}

		const consentChanged = manualTaxRequested && (
			dto.organizerTaxPermitConfirmed !== undefined ||
			dto.organizerTaxRate !== undefined ||
			dto.organizerTaxConsentText !== undefined ||
			existing?.taxCollectionMode !== 'organizer_manual'
		);

		return {
			taxCollectionMode: manualTaxRequested ? 'organizer_manual' as const : 'none' as const,
			taxResponsibility: 'organizer' as const,
			organizerTaxRate: manualTaxRequested ? organizerTaxRate : 0,
			organizerTaxLabel: manualTaxRequested ? (dto.organizerTaxLabel?.trim() || existing?.organizerTaxLabel || 'Tax') : null,
			organizerTaxPermitConfirmed: manualTaxRequested ? organizerTaxPermitConfirmed : false,
			organizerTaxConsentAt: manualTaxRequested && organizerTaxPermitConfirmed
				? consentChanged
					? new Date()
					: existing?.organizerTaxConsentAt ?? new Date()
				: null,
			organizerTaxConsentText: manualTaxRequested ? organizerTaxConsentText : null,
			venueAddressTaxConfirmed: false,
			venueAddressTaxConfirmedAt: null,
			venueAddressTaxConsentText: null,
			taxCode: dto.taxCode?.trim() || existing?.taxCode || defaultTaxCode,
		};
	}

	private eventToTaxDto(event: EventEntity): Partial<CreateEventDto> {
		return {
			country: event.country ?? undefined,
			state: event.state ?? undefined,
			venuePostalCode: event.venuePostalCode ?? undefined,
			isVirtual: event.isVirtual,
			taxCollectionMode: event.taxCollectionMode,
			taxResponsibility: event.taxResponsibility,
			organizerTaxRate: Number(event.organizerTaxRate || 0),
			organizerTaxLabel: event.organizerTaxLabel ?? undefined,
			organizerTaxPermitConfirmed: event.organizerTaxPermitConfirmed,
			organizerTaxConsentText: event.organizerTaxConsentText ?? undefined,
			venueAddressTaxConfirmed: event.venueAddressTaxConfirmed,
			venueAddressTaxConsentText: event.venueAddressTaxConsentText ?? undefined,
			taxCode: event.taxCode ?? undefined,
		};
	}

	private isSupportedVenueSpiceTaxRegion(country?: string | null, state?: string | null, configuredRegions = 'US:TX') {
		const countryCode = this.normalizeCountryCode(country);
		const stateCode = this.normalizeStateCode(state);
		if (!countryCode || !stateCode) return false;
		return configuredRegions
			.split(',')
			.map((region) => region.trim().toUpperCase())
			.filter(Boolean)
			.includes(`${countryCode}:${stateCode}`);
	}

	private normalizeCountryCode(value?: string | null) {
		const normalized = String(value || '').trim().toLowerCase();
		if (!normalized) return '';
		if (['us', 'usa', 'united states', 'united states of america'].includes(normalized)) return 'US';
		return normalized.length === 2 ? normalized.toUpperCase() : normalized;
	}

	private normalizeStateCode(value?: string | null) {
		const normalized = String(value || '').trim().toLowerCase();
		if (!normalized) return '';
		if (['tx', 'texas'].includes(normalized)) return 'TX';
		return normalized.length === 2 ? normalized.toUpperCase() : normalized;
	}

	private roundTaxRate(value: unknown) {
		const numeric = Number(value);
		return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100000) / 100000 : 0;
	}

	private defaultOrganizerTaxConsentText() {
		return 'I confirm that I am responsible for determining, collecting, reporting, and remitting applicable taxes for this event, and that I have the required permit or authority to collect any tax rate I enter.';
	}

	private defaultVenueAddressTaxConsentText() {
		return 'I confirm that the venue address, city, state, country, and ZIP/postal code are accurate for tax calculation.';
	}

	private pickEventAuditFields(event: EventEntity) {
		return {
			title: event.title,
			slug: event.slug,
			description: event.description,
			category: event.category,
			organizerName: event.organizerName,
			venue: event.venue,
			country: event.country,
			state: event.state,
			city: event.city,
			streetAddress: event.streetAddress,
			venuePostalCode: event.venuePostalCode,
			timezone: event.timezone,
			isVirtual: event.isVirtual,
			startsAt: this.toIsoOrNull(event.startsAt),
			endsAt: this.toIsoOrNull(event.endsAt),
			coverImageUrl: event.coverImageUrl,
			imageUrls: this.stableJson(event.imageUrls || []),
			socialLinks: this.stableJson(event.socialLinks || {}),
			appearances: this.stableJson(event.appearances || []),
			addOns: this.stableJson(event.addOns || []),
			faqs: this.stableJson(event.faqs || []),
			status: event.status,
			visibility: event.visibility,
			refundsAllowed: event.refundsAllowed,
			refundCutoffHours: event.refundCutoffHours,
			refundablePercentage: event.refundablePercentage,
			taxCollectionMode: event.taxCollectionMode,
			taxResponsibility: event.taxResponsibility,
			organizerTaxRate: Number(event.organizerTaxRate || 0),
			organizerTaxLabel: event.organizerTaxLabel,
			organizerTaxPermitConfirmed: event.organizerTaxPermitConfirmed,
			organizerTaxConsentAt: this.toIsoOrNull(event.organizerTaxConsentAt),
			organizerTaxConsentText: event.organizerTaxConsentText,
			venueAddressTaxConfirmed: event.venueAddressTaxConfirmed,
			venueAddressTaxConfirmedAt: this.toIsoOrNull(event.venueAddressTaxConfirmedAt),
			venueAddressTaxConsentText: event.venueAddressTaxConsentText,
			taxCode: event.taxCode,
			ticketTypes: this.stableJson(
				(event.ticketTypes || []).map((ticket) => ({
					id: ticket.id,
					name: ticket.name,
					price: Number(ticket.price || 0),
					quantity: Number(ticket.quantity || 0),
					quantitySold: Number(ticket.quantitySold || 0),
					limitPerPerson: ticket.limitPerPerson,
					admissionType: ticket.admissionType ?? 'single',
					groupSize: ticket.groupSize,
					attendeeDetailsRequired: Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails),
					collectGroupAttendeeDetails: ticket.admissionType === 'group' ? Boolean(ticket.attendeeDetailsRequired ?? ticket.collectGroupAttendeeDetails) : false,
					salesStartAt: this.toIsoOrNull(ticket.salesStartAt),
					salesEndAt: this.toIsoOrNull(ticket.salesEndAt),
					description: ticket.description,
					includeCharges: ticket.includeCharges,
					status: ticket.status,
				})).sort((first, second) => String(first.id || first.name).localeCompare(String(second.id || second.name))),
			),
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

	private toIsoOrNull(value?: Date | string | null) {
		if (!value) return null;
		const date = value instanceof Date ? value : new Date(value);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}

	private toDateOrNull(value?: Date | string | null) {
		if (!value) return null;
		const date = value instanceof Date ? value : new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}

	private stableJson(value: unknown) {
		return JSON.stringify(value ?? null);
	}

	private cloneJson<T>(value: T): T {
		return JSON.parse(JSON.stringify(value ?? null));
	}

	private validatePaidMinimum(value: unknown, field: string) {
		const price = Number(value ?? 0);
		if (!Number.isFinite(price) || price < 0) {
			throw new BadRequestException(`${field} must be a valid non-negative amount`);
		}
		if (price > 0 && price < MIN_PAID_PRICE) {
			throw new BadRequestException(`${field} must be 0 for free or at least $1.00 for paid items`);
		}
	}

	private validateTicketSalesWindow(ticket: { salesStartAt?: string | Date | null; salesEndAt?: string | Date | null }, field: string) {
		const startsAt = this.toDateOrNull(ticket.salesStartAt);
		const endsAt = this.toDateOrNull(ticket.salesEndAt);
		if (ticket.salesStartAt && !startsAt) {
			throw new BadRequestException(`${field}.salesStartAt must be a valid date`);
		}
		if (ticket.salesEndAt && !endsAt) {
			throw new BadRequestException(`${field}.salesEndAt must be a valid date`);
		}
		if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
			throw new BadRequestException(`${field}.salesEndAt must be after salesStartAt`);
		}
	}

	private validateTicketSalesWindowsForEvent(ticketTypes: NonNullable<CreateEventDto['ticketTypes']>, eventEndsAt: Date) {
		ticketTypes.forEach((ticket, index) => {
			const salesEndAt = this.toDateOrNull(ticket.salesEndAt);
			if (salesEndAt && eventEndsAt && salesEndAt.getTime() > eventEndsAt.getTime()) {
				throw new BadRequestException(`ticketTypes[${index}].salesEndAt cannot be after the event end date`);
			}
		});
	}

	private async validatePaidEventPayoutReadiness(dto: Partial<CreateEventDto>, organization: OrganizationEntity) {
		if (dto.status !== 'published') return;
		const hasPaidTickets = (dto.ticketTypes || []).some((ticket) => Number(ticket.price || 0) > 0);
		const hasPaidAddOns = (dto.addOns || []).some((addOn) => Number((addOn as { price?: unknown })?.price || 0) > 0);
		if (!hasPaidTickets && !hasPaidAddOns) return;
		await this.organizationsService.syncStripeAccountStatus(organization);
		if (organization.stripeChargesEnabled && organization.stripePayoutsEnabled && organization.stripeDetailsSubmitted) return;
		throw new BadRequestException('Connect Stripe payouts before publishing paid events');
	}

	private validateCreateDate(startsAt: Date) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (startsAt.getTime() < today.getTime()) {
			throw new BadRequestException('Event start date cannot be in the past');
		}
	}

	private async ensureOrganizationAccess(organizationId: string, ownerUserId: string) {
		const organization = await this.organizationsRepository.findOne({
			where: { id: organizationId },
		});
		if (!organization) throw new BadRequestException('Organization not found');
		if (organization.ownerUserId !== ownerUserId) {
			throw new ForbiddenException('You cannot access this organization');
		}
	}

	private ensureEventAccess(event: EventEntity, ownerUserId: string) {
		if (event.organization?.ownerUserId !== ownerUserId) {
			throw new ForbiddenException('You cannot access this event');
		}
	}

	private async getPrivateEventAccessState(event: EventEntity, accessToken?: string): Promise<{ allowed: boolean; reason?: 'missing_token' | 'invalid_token' | 'revoked_token' }> {
		if ((event.visibility || 'public') !== 'private') return { allowed: true };
		const normalizedToken = accessToken?.trim();
		if (!normalizedToken) return { allowed: false, reason: 'missing_token' };
		const tokenHash = this.hashSecret(normalizedToken);
		const tokenRecord = await this.privateAccessTokensRepository.findOne({
			where: { event: { id: event.id }, tokenHash },
		});
		if (tokenRecord?.status === 'revoked') return { allowed: false, reason: 'revoked_token' };
		if (tokenRecord?.status === 'active') {
			tokenRecord.lastUsedAt = new Date();
			tokenRecord.useCount = Number(tokenRecord.useCount || 0) + 1;
			await this.privateAccessTokensRepository.save(tokenRecord);
			return { allowed: true };
		}
		if (event.privateAccessToken && normalizedToken === event.privateAccessToken) {
			await this.createPrivateAccessTokenRecord(event, normalizedToken, null);
			event.privateAccessTokenHash = tokenHash;
			await this.eventsRepository.save(event);
			return { allowed: true };
		}
		if (this.safeCompareHash(normalizedToken, event.privateAccessTokenHash)) return { allowed: true };
		return { allowed: false, reason: 'invalid_token' };
	}

	private validateDraftTransition({
		currentStatus,
		nextStatus,
		currentEndsAt,
		nextEndsAt,
		isCreate = false,
	}: {
		currentStatus: EventEntity['status'];
		nextStatus: EventEntity['status'];
		currentEndsAt: Date;
		nextEndsAt: Date;
		isCreate?: boolean;
	}) {
		const isMovingIntoDraft = currentStatus !== 'draft' && nextStatus === 'draft';
		const isMovingOutOfDraft = currentStatus === 'draft' && nextStatus !== 'draft';
		const currentExpired = this.isExpired(currentEndsAt);
		const nextExpired = this.isExpired(nextEndsAt);

		if (nextStatus === 'published' && nextExpired) {
			throw new BadRequestException('Expired events cannot be published');
		}

		if (!isCreate && isMovingIntoDraft && currentExpired && nextExpired) {
			throw new BadRequestException('Expired events cannot be moved to draft');
		}

		if (!isCreate && isMovingOutOfDraft && currentExpired && nextExpired) {
			throw new BadRequestException('Expired draft events cannot be published');
		}
	}

	private isExpired(value: Date) {
		return value.getTime() < Date.now();
	}

	private normalizeRefundCutoffHours(value?: number | null) {
		const numeric = Number(value ?? 24);
		if (!Number.isFinite(numeric)) return 24;
		return Math.max(0, Math.floor(numeric));
	}

	private normalizeRefundablePercentage(value?: number | null) {
		const numeric = Number(value ?? 100);
		if (!Number.isFinite(numeric)) return 100;
		return Math.min(100, Math.max(0, Math.floor(numeric)));
	}

	private normalizeFaqs(faqs?: Array<{ question?: unknown; answer?: unknown }> | null) {
		return (faqs || [])
			.map((faq) => ({
				question: String(faq.question ?? '').trim().slice(0, 220),
				answer: String(faq.answer ?? '').trim().slice(0, 1200),
			}))
			.filter((faq) => faq.question && faq.answer)
			.slice(0, 20);
	}

	private toPublicEvent(event: EventEntity) {
		const organization = event.organization;
		const {
			privateAccessToken: _privateAccessToken,
			privateAccessTokenHash: _privateAccessTokenHash,
			accessCodeHash: _accessCodeHash,
			privateAccessTokens: _privateAccessTokens,
			...publicEvent
		} = event;
		return {
			...publicEvent,
			organization: organization ? {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				organizerUsername: organization.organizerUsername,
				logoUrl: organization.logoUrl,
			} : undefined,
			organizerPayoutReady: Boolean(
				organization?.stripeChargesEnabled &&
				organization?.stripePayoutsEnabled &&
				organization?.stripeDetailsSubmitted,
			),
		};
	}

	private toPublicListingEvent(event: EventEntity) {
		const publicEvent = this.toPublicEvent(event);
		if ((event.visibility || 'public') !== 'private') return publicEvent;

		return {
			...publicEvent,
			ticketTypes: [],
			addOns: [],
			organizerPayoutReady: undefined,
		};
	}

	private toDashboardEvent(event: EventEntity) {
		const {
			privateAccessToken: _privateAccessToken,
			privateAccessTokenHash: _privateAccessTokenHash,
			accessCodeHash: _accessCodeHash,
			privateAccessTokens: _privateAccessTokens,
			...dashboardEvent
		} = event;
		return {
			...dashboardEvent,
			privateAccessToken: event.privateAccessToken || null,
			hasAccessCode: Boolean(event.accessCodeHash),
		};
	}

	private slugify(value: string) {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)+/g, '');
	}

	private async buildClonedEventTitle(title: string) {
		const baseTitle = `${title} Copy`;
		const existing = await this.eventsRepository
			.createQueryBuilder('event')
			.where('event.title = :baseTitle OR event.title LIKE :copyPattern', {
				baseTitle,
				copyPattern: `${baseTitle} (%)`,
			})
			.getMany();
		if (!existing.length) return baseTitle;
		return `${baseTitle} (${existing.length + 1})`;
	}

	private async buildUniqueSlug(baseSlug: string, excludedEventId?: string) {
		const normalizedBase = baseSlug || `event-${Date.now()}`;
		let candidate = normalizedBase;
		let suffix = 2;
		while (true) {
			const existing = await this.eventsRepository.findOne({ where: { slug: candidate } });
			if (!existing || existing.id === excludedEventId) return candidate;
			candidate = `${normalizedBase}-${suffix}`;
			suffix += 1;
		}
	}

	private generatePrivateAccessToken() {
		return randomBytes(24).toString('base64url');
	}

	private hashSecret(value: string) {
		return createHash('sha256').update(value.trim()).digest('hex');
	}

	private safeCompareHash(value: string, hash?: string | null) {
		if (!hash) return false;
		const incoming = Buffer.from(this.hashSecret(value));
		const stored = Buffer.from(hash);
		return incoming.length === stored.length && timingSafeEqual(incoming, stored);
	}

	private normalizeSecret(value?: string | null) {
		const normalized = value?.trim();
		return normalized || null;
	}

	private async createPrivateAccessTokenRecord(event: EventEntity, privateAccessToken: string, createdByUserId?: string | null) {
		return this.privateAccessTokensRepository.save(this.privateAccessTokensRepository.create({
			event,
			tokenHash: this.hashSecret(privateAccessToken),
			status: 'active',
			createdByUserId: createdByUserId || null,
			useCount: 0,
		}));
	}

	private async ensurePrivateAccessTokenRecordFromHash(event: EventEntity, tokenHash: string, createdByUserId?: string | null) {
		const existing = await this.privateAccessTokensRepository.findOne({
			where: { event: { id: event.id }, tokenHash },
		});
		if (existing) return existing;
		return this.privateAccessTokensRepository.save(this.privateAccessTokensRepository.create({
			event,
			tokenHash,
			status: 'active',
			createdByUserId: createdByUserId || null,
			useCount: 0,
		}));
	}

	private async revokePrivateAccessTokens(eventId: string, revokedByUserId?: string | null) {
		const activeTokens = await this.privateAccessTokensRepository.find({
			where: { event: { id: eventId }, status: 'active' },
		});
		if (!activeTokens.length) return;
		const now = new Date();
		await this.privateAccessTokensRepository.save(activeTokens.map((token) => ({
			...token,
			status: 'revoked' as const,
			revokedAt: now,
			revokedByUserId: revokedByUserId || null,
		})));
	}

	private withPrivateAccessToken(event: EventEntity, privateAccessToken: string) {
		return {
			...this.toDashboardEvent(event),
			privateAccessToken,
		};
	}

	private toPrivateAccessGate(reason?: 'missing_token' | 'invalid_token' | 'revoked_token' | 'invalid_code') {
		return {
			requiresAccess: true,
			visibility: 'private' as const,
			reason: reason || 'missing_token',
		};
	}

	private isUuid(value: string) {
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
	}
}
