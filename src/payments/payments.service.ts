import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentIntentEntity } from './entities/payment-intent.entity';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

type PaystackInitializeResponse = {
	status: boolean;
	message: string;
	data: {
		authorization_url: string;
		access_code: string;
		reference: string;
	};
};

type PaystackVerifyResponse = {
	status: boolean;
	message: string;
	data: {
		id?: number;
		reference: string;
		amount: number;
		currency: string;
		status: string;
		paid_at?: string;
		customer?: {
			email?: string;
		};
		gateway_response?: string;
		metadata?: Record<string, unknown>;
	};
};

@Injectable()
export class PaymentsService {
	constructor(
		@InjectRepository(PaymentIntentEntity)
		private readonly paymentIntentsRepository: Repository<PaymentIntentEntity>,
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		@InjectRepository(OrderEntity)
		private readonly ordersRepository: Repository<OrderEntity>,
		@InjectRepository(ServiceBookingEntity)
		private readonly serviceBookingsRepository: Repository<ServiceBookingEntity>,
		private readonly configService: ConfigService,
		private readonly notificationsService: NotificationsService,
	) {}

	async createIntent(dto: CreatePaymentIntentDto, userId?: string) {
		if (!dto.invoiceId && !dto.orderId) {
			throw new BadRequestException('Provide invoiceId or orderId');
		}

		let invoice: InvoiceEntity | null = null;
		let order: OrderEntity | null = null;

		if (dto.invoiceId) {
			invoice = await this.invoicesRepository.findOne({
				where: { id: dto.invoiceId },
				relations: {
					user: true,
					order: true,
					serviceBooking: true,
					items: true,
				},
			});

			if (!invoice) {
				throw new NotFoundException('Invoice not found');
			}
			if (userId && invoice.user?.id !== userId) {
				throw new NotFoundException('Invoice not found');
			}

			order = invoice.order ?? null;
		} else if (dto.orderId) {
			order = await this.ordersRepository.findOne({
				where: { id: dto.orderId },
				relations: { user: true, items: { product: true } },
			});

			if (!order) {
				throw new NotFoundException('Order not found');
			}
			if (userId && order.user.id !== userId) {
				throw new NotFoundException('Order not found');
			}

			invoice = await this.invoicesRepository.findOne({
				where: { order: { id: order.id } },
				relations: { user: true, order: true, items: true },
			});
		}

		if (!invoice) {
			throw new BadRequestException('Payment intents must be linked to an invoice');
		}

		if (String(invoice.status).toLowerCase() === 'paid') {
			const existingPaidIntent = await this.paymentIntentsRepository.findOne({
				where: { invoice: { id: invoice.id }, status: 'succeeded' },
			});

			return (
				existingPaidIntent ?? {
					message: 'Invoice has already been paid',
					invoiceId: invoice.id,
					status: 'paid',
				}
			);
		}

		const idempotencyKey = dto.idempotencyKey || 'invoice:' + invoice.id;

		const existingIntent = await this.paymentIntentsRepository.findOne({
			where: { idempotencyKey },
			relations: { invoice: { serviceBooking: true, user: true }, order: true },
		});

		if (existingIntent) {
			if (existingIntent.status === 'succeeded') {
				return existingIntent;
			}

			existingIntent.providerReference = this.buildReference(
				existingIntent.invoice?.invoiceNumber ?? 'AQZ',
			);
			await this.initializePaystackIntent(existingIntent);
			return this.paymentIntentsRepository.save(existingIntent);
		}

		const customerEmail = invoice.user?.email ?? order?.user?.email ?? '';

		if (!customerEmail) {
			throw new BadRequestException(
				'A customer email is required to initialize Paystack payment',
			);
		}

		const paymentIntent = this.paymentIntentsRepository.create({
			idempotencyKey,
			provider: 'paystack',
			status: 'pending',
			providerReference: this.buildReference(invoice.invoiceNumber),
			amount: Number(invoice.total ?? 0),
			currency: this.configService.get<string>('PAYMENTS_CURRENCY', 'NGN'),
			customerEmail,
			invoice,
			order: order ?? null,
		});

		try {
			await this.initializePaystackIntent(paymentIntent);
		} catch (error) {
			paymentIntent.status = 'failed';
			paymentIntent.providerStatus = 'initialization_failed';
			paymentIntent.providerPayload = {
				error:
					error instanceof Error ? error.message : 'Unknown error occurred',
			};
			await this.paymentIntentsRepository.save(paymentIntent);
			throw error;
		}

		await this.paymentIntentsRepository.save(paymentIntent);
		return paymentIntent;
	}

	async getIntent(paymentIntentId: string) {
		const intent = await this.paymentIntentsRepository.findOne({
			where: { id: paymentIntentId },
			relations: { invoice: { serviceBooking: true, user: true }, order: true },
		});

		if (!intent) {
			throw new NotFoundException('Payment intent not found');
		}

		return intent;
	}

	async verifyIntent(paymentIntentId: string, reference?: string) {
		const intent = await this.getIntent(paymentIntentId);
		const providerReference = reference || intent.providerReference;

		if (!providerReference) {
			throw new BadRequestException(
				'This payment intent has no Paystack reference yet.',
			);
		}

		try {
			const verifyResponse = await this.paystackRequest<PaystackVerifyResponse>(
				'/transaction/verify/' + encodeURIComponent(providerReference),
				{ method: 'GET' },
			);

			return this.reconcileIntent(intent, verifyResponse.data);
		} catch (error) {
			throw new BadRequestException(
				'Paystack could not find this transaction reference. Create checkout first, then complete or attempt payment before verifying.',
			);
		}
	}

	async handleWebhook(
		payload: any,
		signature?: string,
		rawBody?: Buffer | string,
	) {
		console.log({
			payload,
			signature,
			rawBody,
		});
		const secret =
			this.configService.get<string>('PAYSTACK_WEBHOOK_SECRET') ||
			this.configService.get<string>('PAYSTACK_SECRET_KEY');
		console.log('secret', secret);
		if (signature && secret) {
			const content = rawBody
				? Buffer.isBuffer(rawBody)
					? rawBody.toString('utf8')
					: rawBody
				: JSON.stringify(payload);
			const hash = createHmac('sha512', secret).update(content).digest('hex');

			if (hash !== signature) {
				throw new BadRequestException('Invalid Paystack signature');
			}
		}

		if (payload?.event === 'charge.success' && payload?.data?.reference) {
			const intent = await this.paymentIntentsRepository.findOne({
				where: { providerReference: payload.data.reference },
				relations: { invoice: { serviceBooking: true, user: true }, order: true },
			});

			if (!intent) {
				return { received: true, ignored: true };
			}

			await this.reconcileIntent(intent, {
				reference: payload.data.reference,
				amount: Number(payload.data.amount ?? 0),
				currency: String(payload.data.currency ?? intent.currency),
				status: String(payload.data.status ?? 'success'),
				paid_at: payload.data.paid_at,
				customer: { email: payload.data.customer?.email },
				gateway_response: payload.data.gateway_response,
				metadata: payload.data.metadata,
			});
		}

		return { received: true };
	}

	private async reconcileIntent(
		intent: PaymentIntentEntity,
		providerData: PaystackVerifyResponse['data'],
	) {
		intent.providerStatus = providerData.status;
		intent.providerPayload = providerData as unknown as Record<string, unknown>;

		if (providerData.status === 'success') {
			intent.status = 'succeeded';
			intent.paidAt = providerData.paid_at
				? new Date(providerData.paid_at)
				: new Date();

			if (intent.invoice && intent.invoice.status !== 'paid') {
				intent.invoice.status = 'paid';
				await this.invoicesRepository.save(intent.invoice);

				// If invoice is for a Service Booking - mark it as paid
				if (
					intent.invoice.serviceBooking &&
					intent.invoice.serviceBooking.status !== 'paid'
				) {
					await this.serviceBookingsRepository.update(
						{ id: intent.invoice.serviceBooking.id },
						{ status: 'paid' },
					);
				}
			}

			// If invoice is for an Order - mark it as paid
			if (intent.order && intent.order.status !== 'paid') {
				intent.order.status = 'paid';
				await this.ordersRepository.save(intent.order);
			}

			// Queue email notification but don't fail payment processing if email fails
			try {
				await this.notificationsService.queueEmail(
					intent.customerEmail,
					'Aquzera payment received',
					this.notificationsService.buildPaymentReceivedEmail(
						intent.invoice?.user?.fullName ?? 'Customer',
						intent.invoice?.invoiceNumber ?? 'Invoice',
						Number(intent.amount),
						intent.currency,
					),
				);
			} catch (emailError) {
				// Log error but continue - payment is confirmed even if email fails
				console.warn(
					'Failed to queue payment confirmation email:',
					emailError instanceof Error ? emailError.message : 'Unknown error',
				);
			}
		} else if (
			providerData.status === 'pending' ||
			providerData.status === 'ongoing' ||
			providerData.status === 'processing'
		) {
			intent.status = 'processing';
		} else if (
			providerData.status === 'failed' ||
			providerData.status === 'abandoned' ||
			providerData.status === 'reversed'
		) {
			intent.status = 'failed';
		}

		await this.paymentIntentsRepository.save(intent);
		return intent;
	}

	private buildReference(invoiceNumber: string) {
		return (
			'AQZPAY-' +
			invoiceNumber.replace(/[^A-Za-z0-9]/g, '') +
			'-' +
			randomUUID().slice(0, 8)
		);
	}

	private toSubunit(amount: number) {
		return Math.round(Number(amount) * 100);
	}

	private async initializePaystackIntent(intent: PaymentIntentEntity) {
		const callbackUrl = intent.order
			? this.configService.get<string>('PAYSTACK_CALLBACK_URL')
			: this.configService.get<string>('PAYSTACK_SERVICE_CALLBACK_URL') ||
				`${this.configService.get<string>('FRONTEND_URL') || this.configService.get<string>('CUSTOMER_APP_URL') || 'http://localhost:3000'}/dashboard/schedules`;
		const initializeResponse =
			await this.paystackRequest<PaystackInitializeResponse>(
				'/transaction/initialize',
				{
					method: 'POST',
					body: JSON.stringify({
						amount: this.toSubunit(intent.amount),
						email: intent.customerEmail,
						currency: intent.currency,
						reference: intent.providerReference,
						callback_url: callbackUrl,
						metadata: JSON.stringify({
							paymentIntentId: intent.id,
							invoiceId: intent.invoice?.id,
							orderId: intent.order?.id,
						}),
					}),
				},
			);

		intent.authorizationUrl = initializeResponse.data.authorization_url;
		intent.accessCode = initializeResponse.data.access_code;
		intent.status = 'initialized';
		intent.providerStatus = 'initialized';
		intent.providerPayload = initializeResponse.data;
	}

	private async paystackRequest<T>(
		path: string,
		options: RequestInit,
	): Promise<T> {
		const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');

		if (!secretKey) {
			throw new BadRequestException('PAYSTACK_SECRET_KEY is not configured');
		}

		const response = await fetch('https://api.paystack.co' + path, {
			...options,
			headers: {
				'Authorization': 'Bearer ' + secretKey,
				'Content-Type': 'application/json',
				...(options.headers ?? {}),
			},
		});

		const payload = await response.json().catch(() => null);

		if (!response.ok || payload?.status === false) {
			throw new BadRequestException(
				payload?.message ?? 'Paystack request failed',
			);
		}

		return payload as T;
	}
}
