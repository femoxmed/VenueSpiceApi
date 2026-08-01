import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './auth/auth.module';

import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { InvoicesModule } from './invoices/invoices.module';
import { InstallationsModule } from './installations/installations.module';
import { ServiceBookingsModule } from './service-bookings/service-bookings.module';
import { ServiceTypesModule } from './service-types/service-types.module';
import { CrmModule } from './crm/crm.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QueueModule } from './queue/queue.module';
import { UploadsModule } from './uploads/uploads.module';
import { AdminModule } from './admin/admin.module';
import { SupportTicketsModule } from './support-tickets/support-tickets.module';
import { CartModule } from './cart/cart.module';
import { PaymentsModule } from './payments/payments.module';
import { AuditModule } from './audit/audit.module';
import { ContactModule } from './contact/contact.module';
import { BlogsModule } from './blogs/blogs.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { EventsModule } from './events/events.module';
import { AgentsModule } from './agents/agents.module';
import { DiscountsModule } from './discounts/discounts.module';
import { TicketOrdersModule } from './ticket-orders/ticket-orders.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { VendorCategoriesModule } from './vendor-categories/vendor-categories.module';
import { VendorCatalogueModule } from './vendor-catalogue/vendor-catalogue.module';
import { RefundsModule } from './refunds/refunds.module';
import { BlogEntity } from './blogs/entities/blog.entity';
import { OrganizationEntity } from './organizations/entities/organization.entity';
import { EventEntity } from './events/entities/event.entity';
import { TicketTypeEntity } from './events/entities/ticket-type.entity';
import { AgentEntity } from './agents/entities/agent.entity';
import { ReferralCodeEntity } from './agents/entities/referral-code.entity';
import { DiscountCouponEntity } from './discounts/entities/discount-coupon.entity';
import { TicketOrderEntity } from './ticket-orders/entities/ticket-order.entity';
import { TicketOrderItemEntity } from './ticket-orders/entities/ticket-order-item.entity';
import { IssuedTicketEntity } from './ticket-orders/entities/issued-ticket.entity';
import { UserEntity } from './auth/entities/user.entity';
import { PasswordResetRecordEntity } from './auth/entities/password-reset-record.entity';
import { NewsletterSubscriberEntity } from './newsletter/entities/newsletter-subscriber.entity';

import { ProductEntity } from './products/entities/product.entity';
import { OrderEntity } from './orders/entities/order.entity';
import { OrderItemEntity } from './orders/entities/order-item.entity';
import { InvoiceEntity } from './invoices/entities/invoice.entity';
import { InvoiceItemEntity } from './invoices/entities/invoice-item.entity';
import { InstallationEntity } from './installations/entities/installation.entity';
import { ServiceBookingEntity } from './service-bookings/entities/service-booking.entity';
import { ServiceTypeEntity } from './service-types/entities/service-type.entity';
// import { CrmEntity } from './crm/entities/crm.entity';
import { SupportTicketEntity } from './support-tickets/entities/support-ticket.entity';
import { SupportTicketMessageEntity } from './support-tickets/entities/support-ticket-message.entity';
import { PaymentIntentEntity } from './payments/entities/payment-intent.entity';
import { CrmRecordEntity } from './crm/entities';
import { AuditLogEntity } from './audit/entities/audit-log.entity';
import { Upload } from './uploads/entities/upload.entity';
import { VendorCategoryEntity } from './vendor-categories/entities/vendor-category.entity';
import { VendorCatalogueItemEntity } from './vendor-catalogue/entities/vendor-catalogue-item.entity';
import { RefundRequestEntity } from './refunds/entities/refund-request.entity';
import { DatabaseModule } from './database/database.module';

function isEnabled(value?: string | boolean | number | null) {
	return ['true', '1', 'yes', 'require', 'required'].includes(
		String(value ?? '').trim().toLowerCase(),
	);
}

function getBullQueuePrefix(value?: string | null) {
	const prefix = String(value || 'venue-spice').trim();

	if (prefix.startsWith('{') && prefix.includes('}')) {
		return prefix;
	}

	return `{${prefix}}`;
}

@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true }),
		TypeOrmModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => ({
				type: 'postgres',
				host: configService.get<string>('DB_HOST', '127.0.0.1'),
				port: configService.get<number>('DB_PORT', 5432),
				username: configService.get<string>('DB_USERNAME', 'postgres'),
				password: configService.get<string>('DB_PASSWORD', 'postgres'),
				database: configService.get<string>('DB_NAME', 'aquzera'),
				ssl: isEnabled(
					configService.get<string>('DB_SSL') ||
						configService.get<string>('DATABASE_SSL') ||
						configService.get<string>('PGSSLMODE'),
				)
					? {
							rejectUnauthorized: isEnabled(
								configService.get<string>('DB_SSL_REJECT_UNAUTHORIZED'),
							),
						}
					: false,
				synchronize:
					configService.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
				autoLoadEntities: false,
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
			}),
		}),
		BullModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => ({
				connection: {
					host: configService.get<string>('REDIS_HOST', '127.0.0.1'),
					port: configService.get<number>('REDIS_PORT', 6379),
					db: configService.get<number>('REDIS_DB', 0),
					tls:
						configService.get<string>('REDIS_TLS', 'false') === 'true'
							? {}
							: undefined,
				},
				prefix: getBullQueuePrefix(configService.get<string>('QUEUE_PREFIX')),
				defaultJobOptions: {
					attempts: configService.get<number>('QUEUE_RETRIES', 3),
					backoff: {
						type: 'exponential',
						delay: configService.get<number>('QUEUE_BACKOFF_MS', 5000),
					},
					removeOnComplete: 100,
					removeOnFail: 200,
				},
			}),
		}),
		AuthModule,
		DatabaseModule,

		ProductsModule,
		OrdersModule,
		InvoicesModule,
		InstallationsModule,
		ServiceBookingsModule,
		ServiceTypesModule,
		CrmModule,
		NotificationsModule,
		QueueModule,
		UploadsModule,
		AdminModule,
		SupportTicketsModule,
		CartModule,
		PaymentsModule,
		AuditModule,
		ContactModule,
		BlogsModule,
		OrganizationsModule,
		EventsModule,
		AgentsModule,
		DiscountsModule,
			TicketOrdersModule,
			NewsletterModule,
			VendorCategoriesModule,
			VendorCatalogueModule,
			RefundsModule,
		],
	})
export class AppModule {}
