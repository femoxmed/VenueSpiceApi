import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { CreateServiceBookingDto } from './dto/create-service-booking.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { ServiceTypeEntity } from '../service-types/entities/service-type.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { InvoiceItemEntity } from '../invoices/entities/invoice-item.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';

@Injectable()
export class ServiceBookingsService {
	constructor(
		@InjectRepository(ServiceBookingEntity)
		private readonly serviceBookingsRepository: Repository<ServiceBookingEntity>,
		@InjectRepository(UserEntity)
		private readonly customersRepository: Repository<UserEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(ServiceTypeEntity)
		private readonly serviceTypesRepository: Repository<ServiceTypeEntity>,
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		@InjectRepository(InvoiceItemEntity)
		private readonly invoiceItemsRepository: Repository<InvoiceItemEntity>,
		@InjectRepository(OrderItemEntity)
		private readonly orderItemsRepository: Repository<OrderItemEntity>,
		private readonly notificationsService: NotificationsService,
	) {}

	findAll() {
		return this.serviceBookingsRepository.find({
			relations: {
				user: true,
				technician: true,
				serviceType: true,
				invoice: true,
				paidItem: { product: true, order: true },
			},
			order: { createdAt: 'DESC' },
		});
	}

	findByUser(userId: string) {
		return this.serviceBookingsRepository.find({
			where: { user: { id: userId } },
			relations: {
				user: true,
				technician: true,
				serviceType: true,
				invoice: true,
				paidItem: { product: true, order: true },
			},
			order: { createdAt: 'DESC' },
		});
	}

	async create(dto: CreateServiceBookingDto) {
		const customerId = dto.customerId?.trim();
		const serviceTypeId = dto.serviceTypeId?.trim();
		const technicianId =
			dto.technicianId && dto.technicianId.trim() !== ''
				? dto.technicianId.trim()
				: undefined;

		if (!customerId) {
			throw new NotFoundException('Customer not found');
		}

		if (!serviceTypeId) {
			throw new NotFoundException('Service type not found');
		}

		const customer = await this.customersRepository.findOne({
			where: { id: customerId },
		});

		if (!customer) {
			throw new NotFoundException('Customer not found');
		}

		const serviceType = await this.serviceTypesRepository.findOne({
			where: { id: serviceTypeId },
		});

		if (!serviceType) {
			throw new NotFoundException('Service type not found');
		}

		let technician: UserEntity | null = null;
		let paidItem: OrderItemEntity | null = null;

		if (technicianId) {
			technician = await this.usersRepository.findOne({
				where: { id: technicianId },
			});

			if (!technician) {
				throw new NotFoundException('Technician not found');
			}
		}

		if (dto.paidItemId) {
			paidItem = await this.orderItemsRepository.findOne({
				where: { id: dto.paidItemId },
				relations: { order: { user: true }, product: true },
			});

			if (!paidItem || paidItem.order.user.id !== customer.id || paidItem.order.status !== 'paid') {
				throw new NotFoundException('Paid customer item not found');
			}
		}

		const price = Number(dto.overridePrice ?? serviceType.basePrice ?? 0);
		let invoice: InvoiceEntity | null = null;

		if (serviceType.billingMode === 'fixed' && price > 0) {
			invoice = this.invoicesRepository.create({
				invoiceNumber: this.buildInvoiceNumber(),
				user: customer,
				order: null,
				status: 'pending',
				subtotal: price,
				tax: 0,
				total: price,
				issuedAt: new Date(),
				items: [
					this.invoiceItemsRepository.create({
						description: serviceType.name,
						qty: 1,
						unitPrice: price,
						lineTotal: price,
					}),
				],
			});
		}

		const booking = this.serviceBookingsRepository.create({
			user: customer,
			technician,
			preferredDate: dto.preferredDate,
			issue: dto.issue,
			status: dto.status ?? 'assigned',
			serviceType,
			paidItem,
			billingMode: serviceType.billingMode,
			price,
		});

		// Save booking FIRST before linking to invoice
		await this.serviceBookingsRepository.save(booking);

		// Link invoice back to booking if exists
		if (invoice) {
			invoice.serviceBooking = booking;
			await this.invoicesRepository.save(invoice);
			booking.invoice = invoice;
			await this.serviceBookingsRepository.save(booking);
		}

		await this.notificationsService.queueEmail(
			customer.email,
			'Aquzera service booking created',
			this.notificationsService.buildServiceBookingCreatedEmail(
				customer.fullName,
				booking.preferredDate,
				booking.issue,
			),
		);

		if (technician?.email) {
			await this.notificationsService.queueEmail(
				technician.email,
				'New Aquzera technician assignment',
				this.notificationsService.buildTechnicianAssignmentEmail(
					technician.fullName,
					booking.preferredDate,
					booking.issue,
					customer.fullName,
				),
			);
		}

		if (invoice) {
			await this.notificationsService.queueEmail(
				customer.email,
				'Aquzera service invoice created',
				this.notificationsService.buildServiceInvoiceCreatedEmail(
					customer.fullName,
					invoice.invoiceNumber,
					price,
					serviceType.name,
				),
			);
		}

		return this.serviceBookingsRepository.findOne({
			where: { id: booking.id },
			relations: {
				user: true,
				technician: true,
				serviceType: true,
				invoice: true,
				paidItem: { product: true, order: true },
			},
		});
	}

	private buildInvoiceNumber() {
		return 'AQZ-SVC-' + Date.now();
	}
}
