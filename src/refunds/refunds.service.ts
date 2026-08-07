import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { TicketTypeEntity } from '../events/entities/ticket-type.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { PaymentIntentEntity } from '../payments/entities/payment-intent.entity';
import { IssuedTicketEntity } from '../ticket-orders/entities/issued-ticket.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import { ReviewRefundRequestDto } from './dto/review-refund-request.dto';
import { RefundRequestEntity } from './entities/refund-request.entity';

type StripeRefund = {
	id: string;
	status?: string;
	amount?: number;
	currency?: string;
	payment_intent?: string;
	error?: { message?: string };
};

@Injectable()
export class RefundsService {
	constructor(
		@InjectRepository(RefundRequestEntity)
		private readonly refundsRepository: Repository<RefundRequestEntity>,
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
		@InjectRepository(IssuedTicketEntity)
		private readonly issuedTicketsRepository: Repository<IssuedTicketEntity>,
		@InjectRepository(TicketTypeEntity)
		private readonly ticketTypesRepository: Repository<TicketTypeEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		@InjectRepository(PaymentIntentEntity)
		private readonly paymentIntentsRepository: Repository<PaymentIntentEntity>,
		private readonly configService: ConfigService,
		private readonly auditService: AuditService,
	) {}

	async createRequest(dto: CreateRefundRequestDto) {
		const order = await this.ticketOrdersRepository.findOne({ where: { id: dto.orderId } });
		if (!order) throw new NotFoundException('Ticket order not found');
		if (order.customerEmail.toLowerCase() !== dto.customerEmail.toLowerCase().trim()) {
			throw new ForbiddenException('This email does not match the ticket order');
		}
		this.ensureOrderCanBeRefunded(order);

		const existing = await this.refundsRepository.findOne({
			where: { orderId: order.id },
			order: { createdAt: 'DESC' },
		});
		if (existing && !['declined', 'failed'].includes(existing.status)) {
			throw new BadRequestException('A refund request already exists for this order');
		}

		const refund = await this.refundsRepository.save(
			this.refundsRepository.create({
				order,
				orderId: order.id,
				customerEmail: order.customerEmail,
				reason: dto.reason?.trim() || null,
				amount: Number(order.total || 0),
				currency: order.currency,
				status: 'requested',
			}),
		);

		await this.auditService.log(
			'refund.requested',
			undefined,
			'refund_request',
			refund.id,
			{ after: this.pickRefundAuditFields(refund) },
			{ orderId: order.id, customerEmail: order.customerEmail },
		);

		return refund;
	}

	async findAll(user: { id: string; role: Role }) {
		if (this.isAdminRole(user.role)) {
			return this.refundsRepository.find({ order: { createdAt: 'DESC' } });
		}

		return this.refundsRepository.find({
			where: { order: { organization: { ownerUserId: user.id } } },
			order: { createdAt: 'DESC' },
		});
	}

	async approve(
		id: string,
		dto: ReviewRefundRequestDto,
		actor: { id: string; email?: string; role: Role },
		request?: Request,
	) {
		const refund = await this.findOneForReview(id, actor);
		if (refund.status !== 'requested') {
			throw new BadRequestException('Only requested refunds can be approved');
		}
		this.ensureOrderCanBeRefunded(refund.order);

		const before = this.pickRefundAuditFields(refund);
		refund.status = 'processing';
		refund.reviewedById = actor.id;
		refund.reviewedBy = await this.usersRepository.findOne({ where: { id: actor.id } });
		refund.reviewNote = dto.note?.trim() || null;
		refund.reviewedAt = new Date();
		await this.refundsRepository.save(refund);

		const stripeRefund = await this.createStripeRefund(refund.order);
		refund.stripeRefundId = stripeRefund?.id ?? null;
		refund.providerPayload = stripeRefund as Record<string, unknown> | null;
		refund.status = stripeRefund ? 'succeeded' : 'succeeded';
		refund.completedAt = new Date();
		const saved = await this.refundsRepository.save(refund);

		await this.markOrderRefunded(refund.order);
		await this.auditService.log(
			'refund.approved',
			actor,
			'refund_request',
			saved.id,
			this.buildChanges(before, this.pickRefundAuditFields(saved)),
			{ orderId: refund.order.id, stripeRefundId: saved.stripeRefundId },
			request,
		);
		return saved;
	}

	async decline(
		id: string,
		dto: ReviewRefundRequestDto,
		actor: { id: string; email?: string; role: Role },
		request?: Request,
	) {
		const refund = await this.findOneForReview(id, actor);
		if (refund.status !== 'requested') {
			throw new BadRequestException('Only requested refunds can be declined');
		}

		const before = this.pickRefundAuditFields(refund);
		refund.status = 'declined';
		refund.reviewedById = actor.id;
		refund.reviewedBy = await this.usersRepository.findOne({ where: { id: actor.id } });
		refund.reviewNote = dto.note?.trim() || null;
		refund.reviewedAt = new Date();
		const saved = await this.refundsRepository.save(refund);

		await this.auditService.log(
			'refund.declined',
			actor,
			'refund_request',
			saved.id,
			this.buildChanges(before, this.pickRefundAuditFields(saved)),
			{ orderId: refund.order.id },
			request,
		);
		return saved;
	}

	private async findOneForReview(id: string, user: { id: string; role: Role }) {
		const refund = await this.refundsRepository.findOne({ where: { id } });
		if (!refund) throw new NotFoundException('Refund request not found');
		if (!this.isAdminRole(user.role) && refund.order.organization.ownerUserId !== user.id) {
			throw new ForbiddenException('You cannot review this refund');
		}
		return refund;
	}

	private ensureOrderCanBeRefunded(order: TicketOrderEntity) {
		if (order.status !== 'paid') {
			throw new BadRequestException('Only paid orders can be refunded');
		}
		if ((order.tickets || []).some((ticket) => ticket.status === 'checked_in')) {
			throw new BadRequestException('Checked-in tickets cannot be refunded');
		}
		const cutoffHours = Number(order.event?.refundCutoffHours ?? 24);
		const eventStart = order.event?.startsAt ? new Date(order.event.startsAt) : null;
		if (eventStart) {
			const cutoff = new Date(eventStart.getTime() - cutoffHours * 60 * 60 * 1000);
			if (Date.now() > cutoff.getTime()) {
				throw new BadRequestException('Refund cutoff has passed for this event');
			}
		}
	}

	private async createStripeRefund(order: TicketOrderEntity) {
		const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
		if (!secretKey || !order.stripePaymentIntentId || order.stripePaymentIntentId.startsWith('txn_')) {
			return {
				id: `local_refund_${order.id}`,
				status: 'succeeded',
				amount: Math.round(Number(order.total || 0) * 100),
				currency: order.currency.toLowerCase(),
				payment_intent: order.stripePaymentIntentId ?? `local_${order.id}`,
				reverse_transfer: true,
				refund_application_fee: true,
			};
		}

		const params = new URLSearchParams();
		params.set('payment_intent', order.stripePaymentIntentId);
		params.set('reverse_transfer', 'true');
		params.set('refund_application_fee', 'true');
		params.set('metadata[ticketOrderId]', order.id);
		params.set('metadata[reverseTransfer]', 'true');
		params.set('metadata[refundApplicationFee]', 'true');

		const response = await fetch('https://api.stripe.com/v1/refunds', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${secretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: params,
		});
		const payload = (await response.json()) as StripeRefund;
		if (!response.ok) {
			throw new BadRequestException(payload.error?.message ?? 'Stripe refund failed');
		}
		return payload;
	}

	private async markOrderRefunded(order: TicketOrderEntity) {
		order.status = 'refunded';
		for (const ticket of order.tickets || []) {
			ticket.status = 'refunded';
			await this.issuedTicketsRepository.save(ticket);
		}
		for (const item of order.items || []) {
			if (item.ticketType) {
				item.ticketType.quantitySold = Math.max(0, Number(item.ticketType.quantitySold || 0) - item.quantity);
				if (item.ticketType.status === 'sold_out') {
					item.ticketType.status = 'active';
				}
				await this.ticketTypesRepository.save(item.ticketType);
			}
		}
		await this.markInvoiceAndTransactionRefunded(order);
		return this.ticketOrdersRepository.save(order);
	}

	private async markInvoiceAndTransactionRefunded(order: TicketOrderEntity) {
		const idempotencyKey = `ticket-order:${order.id}`;
		const transaction = await this.paymentIntentsRepository.findOne({
			where: { idempotencyKey },
			relations: { invoice: true },
		});
		if (transaction) {
			transaction.status = 'refunded';
			transaction.providerStatus = 'refunded';
			transaction.providerPayload = {
				...(transaction.providerPayload ?? {}),
				refundedAt: new Date().toISOString(),
				reverseTransfer: true,
				refundApplicationFee: true,
			};
			await this.paymentIntentsRepository.save(transaction);
		}

		if (transaction?.invoice) {
			transaction.invoice.status = 'refunded';
			await this.invoicesRepository.save(transaction.invoice);
		}
	}

	private isAdminRole(role: Role) {
		return [Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN].includes(role);
	}

	private pickRefundAuditFields(refund: RefundRequestEntity) {
		return {
			status: refund.status,
			amount: Number(refund.amount || 0),
			currency: refund.currency,
			reason: refund.reason,
			reviewNote: refund.reviewNote,
			stripeRefundId: refund.stripeRefundId,
			completedAt: refund.completedAt,
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
}
