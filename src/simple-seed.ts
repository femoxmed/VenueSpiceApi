import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { UserEntity } from './auth/entities/user.entity';
import { ProductEntity } from './products/entities/product.entity';
import { OrderEntity } from './orders/entities/order.entity';
import { OrderItemEntity } from './orders/entities/order-item.entity';
import { InvoiceEntity } from './invoices/entities/invoice.entity';
import { InvoiceItemEntity } from './invoices/entities/invoice-item.entity';
import { InstallationEntity } from './installations/entities/installation.entity';
import { ServiceBookingEntity } from './service-bookings/entities/service-booking.entity';
import { CrmRecordEntity } from './crm/entities/crm-record.entity';
import { SupportTicketEntity } from './support-tickets/entities/support-ticket.entity';
import { SupportTicketMessageEntity } from './support-tickets/entities/support-ticket-message.entity';
import { ServiceTypeEntity } from './service-types/entities/service-type.entity';
import { Role } from './common/enums/role.enum';
import { PasswordResetRecordEntity } from './auth/entities/password-reset-record.entity';
import { PaymentIntentEntity } from './payments/entities/payment-intent.entity';
import { AuditLogEntity } from './audit/entities/audit-log.entity';
import { Upload } from './uploads/entities/upload.entity';
import { BlogEntity } from './blogs/entities/blog.entity';
import { seedBlogs } from './database/seeds/blog.seed';
import { VendorCategoryEntity } from './vendor-categories/entities/vendor-category.entity';
import { defaultVendorCategories } from './vendor-categories/vendor-categories.service';

type UserSeed = {
	fullName: string;
	email: string;
	password: string;
	role: Role;
};

const userSeeds = require('./database/seeds/user.json') as UserSeed[];

dotenv.config();

async function runSeed() {
	console.log('🔄 Starting database seed...');

	const AppDataSource = new DataSource({
		type: 'postgres',
		host: process.env.DB_HOST || 'localhost',
		port: parseInt(process.env.DB_PORT || '5432'),
		username: process.env.DB_USERNAME || 'postgres',
		password: process.env.DB_PASSWORD || 'postgres',
		database: process.env.DB_NAME || 'aquzera',
		entities: [
			UserEntity,
			PasswordResetRecordEntity,
			ProductEntity,
			OrderEntity,
			OrderItemEntity,
			InvoiceEntity,
			InvoiceItemEntity,
			InstallationEntity,
			ServiceBookingEntity,
			ServiceTypeEntity,
			CrmRecordEntity,
			SupportTicketEntity,
			SupportTicketMessageEntity,
			PaymentIntentEntity,
			AuditLogEntity,
			Upload,
			BlogEntity,
			VendorCategoryEntity,
		],
		synchronize: process.env.DB_SYNCHRONIZE !== 'false',
		logging: false,
	});

	await AppDataSource.initialize();
	console.log('✅ Database connected');

	const vendorCategoryRepo = AppDataSource.getRepository(VendorCategoryEntity);
	for (const [index, seed] of defaultVendorCategories.entries()) {
		const slug = seed.slug || slugify(seed.label);
		const existing = await vendorCategoryRepo.findOne({ where: { slug } });
		await vendorCategoryRepo.save(
			vendorCategoryRepo.create({
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
	console.log('✅ Vendor categories seeded');

	// Create users
	const userRepo = AppDataSource.getRepository(UserEntity);
	for (const userData of userSeeds) {
		const existing = await userRepo.findOne({
			where: { email: userData.email },
		});
		if (!existing) {
			await userRepo.save(
				userRepo.create({
					fullName: userData.fullName,
					email: userData.email,
					passwordHash: await bcrypt.hash(userData.password, 10),
					role: userData.role,
					isActive: true,
				}),
			);
		}
	}

	// Create customer
	const customerPassword = await bcrypt.hash('customer123', 10);
	let customer = await userRepo.findOne({
		where: { email: 'ops@adawellness.com' },
	});

	if (!customer) {
		customer = await userRepo.save(
			userRepo.create({
				fullName: 'Ada Wellness Ltd',
				email: 'ops@adawellness.com',
				phone: '+234800000001',
				passwordHash: customerPassword,
				role: Role.CUSTOMER,
				isActive: true,
				subscriptionPlan: 'Premium Care',
				installedProducts: 2,
			}),
		);
	}

	console.log('✅ Users created');

	// Create products
	const productRepo = AppDataSource.getRepository(ProductEntity);
	let machine = await productRepo.findOne({ where: { sku: 'UPM-001' } });
	if (!machine)
		machine = await productRepo.save(
			productRepo.create({
				name: 'UltraPure Machine',
				sku: 'UPM-001',
				price: 2500,
				stock: 12,
			}),
		);

	let filter = await productRepo.findOne({ where: { sku: 'FLT-002' } });
	if (!filter)
		await productRepo.save(
			productRepo.create({
				name: 'Carbon Filter',
				sku: 'FLT-002',
				price: 120,
				stock: 150,
			}),
		);

	console.log('✅ Products created');

	await seedBlogs(AppDataSource);
	console.log('✅ Blogs created');

	await AppDataSource.destroy();
	console.log('✅ Database seed completed successfully');
	process.exit(0);
}

runSeed().catch((err) => {
	console.error('❌ Seed failed:', err);
	process.exit(1);
});

function slugify(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)+/g, '');
}
