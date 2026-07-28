import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasswordResetRecordEntity } from '../auth/entities/password-reset-record.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { CrmRecordEntity } from '../crm/entities/crm-record.entity';
import { InstallationEntity } from '../installations/entities/installation.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { InvoiceItemEntity } from '../invoices/entities/invoice-item.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { SupportTicketEntity } from '../support-tickets/entities/support-ticket.entity';
import { SupportTicketMessageEntity } from '../support-tickets/entities/support-ticket-message.entity';
import { VendorCategoryEntity } from '../vendor-categories/entities/vendor-category.entity';
import { DatabaseSeedService } from './seeds/database.seed.service';

@Global()
@Module({
	imports: [
		TypeOrmModule.forFeature([
			UserEntity,
			PasswordResetRecordEntity,
			ProductEntity,
			OrderEntity,
			OrderItemEntity,
			InstallationEntity,
			ServiceBookingEntity,
			CrmRecordEntity,
			InvoiceEntity,
			InvoiceItemEntity,
				SupportTicketEntity,
				SupportTicketMessageEntity,
				VendorCategoryEntity,
			]),
	],
	providers: [DatabaseSeedService],
	exports: [TypeOrmModule, DatabaseSeedService],
})
export class DatabaseModule {}
