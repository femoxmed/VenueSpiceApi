import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from '../agents/entities/agent.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { EventEntity } from '../events/entities/event.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { Role } from '../common/enums/role.enum';
import { CreateDiscountCouponDto } from './dto/create-discount-coupon.dto';
import { DiscountCouponEntity } from './entities/discount-coupon.entity';

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
	) {}

	async findAll(organizationId?: string, user?: { id: string; role: Role }) {
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
		if (status === 'pending_influencer_approval') {
			console.log(`[TEMP INFLUENCER APPROVAL] ${agent.email} needs to approve coupon ${code}`);
		}

		return this.couponsRepository.save(
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
		if (['pending_influencer_signup', 'pending_influencer_approval', 'declined'].includes(status)) {
			throw new BadRequestException('This status is controlled by the influencer approval flow');
		}
		coupon.status = status;
		return this.couponsRepository.save(coupon);
	}

	async approve(id: string, user: { id: string; role: Role }) {
		const coupon = await this.couponsRepository.findOne({ where: { id } });
		if (!coupon) throw new NotFoundException('Discount coupon not found');
		const agent = await this.ensureInfluencerCanDecide(coupon, user.id);

		agent.status = 'active';
		await this.agentsRepository.save(agent);
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

	private isAdminRole(role: Role) {
		return [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF].includes(role);
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

		// TODO: send an influencer registration email when the mailer/invite flow is finalized.
		console.log(`[TEMP INFLUENCER INVITE] ${normalizedEmail} invited to register as an EventBox influencer`);

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
