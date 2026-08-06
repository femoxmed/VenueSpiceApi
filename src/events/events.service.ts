import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Request } from 'express';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { Role } from '../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventEntity } from './entities/event.entity';
import { TicketTypeEntity } from './entities/ticket-type.entity';

const MIN_PAID_PRICE = 1;

@Injectable()
export class EventsService {
	constructor(
		@InjectRepository(EventEntity)
		private readonly eventsRepository: Repository<EventEntity>,
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		@InjectRepository(TicketTypeEntity)
		private readonly ticketTypesRepository: Repository<TicketTypeEntity>,
		private readonly organizationsService: OrganizationsService,
		private readonly auditService: AuditService,
	) {}

	findAll(organizationId?: string, user?: { id: string; role: Role }) {
		if (user && !this.isAdminRole(user.role)) {
			if (!organizationId) {
				return this.eventsRepository.find({
					where: { organization: { ownerUserId: user.id } },
					order: { startsAt: 'ASC', createdAt: 'DESC' },
				});
			}
			return this.findAllForOwner(organizationId, user.id);
		}

		return this.eventsRepository.find({
			where: organizationId ? { organization: { id: organizationId } } : {},
			order: { startsAt: 'ASC', createdAt: 'DESC' },
		});
	}

	private async findAllForOwner(organizationId: string, ownerUserId: string) {
		await this.ensureOrganizationAccess(organizationId, ownerUserId);
		return this.eventsRepository.find({
			where: { organization: { id: organizationId } },
			order: { startsAt: 'ASC', createdAt: 'DESC' },
		});
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
			.then((events) => events.map((event) => this.toPublicEvent(event)));
	}

	async findPublicOne(idOrSlug: string) {
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
		return this.toPublicEvent(event);
	}

	async findOne(idOrSlug: string, user?: { id: string; role: Role }) {
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
		this.validateDraftTransition({
			currentStatus: 'draft',
			nextStatus: dto.status || 'draft',
			currentEndsAt: endsAt || startsAt,
			nextEndsAt: endsAt || startsAt,
			isCreate: true,
		});

		const event = this.eventsRepository.create({
			...dto,
			slug,
			startsAt,
			endsAt,
			organization,
			ticketTypes: dto.ticketTypes || [],
			imageUrls: dto.imageUrls || [],
			socialLinks: dto.socialLinks || {},
			appearances: dto.appearances || [],
			addOns: dto.addOns || [],
		});
		return this.eventsRepository.save(event);
	}

	async update(
		id: string,
		dto: Partial<CreateEventDto> & { status?: EventEntity['status'] },
		user?: { id: string; role: Role },
		request?: Request,
	) {
		this.validatePricing(dto);
		const event = await this.findOne(id, user);
		const before = this.pickEventAuditFields(event);
		if (dto.slug && dto.slug !== event.slug) {
			const existing = await this.eventsRepository.findOne({ where: { slug: dto.slug } });
			if (existing) throw new BadRequestException('Event slug already exists');
		}

		const { ticketTypes, ...eventPatch } = dto;
		const nextStartsAt = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
		const nextEndsAt = dto.endsAt ? new Date(dto.endsAt) : event.endsAt || nextStartsAt;
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
					description: ticket.description ?? undefined,
					includeCharges: ticket.includeCharges,
				})),
				addOns: dto.addOns ?? event.addOns,
			},
			event.organization,
		);

		Object.assign(event, {
			...eventPatch,
			startsAt: nextStartsAt,
			endsAt: nextEndsAt,
			imageUrls: dto.imageUrls ?? event.imageUrls,
			socialLinks: dto.socialLinks ?? event.socialLinks,
			appearances: dto.appearances ?? event.appearances,
			addOns: dto.addOns ?? event.addOns,
		});

		if (ticketTypes) {
			event.ticketTypes = await this.reconcileTicketTypes(event, ticketTypes);
		}

		const saved = await this.eventsRepository.save(event);
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
			},
			request,
		);
		return saved;
	}

	updateStatus(id: string, status: EventEntity['status'], user?: { id: string; role: Role }, request?: Request) {
		return this.update(id, { status }, user, request);
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
					description: ticket.description ?? null,
					includeCharges: ticket.includeCharges ?? false,
					status: Number(ticket.quantity) <= Number(existing.quantitySold || 0) ? 'sold_out' : existing.status === 'sold_out' ? 'active' : existing.status,
				});
				usedExistingIds.add(existing.id);
				nextTypes.push(existing);
			} else {
				nextTypes.push(this.ticketTypesRepository.create({ ...ticket, event }));
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
		});

		dto.addOns?.forEach((addOn, index) => {
			if (!addOn || typeof addOn !== 'object' || !('price' in addOn)) return;
			this.validatePaidMinimum((addOn as { price?: unknown }).price, `addOns[${index}].price`);
		});
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
			timezone: event.timezone,
			isVirtual: event.isVirtual,
			startsAt: this.toIsoOrNull(event.startsAt),
			endsAt: this.toIsoOrNull(event.endsAt),
			coverImageUrl: event.coverImageUrl,
			imageUrls: this.stableJson(event.imageUrls || []),
			socialLinks: this.stableJson(event.socialLinks || {}),
			appearances: this.stableJson(event.appearances || []),
			addOns: this.stableJson(event.addOns || []),
			status: event.status,
			refundCutoffHours: event.refundCutoffHours,
			ticketTypes: this.stableJson(
				(event.ticketTypes || []).map((ticket) => ({
					id: ticket.id,
					name: ticket.name,
					price: Number(ticket.price || 0),
					quantity: Number(ticket.quantity || 0),
					quantitySold: Number(ticket.quantitySold || 0),
					limitPerPerson: ticket.limitPerPerson,
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

	private stableJson(value: unknown) {
		return JSON.stringify(value ?? null);
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

	private toPublicEvent(event: EventEntity) {
		const organization = event.organization;
		return {
			...event,
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
