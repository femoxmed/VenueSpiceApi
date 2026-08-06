import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEntity } from '../events/entities/event.entity';
import { Role } from '../common/enums/role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { CreateAgentDto } from './dto/create-agent.dto';
import { AgentEntity } from './entities/agent.entity';
import { ReferralCodeEntity } from './entities/referral-code.entity';

@Injectable()
export class AgentsService {
	constructor(
		@InjectRepository(AgentEntity)
		private readonly agentsRepository: Repository<AgentEntity>,
		@InjectRepository(ReferralCodeEntity)
		private readonly referralCodesRepository: Repository<ReferralCodeEntity>,
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		@InjectRepository(EventEntity)
		private readonly eventsRepository: Repository<EventEntity>,
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
		private readonly notificationsService: NotificationsService,
		private readonly configService: ConfigService,
	) {}

	async findAll(organizationId?: string, user?: { id: string; role: Role }) {
		if (user && !this.isAdminRole(user.role)) {
			if (!organizationId) {
				return this.agentsRepository.find({
					where: { organization: { ownerUserId: user.id } },
					order: { createdAt: 'DESC' },
				});
			}
			await this.ensureOrganizationAccess(organizationId, user.id);
		}

		return this.agentsRepository.find({
			where: organizationId ? { organization: { id: organizationId } } : {},
			order: { createdAt: 'DESC' },
		});
	}

	async create(dto: CreateAgentDto, user?: { id: string; role: Role }) {
		const organization = await this.organizationsRepository.findOne({
			where: { id: dto.organizationId },
		});
		if (!organization) throw new BadRequestException('Organization not found');
		if (user && !this.isAdminRole(user.role) && organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot create influencers for this organization');
		}

		const agent = await this.agentsRepository.save(
			this.agentsRepository.create({
				fullName: dto.fullName,
				email: dto.email,
				phone: dto.phone,
				status: dto.status || 'active',
				organization,
			}),
		);

		if (dto.eventId || dto.code) {
			await this.createReferralCode(agent.id, dto.eventId, dto.code, user);
			return this.findOne(agent.id, user);
		}

		return agent;
	}

	async findOne(id: string, user?: { id: string; role: Role }) {
		const agent = await this.agentsRepository.findOne({ where: { id } });
		if (!agent) throw new NotFoundException('Agent not found');
		if (user && !this.isAdminRole(user.role) && agent.organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot access this influencer');
		}
		return agent;
	}

	async performance(id: string, user?: { id: string; role: Role }) {
		const agent = await this.findOne(id, user);
		const orders = await this.ticketOrdersRepository.find({
			where: {
				referralCode: {
					agent: { id: agent.id },
				},
				status: 'paid',
			},
			order: { paidAt: 'DESC', createdAt: 'DESC' },
		});
		const rate = 0.1;
		const rows = orders.flatMap((order) =>
			order.items.map((item) => {
				const totalCost = Number(item.lineTotal || 0);
				return {
					id: `${order.id}-${item.id}`,
					date: (order.paidAt || order.createdAt).toISOString(),
					event: order.event.title,
					item: item.ticketName,
					quantity: item.quantity,
					totalCost,
					commission: totalCost * rate,
				};
			}),
		);
		const totalRevenue = rows.reduce((sum, row) => sum + row.totalCost, 0);
		const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
		const chart = this.buildPerformanceChart(rows);

		return {
			influencer: agent,
			summary: {
				totalOrders: orders.length,
				totalQuantity,
				totalRevenue,
				totalCommission: totalRevenue * rate,
				averageOrderValue: orders.length ? totalRevenue / orders.length : 0,
			},
			chart,
			rows,
		};
	}

	async updateStatus(id: string, status: AgentEntity['status'], user?: { id: string; role: Role }) {
		const agent = await this.findOne(id, user);
		agent.status = status;
		return this.agentsRepository.save(agent);
	}

	async createReferralCode(agentId: string, eventId?: string, requestedCode?: string, user?: { id: string; role: Role }) {
		const agent = await this.findOne(agentId, user);
		const event = eventId
			? await this.eventsRepository.findOne({ where: { id: eventId } })
			: null;
		if (eventId && !event) throw new BadRequestException('Event not found');
		if (event && event.organization.id !== agent.organization.id) {
			throw new BadRequestException('Event does not belong to this influencer organization');
		}

		let code = requestedCode?.trim().toUpperCase() || this.buildCode(agent.fullName);
		for (let i = 0; i < 5; i += 1) {
			const existing = await this.referralCodesRepository.findOne({ where: { code } });
			if (!existing) break;
			code = this.buildCode(agent.fullName);
		}

		const existing = await this.referralCodesRepository.findOne({ where: { code } });
		if (existing) throw new BadRequestException('Could not generate unique referral code');

		const referralCode = await this.referralCodesRepository.save(
			this.referralCodesRepository.create({ agent, event, code }),
		);
		if (event) {
			await this.sendInfluencerEventInvitation(agent, event, referralCode.code);
		}
		return referralCode;
	}

	private async sendInfluencerEventInvitation(agent: AgentEntity, event: EventEntity, code: string) {
		const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
		const loginUrl = this.joinUrl(frontendUrl, '/login');
		const signupUrl = this.joinUrl(frontendUrl, '/signup');
		const eventUrl = event.slug ? this.joinUrl(frontendUrl, `/events/${event.slug}`) : frontendUrl;
		const organizationName = event.organization?.name || agent.organization?.name || 'Venue Spice organizer';
		const location = event.isVirtual
			? 'Virtual event'
			: [event.venue, event.city, event.state, event.country].filter(Boolean).join(', ') || 'Venue to be announced';

		await this.notificationsService.queueEmail(
			agent.email,
			`You have been invited to promote ${event.title}`,
			this.notificationsService.buildBrandedEmail({
				eyebrow: 'Influencer campaign invite',
				title: 'You have been added to an event campaign',
				greeting: `Hello ${agent.fullName},`,
				intro: `${organizationName} added you as an influencer for ${event.title}. Sign in or create an influencer account to review the campaign and start sharing your code.`,
				rows: [
					{ label: 'Event', value: event.title },
					{ label: 'Organizer', value: organizationName },
					{ label: 'Starts', value: event.startsAt },
					{ label: 'Location', value: location },
					{ label: 'Referral code', value: code },
				],
				action: { label: 'Sign in', url: loginUrl },
				secondaryAction: { label: 'Create account', url: signupUrl },
				note: `You can preview the event here: <a href="${eventUrl}">${eventUrl}</a>`,
			}),
		);
	}

	private joinUrl(base: string, path: string) {
		return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
	}

	private buildCode(name: string) {
		const prefix = name
			.toUpperCase()
			.replace(/[^A-Z0-9]+/g, '')
			.slice(0, 6)
			.padEnd(3, 'X');
		return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
	}

	private buildPerformanceChart(rows: Array<{ date: string; quantity: number; totalCost: number; commission: number }>) {
		const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
		const buckets = new Map<string, { label: string; quantity: number; revenue: number; commission: number }>();

		for (let index = 5; index >= 0; index -= 1) {
			const date = new Date();
			date.setMonth(date.getMonth() - index);
			const key = `${date.getFullYear()}-${date.getMonth()}`;
			buckets.set(key, {
				label: monthFormatter.format(date),
				quantity: 0,
				revenue: 0,
				commission: 0,
			});
		}

		rows.forEach((row) => {
			const date = new Date(row.date);
			const key = `${date.getFullYear()}-${date.getMonth()}`;
			const bucket = buckets.get(key);
			if (!bucket) return;
			bucket.quantity += row.quantity;
			bucket.revenue += row.totalCost;
			bucket.commission += row.commission;
		});

		return Array.from(buckets.values());
	}

	private isAdminRole(role: Role) {
		return [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF].includes(role);
	}

	private async ensureOrganizationAccess(organizationId: string, ownerUserId: string) {
		const organization = await this.organizationsRepository.findOne({
			where: { id: organizationId },
		});
		if (!organization) throw new BadRequestException('Organization not found');
		if (organization.ownerUserId !== ownerUserId) {
			throw new ForbiddenException('You cannot access influencers for this organization');
		}
	}
}
