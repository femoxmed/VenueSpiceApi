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
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { CheckoutAddOnItemDto, CheckoutTicketItemDto, CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { FindMyTicketDto } from './dto/find-my-ticket.dto';
import { PreviewCheckoutFeesDto } from './dto/preview-checkout-fees.dto';
import { IssuedTicketEntity } from './entities/issued-ticket.entity';
import { TicketOrderItemEntity } from './entities/ticket-order-item.entity';
import { TicketOrderEntity } from './entities/ticket-order.entity';

type StripeCheckoutSession = {
	id: string;
	url?: string;
	payment_intent?: string;
	amount_total?: number;
	amount_subtotal?: number;
	currency?: string;
	payment_status?: string;
	metadata?: Record<string, string>;
	total_details?: {
		amount_discount?: number;
		amount_shipping?: number;
		amount_tax?: number;
	};
};

type StripeCoupon = {
	id?: string;
	error?: {
		message?: string;
	};
};

type StripeConnectedAccount = {
	id: string;
	charges_enabled?: boolean;
	payouts_enabled?: boolean;
	details_submitted?: boolean;
	capabilities?: {
		transfers?: string;
		card_payments?: string;
		legacy_payments?: string;
		crypto_transfers?: string;
	};
	error?: {
		message?: string;
	};
};

type PreparedCheckoutItem = {
	kind: 'ticket' | 'add_on';
	ticketType?: TicketTypeEntity;
	addOnId?: string;
	ticketName: string;
	description?: string | null;
	imageUrl?: string | null;
	quantity: number;
	unitPrice: number;
	lineTotal: number;
	feePayer: 'buyer' | 'organizer';
};

type PreparedCheckoutAddOn = {
	id: string;
	name: string;
	description?: string | null;
	imageUrl?: string | null;
	quantity: number;
	unitPrice: number;
	lineTotal: number;
	feePayer: 'buyer' | 'organizer';
};

type PreparedCheckoutDiscount = {
	coupon?: DiscountCouponEntity;
	code: string;
	type: 'percentage' | 'fixed';
	value: number;
	amount: number;
	influencerCommissionPercent: number;
	influencerCommission: number;
	stripeCouponId?: string | null;
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
		private readonly platformSettingsService: PlatformSettingsService,
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
		if (!dto.termsAccepted) {
			throw new BadRequestException('Accept the checkout terms to continue.');
		}
		const { event, referralCode, discount, items: preparedItems } = await this.prepareCheckout(dto);
		const ticketItems = preparedItems.filter((item) => item.kind === 'ticket' && item.ticketType);
		const addOns = preparedItems
			.filter((item) => item.kind === 'add_on')
			.map((item): PreparedCheckoutAddOn => ({
				id: item.addOnId ?? item.ticketName,
				name: item.ticketName,
				description: item.description,
				imageUrl: item.imageUrl,
				quantity: item.quantity,
				unitPrice: item.unitPrice,
				lineTotal: item.lineTotal,
				feePayer: item.feePayer,
			}));
		const items = ticketItems.map((item) =>
			this.ticketOrderItemsRepository.create({
				ticketType: item.ticketType!,
				ticketName: item.ticketName,
				quantity: item.quantity,
				unitPrice: item.unitPrice,
				lineTotal: item.lineTotal,
			}),
		);

		const currency = this.configService.get<string>('TICKETS_CURRENCY', 'USD').toUpperCase();
		const feeEstimate = await this.calculateCheckoutFees(preparedItems, discount);
		const order = await this.ticketOrdersRepository.save(
			this.ticketOrdersRepository.create({
				event,
				organization: event.organization,
				referralCode,
				customerName: dto.customerName,
				customerEmail: dto.customerEmail,
				customerPhone: dto.customerPhone,
				termsAcceptedAt: new Date(),
				termsVersion: '2026-08-04',
				privacyVersion: '2024-07-13',
				refundPolicyVersion: '2026-08-03',
				pricingPolicyVersion: '2026-08-04',
					status: 'pending',
					subtotal: feeEstimate.subtotal,
				tax: 0,
				platformFee: feeEstimate.platformFee,
				processingFee: feeEstimate.processingFee,
				organizerNet: feeEstimate.organizerNet,
				feePayer: feeEstimate.feePayer,
				platformFeePercent: feeEstimate.platformFeePercent,
				platformFeeFixed: feeEstimate.platformFeeFixed,
				processingFeePercent: feeEstimate.processingFeePercent,
				processingFeeFixed: feeEstimate.processingFeeFixed,
				feeSnapshot: {
					...feeEstimate,
					discount: this.toDiscountSnapshot(discount, feeEstimate.influencerCommission),
					addOns,
				},
				total: feeEstimate.total,
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

	async previewCheckoutFees(dto: PreviewCheckoutFeesDto) {
		const { event, discount, items } = await this.prepareCheckout(dto);
		const currency = this.configService.get<string>('TICKETS_CURRENCY', 'USD').toUpperCase();
		const feeEstimate = await this.calculateCheckoutFees(items, discount);

		return {
			eventId: event.id,
			currency,
			tax: 0,
			...feeEstimate,
		};
	}

	private async prepareCheckout(dto: {
		eventId: string;
		referralCode?: string;
		items?: CheckoutTicketItemDto[];
		addOns?: CheckoutAddOnItemDto[];
	}) {
		const event = await this.eventsRepository.findOne({
			where: { id: dto.eventId },
		});
		if (!event || event.status !== 'published') {
			throw new BadRequestException('Published event not found');
		}
		const requestedTickets = dto.items ?? [];
		const requestedAddOns = dto.addOns ?? [];
		if (!requestedTickets.length && !requestedAddOns.length) {
			throw new BadRequestException('Select at least one ticket or add-on.');
		}

		const ticketTypeIds = requestedTickets.map((item) => item.ticketTypeId);
		const uniqueTicketTypeIds = Array.from(new Set(ticketTypeIds));
		const ticketTypes = uniqueTicketTypeIds.length
			? await this.ticketTypesRepository.find({
					where: { id: In(uniqueTicketTypeIds) },
					relations: { event: true },
			  })
			: [];

		if (ticketTypes.length !== uniqueTicketTypeIds.length) {
			throw new BadRequestException('One or more ticket types are invalid');
		}

		const normalizedReferralCode = dto.referralCode?.trim().toUpperCase();
		let referralCode = normalizedReferralCode
			? await this.referralCodesRepository.findOne({
					where: { code: normalizedReferralCode },
			  })
			: null;

		const ticketItems: PreparedCheckoutItem[] = requestedTickets.map((item) => {
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
			return {
				kind: 'ticket',
				ticketType,
				ticketName: ticketType.name,
				description: ticketType.description,
				quantity: item.quantity,
				unitPrice,
				lineTotal: unitPrice * item.quantity,
				feePayer: ticketType.includeCharges ? 'organizer' : 'buyer',
			};
		});
		const eventAddOns = this.normalizeEventAddOns(event);
		const addOnItems: PreparedCheckoutItem[] = requestedAddOns.map((item) => {
			const addOn = eventAddOns.find((entry) => entry.id === item.addOnId);
			if (!addOn) {
				throw new BadRequestException('One or more add-ons are invalid');
			}
			if (item.quantity > addOn.quantity) {
				throw new BadRequestException(`${addOn.name} only has ${addOn.quantity} remaining`);
			}
			if (addOn.limitPerPerson && item.quantity > addOn.limitPerPerson) {
				throw new BadRequestException(`${addOn.name} is limited to ${addOn.limitPerPerson} per order`);
			}
			return {
				kind: 'add_on',
				addOnId: addOn.id,
				ticketName: addOn.name,
				description: addOn.description,
				imageUrl: addOn.imageUrl,
				quantity: item.quantity,
				unitPrice: addOn.price,
				lineTotal: addOn.price * item.quantity,
				feePayer: addOn.includeCharges ? 'organizer' : 'buyer',
			};
		});
		const items = [...ticketItems, ...addOnItems];
		const discountCoupon = normalizedReferralCode
			? await this.ensureDiscountCouponCanBeUsed(normalizedReferralCode, event)
			: null;
		if (discountCoupon && !referralCode) {
			referralCode = await this.ensureReferralCodeForDiscountCoupon(discountCoupon);
		}
		const discount = discountCoupon
			? this.prepareDiscount(discountCoupon, items)
			: null;

		return { event, referralCode, discount, items };
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
		if (!('id' in paidOrder)) {
			throw new BadRequestException('Ticket order could not be reconciled');
		}
		const payment = await this.markInvoiceAndTransactionPaid(paidOrder, session);
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
		this.applyStripeTotals(order, session);

		for (const item of order.items) {
			item.ticketType.quantitySold += item.quantity;
			if (item.ticketType.quantitySold >= item.ticketType.quantity) {
				item.ticketType.status = 'sold_out';
			}
			await this.ticketTypesRepository.save(item.ticketType);
		}
		await this.decrementPaidAddOnInventory(order);

		if (order.referralCode) {
			order.referralCode.usesCount += 1;
			await this.referralCodesRepository.save(order.referralCode);
		}
		await this.incrementDiscountCouponUsage(order);

		order.tickets = await this.issueTickets(order);
		return this.ticketOrdersRepository.save(order);
	}

	async handleStripeWebhook(payload: any) {
		if (payload?.type === 'checkout.session.completed') {
			const paidOrder = await this.markCheckoutSessionPaid(payload.data.object);
			if ('id' in paidOrder) {
				await this.markInvoiceAndTransactionPaid(paidOrder, payload.data.object);
			}
			return paidOrder;
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
		const settings = await this.platformSettingsService.getPricingSettings();
		params.set('mode', 'payment');
		params.set('success_url', `${appUrl}/events/${order.event.slug}/payment/success?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`);
		params.set('cancel_url', `${appUrl}/events/${order.event.slug}/purchase?checkout=cancelled`);
		params.set('customer_email', order.customerEmail);
		params.set('billing_address_collection', 'required');
		params.set('automatic_tax[enabled]', settings.stripeAutomaticTaxEnabled ? 'true' : 'false');
		params.set('metadata[ticketOrderId]', order.id);
			params.set('metadata[eventId]', order.event.id);
			params.set('metadata[organizationId]', order.organization.id);
			if (order.organization.stripeAccountId && Number(order.total ?? 0) > 0) {
				await this.ensureDestinationAccountCanReceiveTransfers(order.organization.stripeAccountId, secretKey);
				this.updateFeeSnapshot(order, {
					stripePayoutMode: 'platform_hold',
					stripeDestinationAccountId: order.organization.stripeAccountId,
					applicationFeeAmount: this.calculateApplicationFeeAmount(order),
				});
			}
		const discount = this.getOrderDiscount(order);
		if (discount?.amount) {
			const stripeCouponId = await this.createStripeCheckoutDiscountCoupon(discount, order.currency, secretKey, order.id);
			this.updateFeeSnapshot(order, {
				stripeCouponId,
			});
			params.set('discounts[0][coupon]', stripeCouponId);
		}

		order.items.forEach((item, index) => {
			params.set(`line_items[${index}][quantity]`, String(item.quantity));
			params.set(`line_items[${index}][price_data][currency]`, order.currency.toLowerCase());
			this.appendStripeTaxSettings(params, `line_items[${index}][price_data]`, settings);
			params.set(
				`line_items[${index}][price_data][unit_amount]`,
				String(Math.round(Number(item.unitPrice) * 100)),
			);
			params.set(`line_items[${index}][price_data][product_data][name]`, item.ticketName);
			if (settings.stripeTaxCode.trim()) {
				params.set(
					`line_items[${index}][price_data][product_data][tax_code]`,
					settings.stripeTaxCode.trim(),
				);
			}
			params.set(
				`line_items[${index}][price_data][product_data][description]`,
				order.event.title,
			);
		});
		let lineItemIndex = order.items.length;
		this.getOrderAddOns(order).forEach((addOn) => {
			params.set(`line_items[${lineItemIndex}][quantity]`, String(addOn.quantity));
			params.set(`line_items[${lineItemIndex}][price_data][currency]`, order.currency.toLowerCase());
			this.appendStripeTaxSettings(params, `line_items[${lineItemIndex}][price_data]`, settings);
			params.set(
				`line_items[${lineItemIndex}][price_data][unit_amount]`,
				String(Math.round(Number(addOn.unitPrice) * 100)),
			);
			params.set(`line_items[${lineItemIndex}][price_data][product_data][name]`, addOn.name);
			if (settings.stripeTaxCode.trim()) {
				params.set(
					`line_items[${lineItemIndex}][price_data][product_data][tax_code]`,
					settings.stripeTaxCode.trim(),
				);
			}
			params.set(
				`line_items[${lineItemIndex}][price_data][product_data][description]`,
				addOn.description || order.event.title,
			);
			lineItemIndex += 1;
		});
		const buyerPlatformFee = this.feeSnapshotNumber(order, 'buyerPlatformFee', order.feePayer === 'buyer' ? Number(order.platformFee ?? 0) : 0);
		const buyerProcessingFee = this.feeSnapshotNumber(order, 'buyerProcessingFee', order.feePayer === 'buyer' ? Number(order.processingFee ?? 0) : 0);
		if (buyerPlatformFee > 0) {
			this.appendStripeLineItem(params, lineItemIndex, order.currency, 'Venue Spice service fee', buyerPlatformFee, settings);
			lineItemIndex += 1;
		}
		if (buyerProcessingFee > 0) {
			this.appendStripeLineItem(params, lineItemIndex, order.currency, 'Payment processing fee', buyerProcessingFee, settings);
		}

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

	private async ensureDestinationAccountCanReceiveTransfers(accountId: string, secretKey: string) {
		if (accountId.startsWith('acct_mock_')) {
			throw new BadRequestException('Reconnect Stripe payouts before accepting paid orders.');
		}

		const response = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
			headers: {
				Authorization: `Bearer ${secretKey}`,
			},
		});
		const account = (await response.json()) as StripeConnectedAccount;
		if (!response.ok) {
			throw new BadRequestException(account.error?.message ?? 'Stripe payout account could not be verified.');
		}

		const canReceiveTransfers =
			account.capabilities?.transfers === 'active' ||
			account.capabilities?.legacy_payments === 'active' ||
			account.capabilities?.crypto_transfers === 'active';

		if (!canReceiveTransfers) {
			throw new BadRequestException(
				'This event organizer needs to finish or reconnect Stripe payout setup before paid orders can be accepted.',
			);
		}
	}

	private calculateApplicationFeeAmount(order: TicketOrderEntity) {
		return Math.max(
			0,
			Math.round((
				Number(order.platformFee ?? 0) +
				Number(order.processingFee ?? 0) +
				this.feeSnapshotNumber(order, 'influencerCommission', 0)
			) * 100),
		);
	}

	private async calculateCheckoutFees(items: PreparedCheckoutItem[], discount?: PreparedCheckoutDiscount | null) {
		const settings = await this.platformSettingsService.getPricingSettings();
		const grossSubtotal = this.roundMoney(items.reduce((sum, item) => sum + Number(item.lineTotal), 0));
		const discountAmount = this.roundMoney(Math.min(discount?.amount ?? 0, grossSubtotal));
		const subtotal = this.roundMoney(Math.max(0, grossSubtotal - discountAmount));
		const ticketCount = items.reduce((sum, item) => sum + item.quantity, 0);
		const buyerItems = items.filter((item) => item.feePayer === 'buyer');
		const organizerItems = items.filter((item) => item.feePayer === 'organizer');
		const grossBuyerSubtotal = this.roundMoney(buyerItems.reduce((sum, item) => sum + Number(item.lineTotal), 0));
		const grossOrganizerSubtotal = this.roundMoney(organizerItems.reduce((sum, item) => sum + Number(item.lineTotal), 0));
		const buyerDiscountAmount = grossSubtotal > 0
			? this.roundMoney(discountAmount * (grossBuyerSubtotal / grossSubtotal))
			: 0;
		const organizerDiscountAmount = this.roundMoney(discountAmount - buyerDiscountAmount);
		const buyerSubtotal = this.roundMoney(Math.max(0, grossBuyerSubtotal - buyerDiscountAmount));
		const organizerSubtotal = this.roundMoney(Math.max(0, grossOrganizerSubtotal - organizerDiscountAmount));
		const buyerTicketCount = buyerItems.reduce((sum, item) => sum + item.quantity, 0);
		const organizerTicketCount = organizerItems.reduce((sum, item) => sum + item.quantity, 0);
		const feePayer: TicketOrderEntity['feePayer'] = buyerItems.length && organizerItems.length
			? 'mixed'
			: organizerItems.length
				? 'organizer'
				: settings.defaultFeePayer;
		const paidSubtotal = subtotal > 0;
		const buyerPlatformFee = buyerSubtotal > 0
			? this.roundMoney(buyerSubtotal * settings.venueSpiceFeePercent + settings.venueSpiceFeeFixed * buyerTicketCount)
			: 0;
		const organizerPlatformFee = organizerSubtotal > 0
			? this.roundMoney(organizerSubtotal * settings.venueSpiceFeePercent + settings.venueSpiceFeeFixed * organizerTicketCount)
			: 0;
		const buyerProcessingFee = buyerSubtotal > 0
			? this.roundMoney((buyerSubtotal + buyerPlatformFee) * settings.paymentProcessingFeePercent + settings.paymentProcessingFeeFixed)
			: 0;
		const organizerProcessingFee = organizerSubtotal > 0
			? this.roundMoney(organizerSubtotal * settings.paymentProcessingFeePercent + settings.paymentProcessingFeeFixed)
			: 0;
		const platformFee = paidSubtotal ? this.roundMoney(buyerPlatformFee + organizerPlatformFee) : 0;
		const processingFee = paidSubtotal ? this.roundMoney(buyerProcessingFee + organizerProcessingFee) : 0;
		const total = this.roundMoney(subtotal + buyerPlatformFee + buyerProcessingFee);
		const influencerCommission = discount
			? this.roundMoney(subtotal * (discount.influencerCommissionPercent / 100))
			: 0;
		const organizerNet = this.roundMoney(subtotal - organizerPlatformFee - organizerProcessingFee - influencerCommission);
		if ((feePayer === 'organizer' || feePayer === 'mixed') && organizerNet < 0) {
			throw new BadRequestException(
				'Ticket price is too low for the organizer to absorb fees, discounts, and influencer commission. Increase the ticket price or pass fees to buyers.',
			);
		}

		return {
			feePayer,
			ticketCount,
			grossSubtotal,
			taxLiability: 'buyer',
			taxIncludedInOrganizerNet: false,
			discountCode: discount?.code ?? null,
			discountType: discount?.type ?? null,
			discountValue: discount?.value ?? 0,
			discountAmount,
			influencerCommissionPercent: discount?.influencerCommissionPercent ?? 0,
			influencerCommission,
			subtotal,
			platformFee,
			processingFee,
			organizerNet,
			total,
			grossBuyerSubtotal,
			grossOrganizerSubtotal,
			buyerDiscountAmount,
			organizerDiscountAmount,
			buyerSubtotal,
			organizerSubtotal,
			buyerPlatformFee,
			organizerPlatformFee,
			buyerProcessingFee,
			organizerProcessingFee,
			platformFeePercent: settings.venueSpiceFeePercent,
			platformFeeFixed: settings.venueSpiceFeeFixed,
			processingFeePercent: settings.paymentProcessingFeePercent,
			processingFeeFixed: settings.paymentProcessingFeeFixed,
		};
	}

	private feeSnapshotNumber(order: TicketOrderEntity, key: string, fallback: number) {
		const value = order.feeSnapshot?.[key];
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : fallback;
	}

	private getOrderAddOns(order: TicketOrderEntity): PreparedCheckoutAddOn[] {
		const addOns = order.feeSnapshot?.addOns;
		if (!Array.isArray(addOns)) return [];
		return addOns
			.map((item): PreparedCheckoutAddOn => {
				const record = item as Record<string, unknown>;
				const quantity = Number(record.quantity || 0);
				const unitPrice = Number(record.unitPrice || 0);
				const feePayer: PreparedCheckoutAddOn['feePayer'] = record.feePayer === 'organizer' ? 'organizer' : 'buyer';
				return {
					id: String(record.id || record.name || 'add-on'),
					name: String(record.name || 'Add-on'),
					description: typeof record.description === 'string' ? record.description : null,
					imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : null,
					quantity,
					unitPrice,
					lineTotal: Number(record.lineTotal ?? unitPrice * quantity),
					feePayer,
				};
			})
			.filter((item) => item.quantity > 0);
	}

	private getOrderDiscount(order: TicketOrderEntity): PreparedCheckoutDiscount | null {
		const rawDiscount = order.feeSnapshot?.discount;
		if (!rawDiscount || typeof rawDiscount !== 'object') return null;
		const discount = rawDiscount as Record<string, unknown>;
		const amount = this.roundMoney(Number(discount.amount ?? 0));
		if (amount <= 0) return null;
		const type = discount.type === 'fixed' ? 'fixed' : 'percentage';
		return {
			coupon: discount.coupon as DiscountCouponEntity,
			code: String(discount.code || order.referralCode?.code || 'DISCOUNT').toUpperCase(),
			type,
			value: Number(discount.value ?? 0),
			amount,
			influencerCommissionPercent: Number(discount.influencerCommissionPercent ?? 0),
			influencerCommission: Number(discount.influencerCommission ?? 0),
			stripeCouponId: typeof discount.stripeCouponId === 'string' ? discount.stripeCouponId : null,
		};
	}

	private toDiscountSnapshot(discount: PreparedCheckoutDiscount | null, influencerCommission: number) {
		if (!discount) return null;
		return {
			couponId: discount.coupon?.id ?? null,
			code: discount.code,
			type: discount.type,
			value: discount.value,
			amount: discount.amount,
			influencerCommissionPercent: discount.influencerCommissionPercent,
			influencerCommission,
		};
	}

	private prepareDiscount(coupon: DiscountCouponEntity, items: PreparedCheckoutItem[]): PreparedCheckoutDiscount {
		const subtotal = this.roundMoney(items.reduce((sum, item) => sum + Number(item.lineTotal), 0));
		const couponValue = Math.max(0, Number(coupon.value || 0));
		const amount = coupon.type === 'percentage'
			? this.roundMoney(subtotal * (Math.min(couponValue, 100) / 100))
			: this.roundMoney(Math.min(couponValue, subtotal));
		return {
			coupon,
			code: coupon.code.trim().toUpperCase(),
			type: coupon.type,
			value: couponValue,
			amount,
			influencerCommissionPercent: Math.max(0, Number(coupon.influencerCommissionPercent || 0)),
			influencerCommission: 0,
		};
	}

	private normalizeEventAddOns(event: EventEntity) {
		return (event.addOns || [])
			.map((raw, index) => {
				const record = raw as Record<string, unknown>;
				const name = String(record.type || record.customType || 'Add-on').trim();
				const quantity = Math.max(0, Number(record.quantity ?? 0));
				const limit = Number(record.limitPerPerson ?? record.limit ?? 0);
				return {
					id: String(record.id || `add-on-${index}`),
					name: name || 'Add-on',
					description: typeof record.description === 'string' ? record.description : null,
					imageUrl: typeof record.imageUrl === 'string' ? record.imageUrl : null,
					quantity,
					limitPerPerson: Number.isFinite(limit) && limit > 0 ? limit : null,
					price: Math.max(0, Number(record.price || 0)),
					includeCharges: Boolean(record.includeCharges),
				};
			})
			.filter((item) => item.name || item.description || item.imageUrl);
	}

	private async decrementPaidAddOnInventory(order: TicketOrderEntity) {
		const paidAddOns = this.getOrderAddOns(order);
		if (!paidAddOns.length) return;
		const event = await this.eventsRepository.findOne({ where: { id: order.event.id } });
		if (!event?.addOns?.length) return;
		event.addOns = event.addOns.map((raw, index) => {
			const record = { ...(raw as Record<string, unknown>) };
			const id = String(record.id || `add-on-${index}`);
			const paid = paidAddOns.find((item) => item.id === id);
			if (!paid) return raw;
			const currentQuantity = Math.max(0, Number(record.quantity ?? 0));
			return {
				...record,
				quantity: Math.max(0, currentQuantity - paid.quantity),
			};
		});
		await this.eventsRepository.save(event);
	}

	private async incrementDiscountCouponUsage(order: TicketOrderEntity) {
		const discount = this.getOrderDiscount(order);
		if (!discount?.code) return;
		const coupon = await this.discountCouponsRepository.findOne({
			where: { code: discount.code },
		});
		if (!coupon) return;
		coupon.usesCount += 1;
		await this.discountCouponsRepository.save(coupon);
	}

	private roundMoney(value: number) {
		return Math.round((Number(value) || 0) * 100) / 100;
	}

	private appendStripeLineItem(
		params: URLSearchParams,
		index: number,
		currency: string,
		name: string,
		amount: number,
		settings: Awaited<ReturnType<PlatformSettingsService['getPricingSettings']>>,
	) {
		params.set(`line_items[${index}][quantity]`, '1');
		params.set(`line_items[${index}][price_data][currency]`, currency.toLowerCase());
		this.appendStripeTaxSettings(params, `line_items[${index}][price_data]`, settings);
		params.set(
			`line_items[${index}][price_data][unit_amount]`,
			String(Math.round(amount * 100)),
		);
		params.set(`line_items[${index}][price_data][product_data][name]`, name);
		if (settings.stripeTaxCode.trim()) {
			params.set(
				`line_items[${index}][price_data][product_data][tax_code]`,
				settings.stripeTaxCode.trim(),
			);
		}
	}

	private appendStripeTaxSettings(
		params: URLSearchParams,
		priceDataPath: string,
		settings: Awaited<ReturnType<PlatformSettingsService['getPricingSettings']>>,
	) {
		if (settings.stripeTaxBehavior !== 'unspecified') {
			params.set(`${priceDataPath}[tax_behavior]`, settings.stripeTaxBehavior);
		}
	}

	private applyStripeTotals(order: TicketOrderEntity, session: StripeCheckoutSession) {
		if (typeof session.total_details?.amount_tax === 'number') {
			order.tax = this.roundMoney(session.total_details.amount_tax / 100);
		}
		if (typeof session.amount_total === 'number') {
			order.total = this.roundMoney(session.amount_total / 100);
		}
		this.updateFeeSnapshot(order, {
			stripeAmountSubtotal: typeof session.amount_subtotal === 'number'
				? this.roundMoney(session.amount_subtotal / 100)
				: this.feeSnapshotNumber(order, 'stripeAmountSubtotal', Number(order.subtotal ?? 0)),
			stripeAmountDiscount: typeof session.total_details?.amount_discount === 'number'
				? this.roundMoney(session.total_details.amount_discount / 100)
				: this.feeSnapshotNumber(order, 'stripeAmountDiscount', this.feeSnapshotNumber(order, 'discountAmount', 0)),
			stripeTaxAmount: Number(order.tax ?? 0),
			stripeAmountTotal: Number(order.total ?? 0),
			taxLiability: 'buyer',
			taxIncludedInOrganizerNet: false,
		});
	}

	private updateFeeSnapshot(order: TicketOrderEntity, updates: Record<string, unknown>) {
		order.feeSnapshot = {
			...(order.feeSnapshot ?? {}),
			...updates,
		};
	}

	private async ensureDiscountCouponCanBeUsed(code: string, event: EventEntity) {
		const coupon = await this.discountCouponsRepository.findOne({
			where: { code: code.trim().toUpperCase() },
		});
		if (!coupon) return null;
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
		return coupon;
	}

	private async ensureReferralCodeForDiscountCoupon(coupon: DiscountCouponEntity) {
		const code = coupon.code.trim().toUpperCase();
		const existing = await this.referralCodesRepository.findOne({ where: { code } });
		if (existing) return existing;
		if (!coupon.agent) return null;
		return this.referralCodesRepository.save(
			this.referralCodesRepository.create({
				agent: coupon.agent,
				event: coupon.event ?? null,
				code,
				status: 'active',
			}),
		);
	}

	private async createStripeCheckoutDiscountCoupon(
		discount: PreparedCheckoutDiscount,
		currency: string,
		secretKey: string,
		orderId: string,
	) {
		if (discount.stripeCouponId) return discount.stripeCouponId;

		const params = new URLSearchParams();
		params.set('duration', 'once');
		params.set('name', `Venue Spice ${discount.code}`);
		params.set('amount_off', String(Math.round(discount.amount * 100)));
		params.set('currency', currency.toLowerCase());

		const response = await fetch('https://api.stripe.com/v1/coupons', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${secretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				'Idempotency-Key': `ticket-order-discount:${orderId}:${discount.code}:${Math.round(discount.amount * 100)}`,
			},
			body: params,
		});
		const payload = (await response.json()) as StripeCoupon;
		if (!response.ok || !payload.id) {
			throw new BadRequestException(payload.error?.message ?? 'Stripe discount could not be prepared');
		}
		return payload.id;
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
		const stripeTax = typeof session.total_details?.amount_tax === 'number'
			? this.roundMoney(session.total_details.amount_tax / 100)
			: Number(payment.invoice.tax ?? 0);
		const stripeTotal = typeof session.amount_total === 'number'
			? this.roundMoney(session.amount_total / 100)
			: Number(payment.invoice.total ?? order.total ?? 0);
		payment.invoice.tax = stripeTax;
		payment.invoice.total = stripeTotal;
		if (payment.invoice.status !== 'paid') {
			payment.invoice.status = 'paid';
		}
		await this.invoicesRepository.save(payment.invoice);
		payment.transaction.status = 'succeeded';
		payment.transaction.provider = 'stripe';
		payment.transaction.providerStatus = session.payment_status ?? 'paid';
		payment.transaction.providerReference = session.payment_intent ?? session.id;
		payment.transaction.amount = stripeTotal;
		payment.transaction.subtotal = Number(order.subtotal ?? 0);
		payment.transaction.tax = stripeTax;
		payment.transaction.platformFee = Number(order.platformFee ?? 0);
		payment.transaction.processingFee = Number(order.processingFee ?? 0);
		payment.transaction.total = stripeTotal;
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

		const addOnInvoiceItems = this.getOrderAddOns(order).map((item) =>
			this.invoiceItemsRepository.create({
				description: `${item.name} - ${order.event.title}`,
				qty: item.quantity,
				unitPrice: Number(item.unitPrice),
				lineTotal: Number(item.lineTotal),
			}),
		);
		const discount = this.getOrderDiscount(order);
		const discountInvoiceItems = discount?.amount
			? [
					this.invoiceItemsRepository.create({
						description: `Discount (${discount.code}) - ${order.event.title}`,
						qty: 1,
						unitPrice: -Number(discount.amount),
						lineTotal: -Number(discount.amount),
					}),
			  ]
			: [];
		const invoice = await this.invoicesRepository.save(
			this.invoicesRepository.create({
				invoiceNumber: this.buildInvoiceNumber(),
				user: user ?? null,
				status: 'pending',
				subtotal: Number(order.subtotal ?? 0),
				tax: Number(order.tax ?? 0),
				total: Number(order.total ?? 0),
				issuedAt: new Date(),
				items: [
					...order.items.map((item) =>
						this.invoiceItemsRepository.create({
							description: `${item.ticketName} - ${order.event.title}`,
							qty: item.quantity,
							unitPrice: Number(item.unitPrice),
							lineTotal: Number(item.lineTotal),
						}),
					),
					...addOnInvoiceItems,
					...discountInvoiceItems,
				],
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
				subtotal: Number(order.subtotal ?? 0),
				tax: Number(order.tax ?? 0),
				platformFee: Number(order.platformFee ?? 0),
				processingFee: Number(order.processingFee ?? 0),
				total: Number(order.total ?? 0),
				currency: order.currency,
				customerEmail: order.customerEmail,
				invoice,
				providerPayload: {
					demo: true,
					ticketOrderId: order.id,
					eventId: order.event.id,
					addOns: this.getOrderAddOns(order),
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
								<td style="padding:14px 0;border-top:1px solid #E5EAF7;">
									<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
										<tr>
											<td style="vertical-align:top;">
												<div style="color:#171B24;font:800 15px Arial,sans-serif;">${this.escapeEmailHtml(ticket.ticketType?.name || 'Ticket')}</div>
												<div style="margin-top:5px;color:#68708A;font:400 12px Arial,sans-serif;">Holder: ${this.escapeEmailHtml(ticket.holderName || order.customerName)}</div>
												<div style="margin-top:10px;display:inline-block;padding:8px 11px;border-radius:10px;background:#FFFFFF;border:1px solid #DDE6FF;color:#2960EC;font:900 14px Arial Black,Arial,sans-serif;letter-spacing:1px;">${this.escapeEmailHtml(ticket.code)}</div>
											</td>
											<td align="right" style="width:92px;vertical-align:top;">
												<img src="${this.buildTicketQrUrl(ticket.code)}" width="82" height="82" alt="Ticket QR code" style="display:block;border:1px solid #E5EAF7;border-radius:12px;padding:4px;background:#FFFFFF;">
											</td>
										</tr>
									</table>
								</td>
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

	private buildTicketQrUrl(code: string) {
		return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(code)}`;
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
