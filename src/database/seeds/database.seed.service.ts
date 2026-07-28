import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { CrmRecordEntity } from '../../crm/entities/crm-record.entity';
import { InstallationEntity } from '../../installations/entities/installation.entity';
import { InvoiceEntity } from '../../invoices/entities/invoice.entity';
import { InvoiceItemEntity } from '../../invoices/entities/invoice-item.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';
import { ProductEntity } from '../../products/entities/product.entity';
import { ServiceBookingEntity } from '../../service-bookings/entities/service-booking.entity';
import { SupportTicketEntity } from '../../support-tickets/entities/support-ticket.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { VendorCategoryEntity } from '../../vendor-categories/entities/vendor-category.entity';
import { defaultVendorCategories } from '../../vendor-categories/vendor-categories.service';

@Injectable()
export class DatabaseSeedService {
	private readonly logger = new Logger(DatabaseSeedService.name);

	constructor(
		private readonly configService: ConfigService,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(UserEntity)
		private readonly customersRepository: Repository<UserEntity>,
		@InjectRepository(ProductEntity)
		private readonly productsRepository: Repository<ProductEntity>,
		@InjectRepository(OrderEntity)
		private readonly ordersRepository: Repository<OrderEntity>,
		@InjectRepository(OrderItemEntity)
		private readonly orderItemsRepository: Repository<OrderItemEntity>,
		@InjectRepository(InstallationEntity)
		private readonly installationsRepository: Repository<InstallationEntity>,
		@InjectRepository(ServiceBookingEntity)
		private readonly serviceBookingsRepository: Repository<ServiceBookingEntity>,
		@InjectRepository(CrmRecordEntity)
		private readonly crmRecordsRepository: Repository<CrmRecordEntity>,
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		@InjectRepository(InvoiceItemEntity)
		private readonly invoiceItemsRepository: Repository<InvoiceItemEntity>,
		@InjectRepository(SupportTicketEntity)
		private readonly supportTicketsRepository: Repository<SupportTicketEntity>,
		@InjectRepository(VendorCategoryEntity)
		private readonly vendorCategoriesRepository: Repository<VendorCategoryEntity>,
	) {}

	async run() {
		await this.seedVendorCategories();
		await this.seedUsers();
		await this.seedBusinessData();
	}

	private async seedVendorCategories() {
		for (const [index, seed] of defaultVendorCategories.entries()) {
			const slug = seed.slug || this.slugify(seed.label);
			const existing = await this.vendorCategoriesRepository.findOne({
				where: { slug },
			});

			await this.vendorCategoriesRepository.save(
				this.vendorCategoriesRepository.create({
					...(existing ?? {}),
					label: seed.label.trim(),
					slug,
					searchTerms: seed.searchTerms ?? [seed.label.trim()],
					iconKey: seed.iconKey?.trim() || null,
					sortOrder: seed.sortOrder ?? index + 1,
					isActive: seed.isActive ?? true,
				}),
			);
		}

		this.logger.log('Seeded vendor categories');
	}

	private async seedUsers() {
		const seeds = [
			{
				fullName: 'Super Admin',
				email: this.configService.get<string>(
					'SEED_SUPER_ADMIN_EMAIL',
					'superadmin@example.com',
				),
				password: this.configService.get<string>(
					'SEED_SUPER_ADMIN_PASSWORD',
					'password123',
				),
				role: Role.SUPER_ADMIN,
			},
			{
				fullName: 'Admin User',
				email: this.configService.get<string>(
					'SEED_ADMIN_EMAIL',
					'admin@example.com',
				),
				password: this.configService.get<string>(
					'SEED_ADMIN_PASSWORD',
					'password123',
				),
				role: Role.ADMIN,
			},
			{
				fullName: 'Field Technician',
				email: this.configService.get<string>(
					'SEED_TECHNICIAN_EMAIL',
					'technician@example.com',
				),
				password: this.configService.get<string>(
					'SEED_TECHNICIAN_PASSWORD',
					'password123',
				),
				role: Role.TECHNICIAN,
			},
			{
				fullName: 'Default User',
				email: this.configService.get<string>(
					'SEED_USER_EMAIL',
					'user@example.com',
				),
				password: this.configService.get<string>(
					'SEED_USER_PASSWORD',
					'password123',
				),
				role: Role.USER,
			},
		];

		for (const seed of seeds) {
			const existing = await this.usersRepository.findOne({
				where: { email: seed.email },
			});
			if (existing) continue;

			const passwordHash = await bcrypt.hash(seed.password, 10);
			await this.usersRepository.save(
				this.usersRepository.create({
					fullName: seed.fullName,
					email: seed.email,
					passwordHash,
					role: seed.role,
					isActive: true,
				}),
			);
		}

		this.logger.log('Seeded users and access roles');
	}

	private async seedBusinessData() {
		const customerCount = await this.customersRepository.count();
		if (customerCount > 0) return;

		const passwordHash = await bcrypt.hash('customer123', 10);

		const customer = await this.customersRepository.save(
			this.customersRepository.create({
				fullName: 'Ada Wellness Ltd',
				email: 'ops@adawellness.com',
				phone: '+234800000001',
				passwordHash,
				role: Role.CUSTOMER,
				isActive: true,
				subscriptionPlan: 'Premium Care',
				installedProducts: 2,
			}),
		);

		const machine = await this.productsRepository.save(
			this.productsRepository.create({
				name: 'UltraPure Machine',
				sku: 'UPM-001',
				price: 2500,
				stock: 12,
			}),
		);

		const filter = await this.productsRepository.save(
			this.productsRepository.create({
				name: 'Carbon Filter',
				sku: 'FLT-002',
				price: 120,
				stock: 150,
			}),
		);

		const order = await this.ordersRepository.save(
			this.ordersRepository.create({
				user: customer,
				status: 'processing',
				total: 2620,
				items: [],
			}),
		);

		const orderItems = await this.orderItemsRepository.save([
			this.orderItemsRepository.create({
				order,
				product: machine,
				qty: 1,
				unitPrice: 2500,
			}),
			this.orderItemsRepository.create({
				order,
				product: filter,
				qty: 1,
				unitPrice: 120,
			}),
		]);

		await this.invoicesRepository.save(
			this.invoicesRepository.create({
				invoiceNumber: `AQZ-INV-${Date.now()}`,
				user: customer,
				order,
				status: 'pending',
				subtotal: 2620,
				tax: 0,
				total: 2620,
				issuedAt: new Date(),
				items: orderItems.map((item) =>
					this.invoiceItemsRepository.create({
						description: item.product.name,
						qty: item.qty,
						unitPrice: item.unitPrice,
						lineTotal: Number(item.unitPrice) * item.qty,
					}),
				),
			}),
		);

		await this.installationsRepository.save(
			this.installationsRepository.create({
				customer,
				product: machine,
				installationDate: '2026-03-01',
				nextServiceDate: '2026-06-01',
				nextFilterChangeDate: '2026-05-01',
			}),
		);

		await this.serviceBookingsRepository.save(
			this.serviceBookingsRepository.create({
				user: customer,
				preferredDate: '2026-04-20',
				status: 'pending',
				issue: 'Routine maintenance and inspection',
			}),
		);

		await this.crmRecordsRepository.save(
			this.crmRecordsRepository.create({
				customer,
				type: 'complaint',
				channel: 'email',
				summary: 'Low pressure reported by customer',
				status: 'follow_up_required',
			}),
		);

		await this.supportTicketsRepository.save(
			this.supportTicketsRepository.create({
				customer,
				subject: 'Machine pressure issue',
				description:
					'Customer reported low pressure and wants a technician inspection.',
				status: 'open',
				assignedTo: 'Admin User',
			}),
		);

		this.logger.log('Seeded baseline business records');
	}

	private slugify(value: string) {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)+/g, '');
	}
}
