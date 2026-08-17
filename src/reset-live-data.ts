import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { AgentEntity } from './agents/entities/agent.entity';
import { ReferralCodeEntity } from './agents/entities/referral-code.entity';
import { AuditLogEntity } from './audit/entities/audit-log.entity';
import { PasswordResetRecordEntity } from './auth/entities/password-reset-record.entity';
import { UserEntity } from './auth/entities/user.entity';
import { BlogEntity } from './blogs/entities/blog.entity';
import { TicketAssignmentHistoryEntity } from './check-in/entities/ticket-assignment-history.entity';
import { CrmRecordEntity } from './crm/entities';
import { seedBlogs } from './database/seeds/blog.seed';
import { DiscountCouponEntity } from './discounts/entities/discount-coupon.entity';
import { EventEntity } from './events/entities/event.entity';
import { TicketTypeEntity } from './events/entities/ticket-type.entity';
import { FinancialLedgerEntryEntity } from './financial-ledger/entities/financial-ledger-entry.entity';
import { InstallationEntity } from './installations/entities/installation.entity';
import { InvoiceItemEntity } from './invoices/entities/invoice-item.entity';
import { InvoiceEntity } from './invoices/entities/invoice.entity';
import { NewsletterSubscriberEntity } from './newsletter/entities/newsletter-subscriber.entity';
import { NotificationEntity } from './notifications/entities/notification.entity';
import { OrderItemEntity } from './orders/entities/order-item.entity';
import { OrderEntity } from './orders/entities/order.entity';
import { OrganizationMemberEntity } from './organizations/entities/organization-member.entity';
import { OrganizationEntity } from './organizations/entities/organization.entity';
import { WithdrawalRequestEntity } from './organizer-sales/entities/withdrawal-request.entity';
import { PaymentIntentEntity } from './payments/entities/payment-intent.entity';
import { PlatformSettingEntity } from './platform-settings/entities/platform-setting.entity';
import { ProductEntity } from './products/entities/product.entity';
import { RefundRequestEntity } from './refunds/entities/refund-request.entity';
import { ServiceBookingEntity } from './service-bookings/entities/service-booking.entity';
import { ServiceTypeEntity } from './service-types/entities/service-type.entity';
import { SupportTicketMessageEntity } from './support-tickets/entities/support-ticket-message.entity';
import { SupportTicketEntity } from './support-tickets/entities/support-ticket.entity';
import { IssuedTicketEntity } from './ticket-orders/entities/issued-ticket.entity';
import { TicketOrderItemEntity } from './ticket-orders/entities/ticket-order-item.entity';
import { TicketOrderEntity } from './ticket-orders/entities/ticket-order.entity';
import { Upload } from './uploads/entities/upload.entity';
import { VendorCatalogueItemEntity } from './vendor-catalogue/entities/vendor-catalogue-item.entity';
import { defaultVendorCategories } from './vendor-categories/vendor-categories.service';
import { VendorCategoryEntity } from './vendor-categories/entities/vendor-category.entity';
import { Role } from './common/enums/role.enum';

dotenv.config();

const RESET_CONFIRMATION = 'WIPE_VENUE_SPICE_LIVE';

const entities = [
	UserEntity,
	PasswordResetRecordEntity,
	NewsletterSubscriberEntity,
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
	OrganizationEntity,
	OrganizationMemberEntity,
	EventEntity,
	TicketTypeEntity,
	AgentEntity,
	ReferralCodeEntity,
	DiscountCouponEntity,
	TicketOrderEntity,
	TicketOrderItemEntity,
	IssuedTicketEntity,
	VendorCategoryEntity,
	VendorCatalogueItemEntity,
	RefundRequestEntity,
	PlatformSettingEntity,
	FinancialLedgerEntryEntity,
	WithdrawalRequestEntity,
	NotificationEntity,
	TicketAssignmentHistoryEntity,
];

const platformSettings = [
	['VENUE_SPICE_FEE_PERCENT', '0.032', 'number', 'Venue Spice percentage service fee per paid ticket.'],
	['VENUE_SPICE_FEE_FIXED', '1.29', 'number', 'Venue Spice fixed service fee per paid ticket.'],
	['PAYMENT_PROCESSING_FEE_PERCENT', '0.029', 'number', 'Estimated payment processing percentage fee per order.'],
	['PAYMENT_PROCESSING_FEE_FIXED', '0.3', 'number', 'Estimated payment processing fixed fee per order.'],
	['ORGANIZER_PAYOUT_HOLD_DAYS', '3', 'number', 'Days after an event ends before organizer earnings become withdrawable.'],
	['DEFAULT_FEE_PAYER', 'buyer', 'string', 'Default fee payer for new checkout sessions.'],
	['STRIPE_AUTOMATIC_TAX_ENABLED', 'true', 'boolean', 'Enable Stripe Automatic Tax for ticket checkout sessions.'],
	['STRIPE_TAX_CODE', '', 'string', 'Optional Stripe tax code applied to checkout products.'],
	['STRIPE_TAX_BEHAVIOR', 'exclusive', 'string', 'Stripe price tax behavior for checkout line items.'],
] satisfies Array<[string, string, 'string' | 'number' | 'boolean', string]>;

function isEnabled(value?: string | boolean | number | null) {
	return ['true', '1', 'yes', 'require', 'required'].includes(
		String(value ?? '').trim().toLowerCase(),
	);
}

function slugify(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)+/g, '');
}

function assertConfirmed() {
	if (process.env.RESET_LIVE_CONFIRM !== RESET_CONFIRMATION) {
		throw new Error(
			`Refusing to reset data. Set RESET_LIVE_CONFIRM=${RESET_CONFIRMATION} to run this destructive command.`,
		);
	}

	if (process.env.NODE_ENV !== 'production' && !isEnabled(process.env.ALLOW_NON_PRODUCTION_RESET)) {
		throw new Error('Refusing to reset outside production unless ALLOW_NON_PRODUCTION_RESET=true is set.');
	}
}

function createDataSource() {
	return new DataSource({
		type: 'postgres',
		host: process.env.DB_HOST || 'localhost',
		port: Number(process.env.DB_PORT || 5432),
		username: process.env.DB_USERNAME || 'postgres',
		password: process.env.DB_PASSWORD || 'postgres',
		database: process.env.DB_NAME || 'aquzera',
		ssl: isEnabled(process.env.DB_SSL || process.env.DATABASE_SSL || process.env.PGSSLMODE)
			? {
					rejectUnauthorized: isEnabled(process.env.DB_SSL_REJECT_UNAUTHORIZED),
				}
			: false,
		entities,
		synchronize: true,
		dropSchema: true,
		logging: false,
	});
}

async function seedVendorCategories(dataSource: DataSource) {
	const categoriesRepository = dataSource.getRepository(VendorCategoryEntity);

	for (const [index, seed] of defaultVendorCategories.entries()) {
		const slug = seed.slug || slugify(seed.label);
		await categoriesRepository.save(
			categoriesRepository.create({
				label: seed.label.trim(),
				slug,
				searchTerms: seed.searchTerms ?? [seed.label.trim()],
				iconKey: seed.iconKey?.trim() || null,
				sortOrder: seed.sortOrder ?? index + 1,
				isActive: seed.isActive ?? true,
			}),
		);
	}

	console.log(`Seeded ${defaultVendorCategories.length} vendor categories.`);
}

async function seedPlatformSettings(dataSource: DataSource) {
	const settingsRepository = dataSource.getRepository(PlatformSettingEntity);

	for (const [key, fallback, valueType, description] of platformSettings) {
		const value = process.env[`DEFAULT_${key}`] ?? process.env[key] ?? fallback;
		await settingsRepository.save(
			settingsRepository.create({
				key,
				value,
				valueType,
				description,
			}),
		);
	}

	console.log('Seeded platform settings.');
}

async function seedSuperAdmin(dataSource: DataSource) {
	const email = (process.env.SUPER_ADMIN_EMAIL || 'venuespice.us@gmail.com').toLowerCase().trim();
	const password = process.env.SUPER_ADMIN_PASSWORD || 'Password123*';
	const fullName = process.env.SUPER_ADMIN_NAME || 'Venue Spice Super Admin';
	const now = new Date();

	await dataSource.getRepository(UserEntity).save(
		dataSource.getRepository(UserEntity).create({
			fullName,
			email,
			passwordHash: await bcrypt.hash(password, 10),
			role: Role.SUPER_ADMIN,
			isActive: true,
			verifiedAt: now,
			activeAt: now,
		}),
	);

	console.log(`Created super admin: ${email}`);
}

async function resetLiveData() {
	assertConfirmed();

	console.log('Starting Venue Spice live data reset...');

	const dataSource = createDataSource();
	await dataSource.initialize();
	console.log('Database schema dropped and recreated.');

	await seedPlatformSettings(dataSource);
	await seedVendorCategories(dataSource);
	await seedBlogs(dataSource);
	await seedSuperAdmin(dataSource);

	await dataSource.destroy();
	console.log('Venue Spice live data reset completed.');
}

resetLiveData().catch((error) => {
	console.error('Venue Spice live data reset failed:', error);
	process.exit(1);
});
