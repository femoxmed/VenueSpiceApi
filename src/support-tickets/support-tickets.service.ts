import {
	Injectable,
	NotFoundException,
	ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicketEntity } from './entities/support-ticket.entity';
import {
	SupportTicketMessageEntity,
	TicketMessageSource,
} from './entities/support-ticket-message.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class SupportTicketsService {
	constructor(
		@InjectRepository(SupportTicketEntity)
		private readonly supportTicketsRepository: Repository<SupportTicketEntity>,
		@InjectRepository(SupportTicketMessageEntity)
		private readonly ticketMessagesRepository: Repository<SupportTicketMessageEntity>,
		@InjectRepository(UserEntity)
		private readonly customersRepository: Repository<UserEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(ServiceBookingEntity)
		private readonly serviceBookingsRepository: Repository<ServiceBookingEntity>,
		@InjectRepository(ProductEntity)
		private readonly productsRepository: Repository<ProductEntity>,
		private readonly notificationsService: NotificationsService,
	) {}

	findAll() {
		return this.supportTicketsRepository.find({ order: { updatedAt: 'DESC' } });
	}

	findByCustomer(userId: string) {
		return this.supportTicketsRepository.find({
			where: { customer: { id: userId } },
			order: { updatedAt: 'DESC' },
		});
	}

	findOne(id: string) {
		return this.supportTicketsRepository.findOne({ where: { id } });
	}

	async create(dto: CreateSupportTicketDto) {
		const customer = await this.customersRepository.findOne({
			where: { id: dto.customerId },
		});

		if (!customer) {
			throw new NotFoundException('Customer not found');
		}

		const request = dto.requestId
			? await this.serviceBookingsRepository.findOne({
					where: { id: dto.requestId },
				})
			: null;
		if (dto.requestId && !request) throw new NotFoundException('Request not found');

		const product = dto.productId
			? await this.productsRepository.findOne({ where: { id: dto.productId } })
			: null;
		if (dto.productId && !product) throw new NotFoundException('Product not found');

		const ticket = await this.supportTicketsRepository.save(
			this.supportTicketsRepository.create({
				customer,
				subject: dto.subject,
				description: dto.description,
				status: dto.status || 'open',
				request,
				product,
				chatThreadId: dto.chatThreadId,
				}),
		);

		ticket.emailThreadId = this.buildEmailThreadId(ticket.id);
		return this.supportTicketsRepository.save(ticket);
	}

	async update(id: string, dto: UpdateSupportTicketDto) {
		const ticket = await this.findOne(id);
		if (!ticket) throw new NotFoundException('Ticket not found');

		const { requestId, productId, ...ticketUpdates } = dto;
		Object.assign(ticket, ticketUpdates);

		if (requestId !== undefined) {
			ticket.request = requestId
				? await this.serviceBookingsRepository.findOne({
						where: { id: requestId },
					})
				: null;
			if (requestId && !ticket.request) {
				throw new NotFoundException('Request not found');
			}
		}

		if (productId !== undefined) {
			ticket.product = productId
				? await this.productsRepository.findOne({ where: { id: productId } })
				: null;
			if (productId && !ticket.product) {
				throw new NotFoundException('Product not found');
			}
		}

		return this.supportTicketsRepository.save(ticket);
	}

	async assignTicket(id: string, dto: AssignTicketDto) {
		const ticket = await this.findOne(id);
		if (!ticket) throw new NotFoundException('Ticket not found');

		if (dto.assignedTo && dto.assignedTo !== 'null') {
			const user = await this.usersRepository.findOne({
				where: { id: dto.assignedTo },
			});
			if (!user) throw new NotFoundException('Assigned user not found');
			ticket.assignedUser = user;
		} else {
			ticket.assignedUser = null;
		}

		return this.supportTicketsRepository.save(ticket);
	}

	async updateStatus(id: string, status: string) {
		const ticket = await this.findOne(id);
		if (!ticket) throw new NotFoundException('Ticket not found');

		ticket.status = status;
		return this.supportTicketsRepository.save(ticket);
	}

	async delete(id: string) {
		const ticket = await this.findOne(id);
		if (!ticket) throw new NotFoundException('Ticket not found');

		return this.supportTicketsRepository.remove(ticket);
	}

	async findOneWithMessages(id: string) {
		const ticket = await this.supportTicketsRepository.findOne({
			where: { id },
		});

		if (!ticket) return null;

		const messages = await this.ticketMessagesRepository.find({
			where: { ticket: { id } },
			relations: ['author'],
			order: {
				createdAt: 'ASC',
			},
		});

		return {
			...ticket,
			messages,
		};
	}

	async findOneWithMessagesForCustomer(id: string, customerId: string) {
		const ticket = await this.supportTicketsRepository.findOne({
			where: { id },
		});

		if (!ticket) throw new NotFoundException('Ticket not found');
		if (ticket.customer.id !== customerId) {
			throw new ForbiddenException('You do not have access to this ticket');
		}

		const messages = await this.ticketMessagesRepository.find({
			where: { ticket: { id }, isInternalNote: false },
			relations: ['author'],
			order: { createdAt: 'ASC' },
		});

		return { ...ticket, messages };
	}

	async addCustomerMessage(
		ticketId: string,
		authorId: string,
		dto: CreateTicketMessageDto,
	) {
		await this.findOneWithMessagesForCustomer(ticketId, authorId);
		return this.addMessage(
			ticketId,
			authorId,
			{ ...dto, isInternalNote: false },
			false,
		);
	}

	async addMessage(
		ticketId: string,
		authorId: string,
		dto: CreateTicketMessageDto,
		isAdmin: boolean,
	) {
		const ticket = await this.findOne(ticketId);
		if (!ticket) throw new NotFoundException('Ticket not found');

		const author = await this.usersRepository.findOne({
			where: { id: authorId },
		});
		if (!author) throw new NotFoundException('Author not found');

		// Prevent customers from adding internal notes
		if (dto.isInternalNote && !isAdmin) {
			throw new ForbiddenException('Only admins can add internal notes');
		}

		const message = this.ticketMessagesRepository.create({
			ticket,
			author,
			content: dto.content,
			isInternalNote: dto.isInternalNote || false,
			attachments: dto.attachments,
			source: dto.source || (isAdmin ? TicketMessageSource.ADMIN : TicketMessageSource.APP),
			externalMessageId: dto.externalMessageId,
			emailThreadId: dto.emailThreadId || ticket.emailThreadId,
		});

		const savedMessage = await this.ticketMessagesRepository.save(message);

		if (savedMessage.emailThreadId && !ticket.emailThreadId) {
			ticket.emailThreadId = savedMessage.emailThreadId;
			await this.supportTicketsRepository.save(ticket);
		}

		if (!savedMessage.isInternalNote) {
			await this.queueConversationEmail(ticket, savedMessage, author, isAdmin);
		}

		return savedMessage;
	}

	async addEmailMessage(dto: {
		ticketId?: string;
		emailThreadId?: string;
		fromEmail?: string;
		content?: string;
		externalMessageId?: string;
		subject?: string;
		text?: string;
		html?: string;
		from?: string;
		sender?: string;
		From?: string;
		TextBody?: string;
		HtmlBody?: string;
		'body-plain'?: string;
		'body-html'?: string;
		'stripped-text'?: string;
		'Message-Id'?: string;
	}) {
		const normalized = this.normalizeInboundEmail(dto);
		const ticket = await this.findTicketForInboundEmail(normalized);
		if (!ticket) throw new NotFoundException('Ticket not found');

		const author = await this.usersRepository.findOne({
			where: { email: normalized.fromEmail },
		});
		if (!author) throw new NotFoundException('Sender not found');

		return this.addMessage(
			ticket.id,
			author.id,
			{
				content: normalized.content,
				source: TicketMessageSource.EMAIL,
				externalMessageId: normalized.externalMessageId,
				emailThreadId: ticket.emailThreadId || normalized.emailThreadId,
			},
			author.role === Role.ADMIN || author.role === Role.SUPER_ADMIN,
		);
	}

	private normalizeInboundEmail(dto: {
		ticketId?: string;
		emailThreadId?: string;
		fromEmail?: string;
		content?: string;
		externalMessageId?: string;
		subject?: string;
		text?: string;
		html?: string;
		from?: string;
		sender?: string;
		From?: string;
		TextBody?: string;
		HtmlBody?: string;
		'body-plain'?: string;
		'body-html'?: string;
		'stripped-text'?: string;
		'Message-Id'?: string;
	}) {
		const text =
			dto.content ||
			dto.text ||
			dto['stripped-text'] ||
			dto['body-plain'] ||
			dto.TextBody;
		const html = dto.html || dto['body-html'] || dto.HtmlBody;
		const from = dto.fromEmail || dto.from || dto.sender || dto.From || '';
		const searchable = [
			dto.emailThreadId,
			dto.subject,
			text,
			html,
		]
			.filter(Boolean)
			.join('\n');

		return {
			ticketId: dto.ticketId || this.extractTicketId(searchable),
			emailThreadId:
				dto.emailThreadId || this.extractEmailThreadId(searchable),
			fromEmail: this.extractEmailAddress(from),
			content: (text || this.htmlToText(html || '')).trim(),
			externalMessageId: dto.externalMessageId || dto['Message-Id'],
		};
	}

	private async findTicketForInboundEmail(dto: {
		ticketId?: string;
		emailThreadId?: string;
	}) {
		if (dto.ticketId) return this.findOne(dto.ticketId);
		if (!dto.emailThreadId) return null;

		return this.supportTicketsRepository.findOne({
			where: { emailThreadId: dto.emailThreadId },
		});
	}

	private buildEmailThreadId(ticketId: string) {
		return `aquzera-ticket-${ticketId}`;
	}

	private extractEmailThreadId(value: string) {
		return value.match(/aquzera-ticket-[0-9a-f-]{36}/i)?.[0];
	}

	private extractTicketId(value: string) {
		return value.match(
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
		)?.[0];
	}

	private extractEmailAddress(value: string) {
		return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || value;
	}

	private htmlToText(value: string) {
		return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
	}

	private async queueConversationEmail(
		ticket: SupportTicketEntity,
		message: SupportTicketMessageEntity,
		author: UserEntity,
		isAdmin: boolean,
	) {
		const recipient = isAdmin ? ticket.customer : ticket.assignedUser;
		if (!recipient?.email || recipient.id === author.id) return;

		await this.notificationsService.queueEmail(
			recipient.email,
			`Re: ${ticket.subject} [${ticket.emailThreadId || this.buildEmailThreadId(ticket.id)}]`,
			this.notificationsService.buildSupportTicketMessageEmail(
				recipient.fullName || recipient.email,
				ticket.subject,
				author.fullName || author.email,
				message.content,
				ticket.id,
				ticket.emailThreadId || this.buildEmailThreadId(ticket.id),
			),
				{
					headers: {
						'X-Aquzera-Ticket-Id': ticket.id,
						'X-Aquzera-Thread-Id':
							ticket.emailThreadId || this.buildEmailThreadId(ticket.id),
					},
				},
			);
	}

	async getStats() {
		const total = await this.supportTicketsRepository.count();
		const open = await this.supportTicketsRepository.count({
			where: { status: 'open' },
		});
		const inProgress = await this.supportTicketsRepository.count({
			where: { status: 'in-progress' },
		});
		const resolved = await this.supportTicketsRepository.count({
			where: { status: 'resolved' },
		});
		const closed = await this.supportTicketsRepository.count({
			where: { status: 'closed' },
		});

		return {
			total,
			open,
			inProgress,
			resolved,
			closed,
		};
	}
}
