import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { ReferralCodeEntity } from '../agents/entities/referral-code.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { DiscountCouponEntity } from '../discounts/entities/discount-coupon.entity';
import { EventEntity } from '../events/entities/event.entity';
import { TicketTypeEntity } from '../events/entities/ticket-type.entity';
import { InvoiceItemEntity } from '../invoices/entities/invoice-item.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { PaymentIntentEntity } from '../payments/entities/payment-intent.entity';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { FindMyTicketDto } from './dto/find-my-ticket.dto';
import { IssuedTicketEntity } from './entities/issued-ticket.entity';
import { TicketOrderItemEntity } from './entities/ticket-order-item.entity';
import { TicketOrderEntity } from './entities/ticket-order.entity';

type StripeCheckoutSession = {
	id: string;
	url?: string;
	payment_intent?: string;
	amount_total?: number;
	currency?: string;
	payment_status?: string;
	metadata?: Record<string, string>;
};

@Injectable()
export class TicketOrdersService {
	constructor(
		@InjectRepository(TicketOrderEntity)
		private readonly ticketOrdersRepository: Repository<TicketOrderEntity>,
		@InjectRepository(TicketOrderItemEntity)
		private readonly ticketOrderItemsRepository: Repository<TicketOrderItemEntity>,
		@InjectRepository(IssuedTicketEntity)
		private readonly issuedTicketsRepository: Repository<IssuedTicketEntity>,
		@InjectRepository(EventEntity)
		private readonly eventsRepository: Repository<EventEntity>,
		@InjectRepository(TicketTypeEntity)
		private readonly ticketTypesRepository: Repository<TicketTypeEntity>,
		@InjectRepository(ReferralCodeEntity)
		private readonly referralCodesRepository: Repository<ReferralCodeEntity>,
		@InjectRepository(DiscountCouponEntity)
		private readonly discountCouponsRepository: Repository<DiscountCouponEntity>,
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		@InjectRepository(InvoiceItemEntity)
		private readonly invoiceItemsRepository: Repository<InvoiceItemEntity>,
		@InjectRepository(PaymentIntentEntity)
		private readonly paymentIntentsRepository: Repository<PaymentIntentEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		private readonly configService: ConfigService,
		private readonly notificationsService: NotificationsService,
	) {}

	findAll() {
		return this.ticketOrdersRepository.find({
			order: { createdAt: 'DESC' },
		});
	}

	async findOne(id: string) {
		const order = await this.ticketOrdersRepository.findOne({ where: { id } });
		if (!order) throw new NotFoundException('Ticket order not found');
		return order;
	}

	async findMyTicket(dto: FindMyTicketDto) {
		const email = dto.email.toLowerCase().trim();
		const orders = await this.ticketOrdersRepository
			.createQueryBuilder('order')
			.leftJoinAndSelect('order.event', 'event')
			.leftJoinAndSelect('order.items', 'items')
			.leftJoinAndSelect('items.ticketType', 'itemTicketType')
			.leftJoinAndSelect('order.tickets', 'tickets')
			.leftJoinAndSelect('tickets.ticketType', 'ticketType')
			.where('LOWER(order.customerEmail) = :email', { email })
			.andWhere('order.status = :status', { status: 'paid' })
			.andWhere('tickets.status IN (:...ticketStatuses)', {
				ticketStatuses: ['valid', 'checked_in'],
			})
			.orderBy('order.paidAt', 'DESC')
			.addOrderBy('order.createdAt', 'DESC')
			.getMany();

		if (!orders.length) {
			return {
				found: false,
				email,
				message:
					'Sorry, we did not find an active ticket connected to your email. Please check the email and try again.',
			};
		}

		const customerName = orders[0].customerName || 'there';
		await this.notificationsService.queueEmail(
			email,
			'Your Venue Spice tickets',
			this.buildFindMyTicketEmail(customerName, email, orders),
		);

		return {
			found: true,
			email,
			name: customerName,
			count: orders.reduce(
				(total, order) =>
					total +
					(order.tickets || []).filter((ticket) =>
						['valid', 'checked_in'].includes(ticket.status),
					).length,
				0,
			),
			message: 'Your active tickets have been resent to your email.',
		};
	}

	async createCheckoutSession(dto: CreateCheckoutSessionDto) {
		const event = await this.eventsRepository.findOne({
			where: { id: dto.eventId },
		});
		if (!event || event.status !== 'published') {
			throw new BadRequestException('Published event not found');
		}

		const ticketTypeIds = dto.items.map((item) => item.ticketTypeId);
		const ticketTypes = await this.ticketTypesRepository.find({
			where: { id: In(ticketTypeIds) },
			relations: { event: true },
		});

		if (ticketTypes.length !== ticketTypeIds.length) {
			throw new BadRequestException('One or more ticket types are invalid');
		}

		const referralCode = dto.referralCode
			? await this.referralCodesRepository.findOne({
					where: { code: dto.referralCode },
			  })
			: null;
		if (dto.referralCode) {
			await this.ensureDiscountCouponCanBeUsed(dto.referralCode, event);
		}

		const items = dto.items.map((item) => {
			const ticketType = ticketTypes.find((ticket) => ticket.id === item.ticketTypeId);
			if (!ticketType || ticketType.event.id !== event.id) {
				throw new BadRequestException('Ticket type does not belong to this event');
			}
			if (ticketType.status !== 'active') {
				throw new BadRequestException(`${ticketType.name} is not available`);
			}
			const remaining = ticketType.quantity - ticketType.quantitySold;
			if (item.quantity > remaining) {
				throw new BadRequestException(`${ticketType.name} only has ${remaining} remaining`);
			}
			const unitPrice = Number(ticketType.price);
			return this.ticketOrderItemsRepository.create({
				ticketType,
				ticketName: ticketType.name,
				quantity: item.quantity,
				unitPrice,
				lineTotal: unitPrice * item.quantity,
			});
		});

		const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal), 0);
		const currency = this.configService.get<string>('TICKETS_CURRENCY', 'USD').toUpperCase();
		const order = await this.ticketOrdersRepository.save(
			this.ticketOrdersRepository.create({
				event,
				organization: event.organization,
				referralCode,
				customerName: dto.customerName,
				customerEmail: dto.customerEmail,
				customerPhone: dto.customerPhone,
				status: 'pending',
				subtotal,
				tax: 0,
				total: subtotal,
				currency,
				items,
			}),
		);

		const session = await this.createStripeSession(order);
		order.stripeCheckoutSessionId = session.id;
		order.stripePaymentIntentId = session.payment_intent ?? null;
		order.checkoutUrl = session.url ?? null;
		order.providerPayload = session as unknown as Record<string, unknown>;

		const savedOrder = await this.ticketOrdersRepository.save(order);
		const demoPayment = await this.createDemoInvoiceAndTransaction(savedOrder);
		return {
			...savedOrder,
			invoice: demoPayment.invoice,
			transaction: demoPayment.transaction,
		};
	}

	async completeDemoPayment(orderId: string) {
		const order = await this.ticketOrdersRepository.findOne({
			where: { id: orderId },
		});
		if (!order) throw new NotFoundException('Ticket order not found');

		const demoPayment = await this.createDemoInvoiceAndTransaction(order);
		if (demoPayment.transaction.status !== 'succeeded') {
			demoPayment.transaction.status = 'succeeded';
			demoPayment.transaction.providerStatus = 'paid';
			demoPayment.transaction.paidAt = new Date();
			demoPayment.transaction.providerPayload = {
				...(demoPayment.transaction.providerPayload ?? {}),
				demo: true,
				cardLast4: '4242',
				completedAt: demoPayment.transaction.paidAt.toISOString(),
			};
			await this.paymentIntentsRepository.save(demoPayment.transaction);
		}
		if (demoPayment.invoice.status !== 'paid') {
			demoPayment.invoice.status = 'paid';
			await this.invoicesRepository.save(demoPayment.invoice);
		}

		const paidOrder = await this.markCheckoutSessionPaid({
			id: order.stripeCheckoutSessionId || `local_${order.id}`,
			payment_intent: demoPayment.transaction.providerReference,
			payment_status: 'paid',
			amount_total: Math.round(Number(order.total ?? 0) * 100),
			currency: order.currency,
			metadata: { ticketOrderId: order.id },
		});

		return {
			order: paidOrder,
			invoice: demoPayment.invoice,
			transaction: demoPayment.transaction,
		};
	}

	async confirmStripeCheckout(orderId: string, sessionId: string) {
		if (!sessionId) throw new BadRequestException('Stripe session id is required');
		const order = await this.ticketOrdersRepository.findOne({
			where: { id: orderId },
		});
		if (!order) throw new NotFoundException('Ticket order not found');

		const session = await this.retrieveStripeSession(sessionId);
		if (session.metadata?.ticketOrderId !== order.id) {
			throw new BadRequestException('Stripe session does not belong to this order');
		}
		if (session.payment_status !== 'paid') {
			throw new BadRequestException('Stripe payment has not completed');
		}

		const paidOrder = await this.markCheckoutSessionPaid(session);
		const payment = await this.markInvoiceAndTransactionPaid(order, session);
		return {
			order: paidOrder,
			invoice: payment.invoice,
			transaction: payment.transaction,
		};
	}

	async markCheckoutSessionPaid(session: StripeCheckoutSession) {
		const orderId = session.metadata?.ticketOrderId;
		const order = orderId
			? await this.ticketOrdersRepository.findOne({ where: { id: orderId } })
			: await this.ticketOrdersRepository.findOne({
					where: { stripeCheckoutSessionId: session.id },
			  });

		if (!order) {
			return { received: true, ignored: true };
		}
		if (order.status === 'paid') {
			return order;
		}

		order.status = 'paid';
		order.stripeCheckoutSessionId = session.id;
		order.stripePaymentIntentId = session.payment_intent ?? order.stripePaymentIntentId;
		order.paidAt = new Date();
		order.providerPayload = session as unknown as Record<string, unknown>;

		for (const item of order.items) {
			item.ticketType.quantitySold += item.quantity;
			if (item.ticketType.quantitySold >= item.ticketType.quantity) {
				item.ticketType.status = 'sold_out';
			}
			await this.ticketTypesRepository.save(item.ticketType);
		}

		if (order.referralCode) {
			order.referralCode.usesCount += 1;
			await this.referralCodesRepository.save(order.referralCode);
		}

		order.tickets = await this.issueTickets(order);
		return this.ticketOrdersRepository.save(order);
	}

	async handleStripeWebhook(payload: any) {
		if (payload?.type === 'checkout.session.completed') {
			return this.markCheckoutSessionPaid(payload.data.object);
		}
		return { received: true };
	}

	private async createStripeSession(order: TicketOrderEntity): Promise<StripeCheckoutSession> {
		const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
		const appUrl = this.configService.get<string>('WEB_APP_URL', 'http://localhost:3000');
		if (!secretKey) {
			return {
				id: `local_${order.id}`,
				url: `${appUrl}/?checkout_order=${order.id}`,
				payment_status: 'unconfigured',
				metadata: { ticketOrderId: order.id },
			};
		}

		const params = new URLSearchParams();
		params.set('mode', 'payment');
		params.set('success_url', `${appUrl}/events/${order.event.slug}/payment/success?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`);
		params.set('cancel_url', `${appUrl}/events/${order.event.slug}/purchase?checkout=cancelled`);
		params.set('customer_email', order.customerEmail);
		params.set('billing_address_collection', 'required');
		params.set('automatic_tax[enabled]', 'true');
		params.set('metadata[ticketOrderId]', order.id);
		params.set('metadata[eventId]', order.event.id);
		params.set('metadata[organizationId]', order.organization.id);
		if (order.organization.stripeAccountId && Number(order.total ?? 0) > 0) {
			params.set(
				'payment_intent_data[application_fee_amount]',
				String(this.calculateApplicationFeeAmount(order)),
			);
			params.set('payment_intent_data[transfer_data][destination]', order.organization.stripeAccountId);
		}

		order.items.forEach((item, index) => {
			params.set(`line_items[${index}][quantity]`, String(item.quantity));
			params.set(`line_items[${index}][price_data][currency]`, order.currency.toLowerCase());
			params.set(
				`line_items[${index}][price_data][unit_amount]`,
				String(Math.round(Number(item.unitPrice) * 100)),
			);
			params.set(`line_items[${index}][price_data][product_data][name]`, item.ticketName);
			params.set(
				`line_items[${index}][price_data][product_data][description]`,
				order.event.title,
			);
		});

		const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${secretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: params,
		});
		const payload = (await response.json()) as StripeCheckoutSession & { error?: { message?: string } };
		if (!response.ok) {
			throw new BadRequestException(payload.error?.message ?? 'Stripe checkout failed');
		}
		return payload;
	}

	private calculateApplicationFeeAmount(order: TicketOrderEntity) {
		const percent = Number(
			this.configService.get<string>('VENUE_SPICE_FEE_PERCENT')
				?? this.configService.get<string>('EVENTBOX_FEE_PERCENT', '0.05'),
		);
		const fixed = Number(
			this.configService.get<string>('VENUE_SPICE_FEE_FIXED')
				?? this.configService.get<string>('EVENTBOX_FEE_FIXED', '0'),
		);
		const total = Number(order.total ?? 0);
		return Math.max(0, Math.round((total * percent + fixed) * 100));
	}

	private async ensureDiscountCouponCanBeUsed(code: string, event: EventEntity) {
		const coupon = await this.discountCouponsRepository.findOne({
			where: { code: code.trim().toUpperCase() },
		});
		if (!coupon) return;
		if (coupon.organization.id !== event.organization.id) {
			throw new BadRequestException('Coupon does not belong to this organizer');
		}
		if (coupon.event && coupon.event.id !== event.id) {
			throw new BadRequestException('Coupon does not apply to this event');
		}
		if (
			coupon.status !== 'active' ||
			!coupon.approvedByInfluencerAt ||
			coupon.agent?.status !== 'active' ||
			!coupon.agent?.user ||
			!coupon.agent.user.isActive
		) {
			throw new BadRequestException('Coupon is waiting for influencer approval');
		}
		const now = new Date();
		if (coupon.startsAt && coupon.startsAt > now) {
			throw new BadRequestException('Coupon is not active yet');
		}
		if (coupon.endsAt && coupon.endsAt < now) {
			throw new BadRequestException('Coupon has expired');
		}
		if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.usesCount >= coupon.maxUses) {
			throw new BadRequestException('Coupon usage limit has been reached');
		}
	}

	private async retrieveStripeSession(sessionId: string): Promise<StripeCheckoutSession> {
		const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
		if (!secretKey) throw new BadRequestException('Stripe is not configured');
		const response = await fetch(
			`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
			{
				headers: { Authorization: `Bearer ${secretKey}` },
			},
		);
		const payload = (await response.json()) as StripeCheckoutSession & { error?: { message?: string } };
		if (!response.ok) {
			throw new BadRequestException(payload.error?.message ?? 'Unable to verify Stripe checkout');
		}
		return payload;
	}

	private async markInvoiceAndTransactionPaid(order: TicketOrderEntity, session: StripeCheckoutSession) {
		const payment = await this.createDemoInvoiceAndTransaction(order);
		if (payment.invoice.status !== 'paid') {
			payment.invoice.status = 'paid';
			await this.invoicesRepository.save(payment.invoice);
		}
		payment.transaction.status = 'succeeded';
		payment.transaction.provider = 'stripe';
		payment.transaction.providerStatus = session.payment_status ?? 'paid';
		payment.transaction.providerReference = session.payment_intent ?? session.id;
		payment.transaction.paidAt = new Date();
		payment.transaction.providerPayload = session as unknown as Record<string, unknown>;
		await this.paymentIntentsRepository.save(payment.transaction);
		return payment;
	}

	private async createDemoInvoiceAndTransaction(order: TicketOrderEntity) {
		const user = await this.usersRepository.findOne({
			where: { email: order.customerEmail.toLowerCase() },
		});
		const idempotencyKey = `ticket-order:${order.id}`;
		const existingTransaction = await this.paymentIntentsRepository.findOne({
			where: { idempotencyKey },
			relations: { invoice: { items: true } },
		});
		if (existingTransaction?.invoice) {
			return {
				invoice: existingTransaction.invoice,
				transaction: existingTransaction,
			};
		}

		const invoice = await this.invoicesRepository.save(
			this.invoicesRepository.create({
				invoiceNumber: this.buildInvoiceNumber(),
				user: user ?? null,
				status: 'pending',
				subtotal: Number(order.subtotal ?? 0),
				tax: Number(order.tax ?? 0),
				total: Number(order.total ?? 0),
				issuedAt: new Date(),
				items: order.items.map((item) =>
					this.invoiceItemsRepository.create({
						description: `${item.ticketName} - ${order.event.title}`,
						qty: item.quantity,
						unitPrice: Number(item.unitPrice),
						lineTotal: Number(item.lineTotal),
					}),
				),
			}),
		);

		const transaction = await this.paymentIntentsRepository.save(
			this.paymentIntentsRepository.create({
				idempotencyKey,
				provider: 'stripe_demo',
				status: 'pending',
				providerStatus: 'requires_payment_method',
				providerReference: `txn_${randomBytes(8).toString('hex')}`,
				amount: Number(order.total ?? 0),
				currency: order.currency,
				customerEmail: order.customerEmail,
				invoice,
				providerPayload: {
					demo: true,
					ticketOrderId: order.id,
					eventId: order.event.id,
				},
			}),
		);

		return { invoice, transaction };
	}

	private async issueTickets(order: TicketOrderEntity) {
		const tickets: IssuedTicketEntity[] = [];
		for (const item of order.items) {
			for (let i = 0; i < item.quantity; i += 1) {
				tickets.push(
					this.issuedTicketsRepository.create({
						order,
						event: order.event,
						ticketType: item.ticketType,
						code: this.buildTicketCode(),
						holderName: order.customerName,
						holderEmail: order.customerEmail,
					}),
				);
			}
		}
		return this.issuedTicketsRepository.save(tickets);
	}

	private buildTicketCode() {
		return `EVB-${randomBytes(6).toString('hex').toUpperCase()}`;
	}

	private buildInvoiceNumber() {
		return `EVB-INV-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
	}

	private buildFindMyTicketEmail(
		fullName: string,
		email: string,
		orders: TicketOrderEntity[],
	) {
		const appUrl = this.configService
			.get<string>('WEB_APP_URL', 'http://localhost:3000')
			.replace(/\/$/, '');
		const body = orders
			.map((order) => {
				const tickets = (order.tickets || []).filter((ticket) =>
					['valid', 'checked_in'].includes(ticket.status),
				);
				const ticketRows = tickets
					.map(
						(ticket) => `
							<tr>
								<td style="padding:10px 0;color:#171B24;font:700 14px Arial,sans-serif;">${this.escapeEmailHtml(ticket.ticketType?.name || 'Ticket')}</td>
								<td style="padding:10px 0;color:#2960EC;font:800 14px Arial,sans-serif;text-align:right;">${this.escapeEmailHtml(ticket.code)}</td>
							</tr>
						`,
					)
					.join('');

				return `
					<div style="margin-top:18px;padding:18px;border:1px solid #E7ECFF;border-radius:16px;background:#F8FAFF;">
						<div style="color:#171B24;font:900 18px Arial Black,Arial,sans-serif;">${this.escapeEmailHtml(order.event?.title || 'Event')}</div>
						<div style="margin-top:6px;color:#68708A;font:400 13px Arial,sans-serif;">Order ${this.escapeEmailHtml(order.id)}${order.paidAt ? ` • Paid ${this.escapeEmailHtml(order.paidAt.toLocaleDateString('en-US'))}` : ''}</div>
						<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;">
							${ticketRows}
						</table>
					</div>
				`;
			})
			.join('');

		return this.notificationsService.buildBrandedEmail({
			eyebrow: 'Find my ticket',
			title: 'Your Venue Spice tickets',
			greeting: `Hello ${fullName},`,
			intro:
				'We found active tickets connected to this email and have included them below.',
			body,
			rows: [{ label: 'Email', value: email }],
			action: {
				label: 'Browse events',
				url: `${appUrl}/discover`,
			},
			note: 'Keep this email handy. The ticket codes may be required at check-in.',
		});
	}

	private escapeEmailHtml(value: string) {
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}
}
