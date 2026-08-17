import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { UserEntity } from './auth/entities/user.entity';
import { PasswordResetRecordEntity } from './auth/entities/password-reset-record.entity';
import { Role } from './common/enums/role.enum';
import { NewsletterSubscriberEntity } from './newsletter/entities/newsletter-subscriber.entity';
import { ProductEntity } from './products/entities/product.entity';
import { OrderEntity } from './orders/entities/order.entity';
import { OrderItemEntity } from './orders/entities/order-item.entity';
import { InvoiceEntity } from './invoices/entities/invoice.entity';
import { InvoiceItemEntity } from './invoices/entities/invoice-item.entity';
import { InstallationEntity } from './installations/entities/installation.entity';
import { ServiceBookingEntity } from './service-bookings/entities/service-booking.entity';
import { ServiceTypeEntity } from './service-types/entities/service-type.entity';
import { CrmRecordEntity } from './crm/entities';
import { SupportTicketEntity } from './support-tickets/entities/support-ticket.entity';
import { SupportTicketMessageEntity } from './support-tickets/entities/support-ticket-message.entity';
import { PaymentIntentEntity } from './payments/entities/payment-intent.entity';
import { AuditLogEntity } from './audit/entities/audit-log.entity';
import { Upload } from './uploads/entities/upload.entity';
import { BlogEntity } from './blogs/entities/blog.entity';
import { OrganizationEntity } from './organizations/entities/organization.entity';
import { OrganizationMemberEntity } from './organizations/entities/organization-member.entity';
import { EventEntity } from './events/entities/event.entity';
import { TicketTypeEntity } from './events/entities/ticket-type.entity';
import { AgentEntity } from './agents/entities/agent.entity';
import { ReferralCodeEntity } from './agents/entities/referral-code.entity';
import { DiscountCouponEntity } from './discounts/entities/discount-coupon.entity';
import { TicketOrderEntity } from './ticket-orders/entities/ticket-order.entity';
import { TicketOrderItemEntity } from './ticket-orders/entities/ticket-order-item.entity';
import { IssuedTicketEntity } from './ticket-orders/entities/issued-ticket.entity';
import { VendorCategoryEntity } from './vendor-categories/entities/vendor-category.entity';
import { VendorCatalogueItemEntity } from './vendor-catalogue/entities/vendor-catalogue-item.entity';
import { RefundRequestEntity } from './refunds/entities/refund-request.entity';

dotenv.config();

const password = process.env.SUPER_ADMIN_PASSWORD || 'Password123*';

const superAdmins = [
	{
		email: process.env.SUPER_ADMIN_EMAIL || 'venuespice.us@gmail.com',
		fullName: process.env.SUPER_ADMIN_NAME || 'Venue Spice Super Admin',
	},
];

const adminCreatedUsersToVerify = [
	'creative.azeeznosiru@gmail.com',
];

function isEnabled(value?: string | boolean | number | null) {
	return ['true', '1', 'yes', 'require', 'required'].includes(
		String(value ?? '').trim().toLowerCase(),
	);
}

async function syncSuperAdmins() {
	const dataSource = new DataSource({
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
		entities: [
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
		],
		synchronize: false,
		logging: false,
	});

	await dataSource.initialize();
	const userRepository = dataSource.getRepository(UserEntity);
	const passwordHash = await bcrypt.hash(password, 10);
	const now = new Date();

	for (const admin of superAdmins) {
		const email = admin.email.toLowerCase().trim();
		const existing = await userRepository.findOne({ where: { email } });

		if (existing) {
			existing.fullName = existing.fullName || admin.fullName;
			existing.passwordHash = passwordHash;
			existing.role = Role.SUPER_ADMIN;
			existing.isActive = true;
			existing.verifiedAt = existing.verifiedAt || now;
			existing.activeAt = existing.activeAt || now;
			existing.emailVerificationCodeHash = null;
			existing.emailVerificationExpiresAt = null;
			existing.adminOtpCodeHash = null;
			existing.adminOtpExpiresAt = null;

			await userRepository.save(existing);
			console.log(`Updated super admin: ${email}`);
			continue;
		}

		await userRepository.save(
			userRepository.create({
				fullName: admin.fullName,
				email,
				passwordHash,
				role: Role.SUPER_ADMIN,
				isActive: true,
				verifiedAt: now,
				activeAt: now,
			}),
		);
		console.log(`Created super admin: ${email}`);
	}

	for (const emailValue of adminCreatedUsersToVerify) {
		const email = emailValue.toLowerCase().trim();
		const existing = await userRepository.findOne({ where: { email } });
		if (!existing) {
			console.log(`Admin-created user not found, skipping verification sync: ${email}`);
			continue;
		}

		existing.isActive = true;
		existing.verifiedAt = existing.verifiedAt || now;
		existing.activeAt = existing.activeAt || now;
		existing.emailVerificationCodeHash = null;
		existing.emailVerificationExpiresAt = null;
		existing.adminOtpCodeHash = null;
		existing.adminOtpExpiresAt = null;

		await userRepository.save(existing);
		console.log(`Verified admin-created user: ${email}`);
	}

	await dataSource.destroy();
	console.log('Super admin sync completed.');
}

syncSuperAdmins().catch(async (error) => {
	console.error('Super admin sync failed:', error);
	process.exit(1);
});
