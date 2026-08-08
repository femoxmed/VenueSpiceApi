import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Role } from '../common/enums/role.enum';
import { EventEntity } from '../events/entities/event.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationMemberEntity } from '../organizations/entities/organization-member.entity';
import { IssuedTicketEntity } from '../ticket-orders/entities/issued-ticket.entity';
import { ScanTicketDto } from './dto/scan-ticket.dto';

type CheckInUser = { id: string; email?: string; role: Role };

@Injectable()
export class CheckInService {
	constructor(
		@InjectRepository(EventEntity)
		private readonly eventsRepository: Repository<EventEntity>,
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		@InjectRepository(IssuedTicketEntity)
		private readonly issuedTicketsRepository: Repository<IssuedTicketEntity>,
		@InjectRepository(OrganizationMemberEntity)
		private readonly organizationMembersRepository: Repository<OrganizationMemberEntity>,
		private readonly auditService: AuditService,
	) {}

	async listEvents(user: CheckInUser, organizationId?: string) {
		const query = this.eventsRepository
			.createQueryBuilder('event')
			.leftJoinAndSelect('event.organization', 'organization')
			.leftJoinAndSelect('event.ticketTypes', 'ticketTypes')
			.where('event.status IN (:...statuses)', { statuses: ['published', 'archived'] })
			.orderBy('event.startsAt', 'DESC');

		if (organizationId) {
			await this.ensureOrganizationAccess(organizationId, user);
			query.andWhere('organization.id = :organizationId', { organizationId });
		} else if (!this.isPlatformUser(user)) {
			query.andWhere(
				new Brackets((builder) => {
					builder
						.where('organization.ownerUserId = :userId', { userId: user.id })
						.orWhere(
							`organization.id IN (
								SELECT member.organization_id
								FROM organization_members member
								WHERE member.user_id = :userId
								AND member.status = :memberStatus
							)`,
							{ userId: user.id, memberStatus: 'active' },
						);
				}),
			);
		}

		const events = await query.getMany();
		return events.map((event) => this.mapEvent(event));
	}

	async stats(eventId: string, user: CheckInUser) {
		const event = await this.getEventForCheckIn(eventId, user);
		const tickets = await this.issuedTicketsRepository.find({
			where: { event: { id: event.id } },
			relations: ['ticketType', 'order'],
			order: { createdAt: 'DESC' },
		});

		const total = tickets.length;
		const checkedIn = tickets.filter((ticket) => ticket.status === 'checked_in').length;
		const voided = tickets.filter((ticket) => ['void', 'refunded'].includes(ticket.status)).length;
		const pending = tickets.filter((ticket) => ticket.status === 'valid').length;
		const recent = tickets
			.filter((ticket) => ticket.checkedInAt)
			.sort((a, b) => Number(b.checkedInAt) - Number(a.checkedInAt))
			.slice(0, 12)
			.map((ticket) => this.mapTicket(ticket));

		return {
			event: this.mapEvent(event),
			total,
			checkedIn,
			pending,
			voided,
			recent,
		};
	}

	async scan(dto: ScanTicketDto, user: CheckInUser) {
		const event = await this.getEventForCheckIn(dto.eventId, user);
		const code = this.normalizeCode(dto.code);
		const ticket = await this.issuedTicketsRepository.findOne({
			where: { code },
			relations: ['event', 'event.organization', 'ticketType', 'order'],
		});

		if (!ticket) {
			return {
				status: 'invalid',
				message: 'Ticket not found. Check the code and try again.',
			};
		}

		if (ticket.event?.id !== event.id) {
			return {
				status: 'wrong_event',
				message: 'This ticket belongs to a different event.',
				ticket: this.mapTicket(ticket),
			};
		}

		if (ticket.order?.status !== 'paid') {
			return {
				status: 'unpaid',
				message: 'This order has not been paid successfully.',
				ticket: this.mapTicket(ticket),
			};
		}

		if (['void', 'refunded'].includes(ticket.status)) {
			return {
				status: ticket.status,
				message: ticket.status === 'refunded' ? 'This ticket has been refunded.' : 'This ticket is no longer valid.',
				ticket: this.mapTicket(ticket),
			};
		}

		if (ticket.status === 'checked_in') {
			return {
				status: 'already_checked_in',
				message: `Already checked in${ticket.checkedInAt ? ` at ${ticket.checkedInAt.toLocaleString('en-US')}` : ''}.`,
				ticket: this.mapTicket(ticket),
			};
		}

		ticket.status = 'checked_in';
		ticket.checkedInAt = new Date();
		ticket.checkedInByUserId = user.id;
		const saved = await this.issuedTicketsRepository.save(ticket);

		await this.auditService.log('ticket.checked_in', user, 'issued_ticket', saved.id, {
			status: { from: 'valid', to: 'checked_in' },
			checkedInAt: saved.checkedInAt,
		}, {
			eventId: event.id,
			organizationId: event.organization?.id,
			source: dto.source || 'manual',
		});

		return {
			status: 'checked_in',
			message: 'Ticket checked in successfully.',
			ticket: this.mapTicket(saved),
		};
	}

	async search(eventId: string, user: CheckInUser, term?: string) {
		await this.getEventForCheckIn(eventId, user);
		const search = `%${String(term || '').trim().toLowerCase()}%`;
		if (search.length < 4) return [];

		const tickets = await this.issuedTicketsRepository
			.createQueryBuilder('ticket')
			.leftJoinAndSelect('ticket.ticketType', 'ticketType')
			.leftJoinAndSelect('ticket.order', 'order')
			.leftJoinAndSelect('ticket.event', 'event')
			.where('event.id = :eventId', { eventId })
			.andWhere(
				new Brackets((builder) => {
					builder
						.where('LOWER(ticket.code) LIKE :search', { search })
						.orWhere('LOWER(ticket.holderName) LIKE :search', { search })
						.orWhere('LOWER(ticket.holderEmail) LIKE :search', { search })
						.orWhere('LOWER(order.customerName) LIKE :search', { search })
						.orWhere('LOWER(order.customerEmail) LIKE :search', { search });
				}),
			)
			.orderBy('ticket.createdAt', 'DESC')
			.take(20)
			.getMany();

		return tickets.map((ticket) => this.mapTicket(ticket));
	}

	private async getEventForCheckIn(eventId: string, user: CheckInUser) {
		const event = await this.eventsRepository.findOne({
			where: { id: eventId },
			relations: ['organization', 'ticketTypes'],
		});
		if (!event) {
			throw new ForbiddenException('You do not have access to this event.');
		}
		await this.ensureOrganizationAccess(event.organization.id, user);
		return event;
	}

	private async ensureOrganizationAccess(organizationId: string, user: CheckInUser) {
		if (this.isPlatformUser(user)) return;
		const organization = await this.organizationsRepository.findOne({
			where: { id: organizationId },
		});
		if (organization?.ownerUserId === user.id) return;

		const membership = await this.organizationMembersRepository.findOne({
			where: { organizationId, userId: user.id, status: 'active' },
		});
		if (!membership) {
			throw new ForbiddenException('You do not have access to check in tickets for this event.');
		}
	}

	private isPlatformUser(user: CheckInUser) {
		return [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN].includes(user.role);
	}

	private normalizeCode(value: string) {
		const trimmed = String(value || '').trim();
		try {
			const url = new URL(trimmed);
			return (url.searchParams.get('ticket') || url.pathname.split('/').filter(Boolean).pop() || trimmed).trim().toUpperCase();
		} catch {
			return trimmed.toUpperCase();
		}
	}

	private mapEvent(event: EventEntity) {
		return {
			id: event.id,
			title: event.title,
			status: event.status,
			startsAt: event.startsAt,
			endsAt: event.endsAt,
			timezone: event.timezone,
			venue: event.venue,
			city: event.city,
			state: event.state,
			organizationId: event.organization?.id,
			organizationName: event.organization?.name,
		};
	}

	private mapTicket(ticket: IssuedTicketEntity) {
		return {
			id: ticket.id,
			code: ticket.code,
			status: ticket.status,
			holderName: ticket.holderName,
			holderEmail: ticket.holderEmail,
			ticketType: ticket.ticketType?.name || 'Ticket',
			eventId: ticket.event?.id,
			eventTitle: ticket.event?.title,
			orderId: ticket.order?.id,
			checkedInAt: ticket.checkedInAt,
			checkedInByUserId: ticket.checkedInByUserId,
		};
	}
}
