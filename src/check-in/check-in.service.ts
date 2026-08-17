import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Role } from '../common/enums/role.enum';
import { EventEntity } from '../events/entities/event.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationMemberEntity } from '../organizations/entities/organization-member.entity';
import { IssuedTicketEntity } from '../ticket-orders/entities/issued-ticket.entity';
import { ScanTicketDto } from './dto/scan-ticket.dto';
import { UpdateTicketHolderDto } from './dto/update-ticket-holder.dto';
import { TicketAssignmentHistoryEntity } from './entities/ticket-assignment-history.entity';

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
		@InjectRepository(TicketAssignmentHistoryEntity)
		private readonly ticketAssignmentHistoryRepository: Repository<TicketAssignmentHistoryEntity>,
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

	async lookup(dto: ScanTicketDto, user: CheckInUser) {
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

		return {
			status: 'ready',
			message: 'Ticket found. Confirm before checking in this attendee.',
			ticket: this.mapTicket(ticket),
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

	async listTickets(
		eventId: string,
		user: CheckInUser,
		query: { page?: string; pageSize?: string; search?: string; status?: string },
	) {
		await this.getEventForCheckIn(eventId, user);
		const page = Math.max(1, Number(query.page) || 1);
		const pageSize = Math.min(50, Math.max(5, Number(query.pageSize) || 12));
		const search = String(query.search || '').trim().toLowerCase();
		const status = String(query.status || '').trim();

		const builder = this.issuedTicketsRepository
			.createQueryBuilder('ticket')
			.leftJoinAndSelect('ticket.ticketType', 'ticketType')
			.leftJoinAndSelect('ticket.order', 'order')
			.leftJoinAndSelect('ticket.event', 'event')
			.where('event.id = :eventId', { eventId });

		if (status && status !== 'all') {
			builder.andWhere('ticket.status = :status', { status });
		}

		if (search) {
			builder.andWhere(
				new Brackets((searchBuilder) => {
					searchBuilder
						.where('LOWER(ticket.code) LIKE :search', { search: `%${search}%` })
						.orWhere('LOWER(ticket.holderName) LIKE :search', { search: `%${search}%` })
						.orWhere('LOWER(ticket.holderEmail) LIKE :search', { search: `%${search}%` })
						.orWhere('LOWER(ticketType.name) LIKE :search', { search: `%${search}%` })
						.orWhere('LOWER(order.customerName) LIKE :search', { search: `%${search}%` })
						.orWhere('LOWER(order.customerEmail) LIKE :search', { search: `%${search}%` });
				}),
			);
		}

		const [tickets, total] = await builder
			.orderBy('ticket.createdAt', 'DESC')
			.skip((page - 1) * pageSize)
			.take(pageSize)
			.getManyAndCount();

		return {
			items: tickets.map((ticket) => this.mapTicket(ticket)),
			total,
			page,
			pageSize,
			pageCount: Math.max(1, Math.ceil(total / pageSize)),
		};
	}

	async updateTicketHolder(ticketId: string, dto: UpdateTicketHolderDto, user: CheckInUser) {
		const ticket = await this.issuedTicketsRepository.findOne({
			where: { id: ticketId },
			relations: ['event', 'event.organization', 'ticketType', 'order'],
		});
		if (!ticket) {
			throw new ForbiddenException('You do not have access to this ticket.');
		}

		await this.ensureOrganizationAccess(ticket.event.organization.id, user);

		if (['checked_in', 'void', 'refunded'].includes(ticket.status)) {
			throw new BadRequestException('This ticket can no longer be reassigned.');
		}

		const holderName = String(dto.holderName || '').trim();
		const holderEmail = String(dto.holderEmail || '').trim().toLowerCase();
		const note = String(dto.note || '').trim() || null;

		if (!holderName || !holderEmail) {
			throw new BadRequestException('Name and email are required.');
		}

		const previous = {
			holderName: ticket.holderName,
			holderEmail: ticket.holderEmail,
		};

		if (
			previous.holderName.trim() === holderName &&
			previous.holderEmail.trim().toLowerCase() === holderEmail
		) {
			return this.mapTicketWithHistory(ticket, await this.getTicketHistory(ticket.id));
		}

		const history = this.ticketAssignmentHistoryRepository.create({
			ticket,
			event: ticket.event,
			orderId: ticket.order?.id,
			previousHolderName: ticket.holderName,
			previousHolderEmail: ticket.holderEmail,
			newHolderName: holderName,
			newHolderEmail: holderEmail,
			changedByUserId: user.id,
			changedByEmail: user.email || null,
			note,
		});
		await this.ticketAssignmentHistoryRepository.save(history);

		ticket.holderName = holderName;
		ticket.holderEmail = holderEmail;
		const saved = await this.issuedTicketsRepository.save(ticket);

		await this.auditService.log('ticket.reassigned', user, 'issued_ticket', saved.id, {
			holderName: { from: previous.holderName, to: holderName },
			holderEmail: { from: previous.holderEmail, to: holderEmail },
		}, {
			eventId: saved.event?.id,
			organizationId: saved.event?.organization?.id,
			orderId: saved.order?.id,
			note,
		});

		return this.mapTicketWithHistory(saved, await this.getTicketHistory(saved.id));
	}

	async ticketAssignmentHistory(ticketId: string, user: CheckInUser) {
		const ticket = await this.issuedTicketsRepository.findOne({
			where: { id: ticketId },
			relations: ['event', 'event.organization'],
		});
		if (!ticket) {
			throw new ForbiddenException('You do not have access to this ticket.');
		}

		await this.ensureOrganizationAccess(ticket.event.organization.id, user);
		return this.getTicketHistory(ticket.id);
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

	private async getTicketHistory(ticketId: string) {
		const history = await this.ticketAssignmentHistoryRepository.find({
			where: { ticket: { id: ticketId } },
			order: { createdAt: 'DESC' },
		});
		return history.map((item) => this.mapTicketAssignmentHistory(item));
	}

	private mapTicketWithHistory(ticket: IssuedTicketEntity, history: ReturnType<CheckInService['mapTicketAssignmentHistory']>[]) {
		return {
			...this.mapTicket(ticket),
			assignmentHistory: history,
		};
	}

	private mapTicketAssignmentHistory(item: TicketAssignmentHistoryEntity) {
		return {
			id: item.id,
			previousHolderName: item.previousHolderName,
			previousHolderEmail: item.previousHolderEmail,
			newHolderName: item.newHolderName,
			newHolderEmail: item.newHolderEmail,
			changedByUserId: item.changedByUserId,
			changedByEmail: item.changedByEmail,
			note: item.note,
			createdAt: item.createdAt,
		};
	}
}
