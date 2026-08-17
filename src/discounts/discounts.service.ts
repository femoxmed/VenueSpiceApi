import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AgentEntity } from '../agents/entities/agent.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { EventEntity } from '../events/entities/event.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { Role } from '../common/enums/role.enum';
import { CreateDiscountCouponDto } from './dto/create-discount-coupon.dto';
import { UpdateDiscountCouponDto } from './dto/update-discount-coupon.dto';
import { DiscountCouponEntity } from './entities/discount-coupon.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { ConfigService } from '@nestjs/config';
import { ReferralCodeEntity } from '../agents/entities/referral-code.entity';
import { NotificationsService } from '../notifications/notifications.service';

type PaginationQuery = { page?: string | number; pageSize?: string | number; search?: string; status?: string };

@Injectable()
export class DiscountsService {
	constructor(
		@InjectRepository(DiscountCouponEntity)
		private readonly couponsRepository: Repository<DiscountCouponEntity>,
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		@InjectRepository(EventEntity)
		private readonly eventsRepository: Repository<EventEntity>,
		@InjectRepository(AgentEntity)
		private readonly agentsRepository: Repository<AgentEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
		@InjectRepository(ReferralCodeEntity)
		private readonly referralCodesRepository: Repository<ReferralCodeEntity>,
		private readonly configService: ConfigService,
		private readonly notificationsService: NotificationsService,
	) {}

	async findAll(organizationId?: string, user?: { id: string; role: Role }, query: PaginationQuery = {}) {
		if (!this.hasPaginationQuery(query)) {
			if (user && !this.isAdminRole(user.role)) {
				if (!organizationId) {
					return this.couponsRepository.find({
						where: { organization: { ownerUserId: user.id } },
						order: { createdAt: 'DESC' },
					});
				}
				await this.ensureOrganizationAccess(organizationId, user.id);
			}

			return this.couponsRepository.find({
				where: organizationId ? { organization: { id: organizationId } } : {},
				order: { createdAt: 'DESC' },
			});
		}
		const pagination = this.parsePagination(query);
		const builder = this.couponsRepository
			.createQueryBuilder('coupon')
			.leftJoinAndSelect('coupon.organization', 'organization')
			.leftJoinAndSelect('coupon.event', 'event')
			.leftJoinAndSelect('coupon.agent', 'agent')
			.orderBy('coupon.createdAt', 'DESC')
			.skip((pagination.page - 1) * pagination.pageSize)
			.take(pagination.pageSize);

		if (user && !this.isAdminRole(user.role)) {
			if (!organizationId) {
				builder.where('organization.ownerUserId = :ownerUserId', { ownerUserId: user.id });
			} else {
				await this.ensureOrganizationAccess(organizationId, user.id);
				builder.where('organization.id = :organizationId', { organizationId });
			}
		} else if (organizationId) {
			builder.where('organization.id = :organizationId', { organizationId });
		}

		if (query.status?.trim()) {
			builder.andWhere('coupon.status = :status', { status: query.status.trim() });
		}
		if (query.search?.trim()) {
			const search = `%${query.search.trim()}%`;
			builder.andWhere(
				new Brackets((qb) => {
					qb.where('coupon.code ILIKE :search', { search })
						.orWhere('agent.fullName ILIKE :search', { search })
						.orWhere('agent.email ILIKE :search', { search })
						.orWhere('event.title ILIKE :search', { search });
				}),
			);
		}

		const [items, total] = await builder.getManyAndCount();
		return this.paginated(items, total, pagination.page, pagination.pageSize);
	}

	async create(dto: CreateDiscountCouponDto, user?: { id: string; role: Role }) {
		const organization = await this.organizationsRepository.findOne({
			where: { id: dto.organizationId },
		});
		if (!organization) throw new BadRequestException('Organization not found');
		if (user && !this.isAdminRole(user.role) && organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot create discounts for this organization');
		}

		const code = dto.code.trim().toUpperCase();
		const existing = await this.couponsRepository.findOne({ where: { code } });
		if (existing) throw new BadRequestException('Discount code already exists');

		const event = dto.eventId
			? await this.eventsRepository.findOne({ where: { id: dto.eventId } })
			: null;
		if (dto.eventId && !event) throw new BadRequestException('Event not found');
		if (event && event.organization.id !== organization.id) {
			throw new BadRequestException('Event does not belong to this organization');
		}

		const agent = dto.agentId
			? await this.agentsRepository.findOne({ where: { id: dto.agentId } })
			: await this.findOrInviteInfluencer(organization, dto.influencerEmail, dto.influencerName);
		if (!agent) throw new BadRequestException('Influencer is required');
		if (agent && agent.organization.id !== organization.id) {
			throw new BadRequestException('Influencer does not belong to this organization');
		}
		const status = this.isInfluencerReadyForApproval(agent)
			? 'pending_influencer_approval'
			: 'pending_influencer_signup';

		const coupon = await this.couponsRepository.save(
			this.couponsRepository.create({
				organization,
				event,
				agent,
				code,
				type: dto.type,
				value: dto.value,
				influencerCommissionPercent: dto.influencerCommissionPercent,
				startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
				endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
				maxUses: dto.maxUses ?? null,
				status,
			}),
		);
		await this.sendInfluencerCampaignInvitation(coupon);
		return coupon;
	}

	async findInfluencerCampaigns(user: { id: string; role: Role }) {
		const agent = await this.findAgentForInfluencerUser(user.id);
		if (!agent) return [];

		return this.couponsRepository.find({
			where: { agent: { id: agent.id } },
			order: { createdAt: 'DESC' },
		});
	}

	async findInfluencerEarnings(user: { id: string; role: Role }) {
		const agent = await this.findAgentForInfluencerUser(user.id);
		if (!agent) {
			return {
				summary: {
					totalRevenue: 0,
					totalCommission: 0,
					pending: 0,
					available: 0,
					withdrawn: 0,
					holdDays: this.getInfluencerHoldDays(),
					stripeConnected: false,
					canWithdraw: false,
				},
				rows: [],
			};
		}

		const orders = await this.ticketOrdersRepository.find({
			where: {
				referralCode: {
					agent: { id: agent.id },
				},
				status: 'paid',
			},
			order: { paidAt: 'DESC', createdAt: 'DESC' },
		});
		const coupons = await this.couponsRepository.find({
			where: { agent: { id: agent.id } },
		});
		const couponByCode = new Map(coupons.map((coupon) => [coupon.code.toUpperCase(), coupon]));
		const rows = orders.flatMap((order) => {
			const coupon = order.referralCode?.code
				? couponByCode.get(order.referralCode.code.toUpperCase())
				: undefined;
			const commissionPercent = this.resolveCommissionPercent(order, coupon);
			const orderGrossSubtotal = this.feeSnapshotNumber(order, 'grossSubtotal', order.items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0));
			const orderDiscountAmount = this.feeSnapshotNumber(order, 'discountAmount', 0);
			const orderCommission = this.feeSnapshotNumber(order, 'influencerCommission', 0);
			const availableAt = this.calculateAvailableAt(order.event);
			const earningStatus = availableAt.getTime() <= Date.now() ? 'available' : 'pending';

			return order.items.map((item) => {
				const lineTotal = Number(item.lineTotal || 0);
				const lineRatio = orderGrossSubtotal > 0 ? lineTotal / orderGrossSubtotal : 0;
				const totalCost = this.roundMoney(lineTotal - orderDiscountAmount * lineRatio);
				const commission = orderCommission > 0
					? this.roundMoney(orderCommission * lineRatio)
					: this.roundMoney(totalCost * (commissionPercent / 100));
				return {
					id: `${order.id}-${item.id}`,
					orderId: order.id,
					date: this.toSafeIso(order.paidAt || order.createdAt),
					event: order.event?.title || 'Event',
					eventId: order.event?.id || null,
					eventStartsAt: this.toSafeIso(order.event?.startsAt),
					item: item.ticketName,
					quantity: item.quantity,
					totalCost,
					commission,
					commissionPercent,
					status: earningStatus,
					availableAt: this.toSafeIso(availableAt),
					couponCode: order.referralCode?.code ?? null,
					currency: order.currency,
				};
			});
		});

		const totalRevenue = rows.reduce((sum, row) => sum + row.totalCost, 0);
		const totalCommission = rows.reduce((sum, row) => sum + row.commission, 0);
		const pending = rows
			.filter((row) => row.status === 'pending')
			.reduce((sum, row) => sum + row.commission, 0);
		const available = rows
			.filter((row) => row.status === 'available')
			.reduce((sum, row) => sum + row.commission, 0);

		return {
			influencer: agent,
			summary: {
				totalRevenue,
				totalCommission,
				pending,
				available,
				withdrawn: 0,
				holdDays: this.getInfluencerHoldDays(),
				stripeConnected: false,
				canWithdraw: available > 0,
			},
			rows,
		};
	}

	async updateStatus(id: string, status: DiscountCouponEntity['status'], user?: { id: string; role: Role }) {
		const coupon = await this.couponsRepository.findOne({ where: { id } });
		if (!coupon) throw new NotFoundException('Discount coupon not found');
		if (user && !this.isAdminRole(user.role) && coupon.organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot update discounts for this organization');
		}
		if (status === 'active' && !coupon.approvedByInfluencerAt) {
			throw new BadRequestException('Influencer approval is required before this coupon can be active');
		}
		if (['pending_influencer_signup', 'pending_influencer_approval', 'declined', 'revoked'].includes(status)) {
			throw new BadRequestException('This status is controlled by the influencer approval flow');
		}
		coupon.status = status;
		return this.couponsRepository.save(coupon);
	}

	async update(id: string, dto: UpdateDiscountCouponDto, user?: { id: string; role: Role }) {
		const coupon = await this.couponsRepository.findOne({ where: { id } });
		if (!coupon) throw new NotFoundException('Discount coupon not found');
		if (user && !this.isAdminRole(user.role) && coupon.organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot update discounts for this organization');
		}

		const startsAt = dto.startsAt !== undefined ? new Date(dto.startsAt) : coupon.startsAt;
		const endsAt = dto.endsAt !== undefined ? new Date(dto.endsAt) : coupon.endsAt;
		if (startsAt && endsAt && endsAt < startsAt) {
			throw new BadRequestException('Coupon expiry date cannot be before start date');
		}
		if (dto.maxUses !== undefined && dto.maxUses < coupon.usesCount) {
			throw new BadRequestException('Max uses cannot be lower than the current usage count');
		}

		if (dto.startsAt !== undefined) coupon.startsAt = startsAt;
		if (dto.endsAt !== undefined) coupon.endsAt = endsAt;
		if (dto.maxUses !== undefined) coupon.maxUses = dto.maxUses;

		return this.couponsRepository.save(coupon);
	}

	async approve(id: string, user: { id: string; role: Role }) {
		const coupon = await this.couponsRepository.findOne({ where: { id } });
		if (!coupon) throw new NotFoundException('Discount coupon not found');
		const agent = await this.ensureInfluencerCanDecide(coupon, user.id);

		agent.status = 'active';
		await this.agentsRepository.save(agent);
		await this.ensureReferralCodeForCoupon(coupon, agent);
		coupon.agent = agent;
		coupon.status = 'active';
		coupon.approvedByInfluencerAt = new Date();
		coupon.declinedByInfluencerAt = null;
		return this.couponsRepository.save(coupon);
	}

	async decline(id: string, user: { id: string; role: Role }) {
		const coupon = await this.couponsRepository.findOne({ where: { id } });
		if (!coupon) throw new NotFoundException('Discount coupon not found');
		await this.ensureInfluencerCanDecide(coupon, user.id);

		coupon.status = 'declined';
		coupon.declinedByInfluencerAt = new Date();
		return this.couponsRepository.save(coupon);
	}

	async revoke(id: string, user?: { id: string; role: Role }) {
		const coupon = await this.couponsRepository.findOne({ where: { id } });
		if (!coupon) throw new NotFoundException('Discount coupon not found');
		if (user && !this.isAdminRole(user.role) && coupon.organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot revoke discounts for this organization');
		}
		if (!['pending_influencer_signup', 'pending_influencer_approval'].includes(coupon.status)) {
			throw new BadRequestException('Only pending campaign invites can be revoked');
		}

		coupon.status = 'revoked';
		return this.couponsRepository.save(coupon);
	}

	private isAdminRole(role: Role) {
		return [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF].includes(role);
	}

	private async findAgentForInfluencerUser(userId: string) {
		const user = await this.usersRepository.findOne({ where: { id: userId } });
		if (!this.isValidInfluencerUser(user)) {
			throw new ForbiddenException('Only influencer accounts can access this resource');
		}
		await this.reconcilePendingInfluencerSignup(user);

		return this.agentsRepository.findOne({
			where: [
				{ user: { id: user.id } },
				{ email: user.email.toLowerCase() },
			],
			order: { createdAt: 'DESC' },
		});
	}

	private async reconcilePendingInfluencerSignup(user: UserEntity) {
		if (!user.isActive || !user.verifiedAt) return;
		const normalizedEmail = user.email.toLowerCase();
		const agents = await this.agentsRepository.find({
			where: { email: normalizedEmail },
		});
		if (!agents.length) return;

		for (const agent of agents) {
			let agentChanged = false;
			if (!agent.user) {
				agent.user = user;
				agentChanged = true;
			}
			if (agent.status !== 'active') {
				agent.status = 'active';
				agentChanged = true;
			}
			if (agentChanged) {
				await this.agentsRepository.save(agent);
			}

			const pendingCoupons = await this.couponsRepository.find({
				where: {
					agent: { id: agent.id },
					status: 'pending_influencer_signup',
				},
			});
			for (const coupon of pendingCoupons) {
				coupon.status = 'pending_influencer_approval';
				await this.couponsRepository.save(coupon);
			}
		}
	}

	private resolveCommissionPercent(order: TicketOrderEntity, coupon?: DiscountCouponEntity) {
		if (coupon) return Number(coupon.influencerCommissionPercent || 0);
		const code = order.referralCode?.code;
		if (!code) return 0;
		return 10;
	}

	private async ensureReferralCodeForCoupon(coupon: DiscountCouponEntity, agent: AgentEntity) {
		const code = coupon.code.trim().toUpperCase();
		const existing = await this.referralCodesRepository.findOne({ where: { code } });
		if (existing) return existing;
		return this.referralCodesRepository.save(
			this.referralCodesRepository.create({
				agent,
				event: coupon.event ?? null,
				code,
				status: 'active',
			}),
		);
	}

	private calculateAvailableAt(event?: EventEntity | null) {
		const holdDays = this.getInfluencerHoldDays();
		const anchor = this.toValidDate(event?.endsAt) || this.toValidDate(event?.startsAt) || new Date();
		const availableAt = new Date(anchor);
		availableAt.setDate(availableAt.getDate() + holdDays);
		return availableAt;
	}

	private toValidDate(value?: Date | string | null) {
		if (!value) return null;
		const date = value instanceof Date ? value : new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	}

	private toSafeIso(value?: Date | string | null) {
		return this.toValidDate(value)?.toISOString() ?? null;
	}

	private getInfluencerHoldDays() {
		return Number(this.configService.get<string>('INFLUENCER_EARNINGS_HOLD_DAYS', '3'));
	}

	private parsePagination(query: PaginationQuery) {
		const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
		const requestedPageSize = Number.parseInt(String(query.pageSize ?? '8'), 10) || 8;
		const pageSize = Math.min(50, Math.max(1, requestedPageSize));
		return { page, pageSize };
	}

	private hasPaginationQuery(query: PaginationQuery) {
		return Boolean(query.page ?? query.pageSize ?? query.search ?? query.status);
	}

	private paginated<T>(items: T[], total: number, page: number, pageSize: number) {
		return {
			items,
			total,
			page,
			pageSize,
			pageCount: Math.max(1, Math.ceil(total / pageSize)),
		};
	}

	private async ensureOrganizationAccess(organizationId: string, ownerUserId: string) {
		const organization = await this.organizationsRepository.findOne({
			where: { id: organizationId },
		});
		if (!organization) throw new BadRequestException('Organization not found');
		if (organization.ownerUserId !== ownerUserId) {
			throw new ForbiddenException('You cannot access discounts for this organization');
		}
	}

	private async findOrInviteInfluencer(organization: OrganizationEntity, email: string, name?: string) {
		const normalizedEmail = email.trim().toLowerCase();
		const influencerUser = await this.usersRepository.findOne({
			where: { email: normalizedEmail },
		});
		const existing = await this.agentsRepository.findOne({
			where: {
				email: normalizedEmail,
				organization: { id: organization.id },
			},
		});
		if (existing) {
			if (!existing.user && this.isValidInfluencerUser(influencerUser)) {
				existing.user = influencerUser;
				existing.status = influencerUser.isActive ? 'active' : existing.status;
				return this.agentsRepository.save(existing);
			}
			return existing;
		}
		if (this.isValidInfluencerUser(influencerUser)) {
			return this.agentsRepository.save(
				this.agentsRepository.create({
					organization,
					user: influencerUser,
					email: normalizedEmail,
					fullName: influencerUser.fullName,
					status: influencerUser.isActive ? 'active' : 'pending_invite',
				}),
			);
		}
		if (!name?.trim()) {
			throw new BadRequestException('Influencer name is required when inviting a new influencer');
		}

		return this.agentsRepository.save(
			this.agentsRepository.create({
				organization,
				email: normalizedEmail,
				fullName: name.trim(),
				status: 'pending_invite',
			}),
		);
	}

	private isValidInfluencerUser(user?: UserEntity | null): user is UserEntity {
		return Boolean(user && user.accountType === 'influencer');
	}

	private isInfluencerReadyForApproval(agent: AgentEntity) {
		return Boolean(agent.user && agent.user.isActive && agent.status === 'active');
	}

	private async sendInfluencerCampaignInvitation(coupon: DiscountCouponEntity) {
		const event = coupon.event;
		const agent = coupon.agent;
		if (!agent?.email) return;

		const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
		const loginUrl = this.joinUrl(frontendUrl, '/login');
		const signupUrl = this.joinUrl(frontendUrl, '/signup?type=influencer');
		const campaignUrl = this.joinUrl(frontendUrl, '/influencer/coupons');
		const eventUrl = event?.slug ? this.joinUrl(frontendUrl, `/events/${event.slug}`) : campaignUrl;
		const organizationName = coupon.organization?.name || agent.organization?.name || 'Venue Spice organizer';
		const location = event?.isVirtual
			? 'Virtual event'
			: [event?.venue, event?.city, event?.state, event?.country].filter(Boolean).join(', ') ||
				'Venue to be announced';
		const title = event?.title || 'a Venue Spice event';
		const actionLabel = coupon.status === 'pending_influencer_signup'
			? 'Create influencer account'
			: 'Review campaign';

		await this.notificationsService.queueEmail(
			agent.email,
			`You have been invited to promote ${title}`,
			this.notificationsService.buildBrandedEmail({
				eyebrow: 'Influencer campaign invite',
				title: 'You have been added to an event campaign',
				greeting: `Hello ${agent.fullName},`,
				intro: `${organizationName} invited you to promote ${title}. Sign in or create an influencer account to review the campaign, accept it, and share your code.`,
				rows: [
					{ label: 'Event', value: title },
					{ label: 'Organizer', value: organizationName },
					...(event?.startsAt ? [{ label: 'Starts', value: event.startsAt }] : []),
					{ label: 'Location', value: location },
					{ label: 'Coupon code', value: coupon.code },
					{ label: 'Coupon value', value: this.formatCouponValue(coupon) },
					{ label: 'Influencer commission', value: `${Number(coupon.influencerCommissionPercent || 0)}%` },
				],
				action: {
					label: actionLabel,
					url: coupon.status === 'pending_influencer_signup' ? signupUrl : campaignUrl,
				},
				secondaryAction: { label: 'Sign in', url: loginUrl },
				note: `You can preview the event here: <a href="${eventUrl}">${eventUrl}</a>`,
			}),
		);
	}

	private formatCouponValue(coupon: DiscountCouponEntity) {
		if (coupon.type === 'percentage') return `${Number(coupon.value || 0)}% off`;
		return `USD ${Number(coupon.value || 0).toFixed(2)} off`;
	}

	private joinUrl(base: string, path: string) {
		return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
	}

	private feeSnapshotNumber(order: TicketOrderEntity, key: string, fallback: number) {
		const value = order.feeSnapshot?.[key];
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : fallback;
	}

	private roundMoney(value: number) {
		return Math.round((Number(value) || 0) * 100) / 100;
	}

	private async ensureInfluencerCanDecide(coupon: DiscountCouponEntity, userId: string) {
		if (!coupon.agent) throw new BadRequestException('Coupon is not tied to an influencer');
		const user = await this.usersRepository.findOne({ where: { id: userId } });
		if (!this.isValidInfluencerUser(user) || !user?.isActive) {
			throw new ForbiddenException('Only an active influencer can approve this coupon');
		}
		if (coupon.agent.user?.id && coupon.agent.user.id !== user.id) {
			throw new ForbiddenException('This coupon belongs to another influencer');
		}
		if (coupon.agent.email.toLowerCase() !== user.email.toLowerCase()) {
			throw new ForbiddenException('This coupon belongs to another influencer');
		}
		if (!coupon.agent.user) {
			coupon.agent.user = user;
		}
		return coupon.agent;
	}
}
