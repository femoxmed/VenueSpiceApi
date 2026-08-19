import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralCodeEntity } from '../agents/entities/referral-code.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { DiscountCouponEntity } from '../discounts/entities/discount-coupon.entity';
import { EventEntity } from '../events/entities/event.entity';
import { EventPrivateAccessTokenEntity } from '../events/entities/event-private-access-token.entity';
import { TicketTypeEntity } from '../events/entities/ticket-type.entity';
import { InvoiceItemEntity } from '../invoices/entities/invoice-item.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { PaymentIntentEntity } from '../payments/entities/payment-intent.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { IssuedTicketEntity } from './entities/issued-ticket.entity';
import { TicketOrderItemEntity } from './entities/ticket-order-item.entity';
import { TicketOrderEntity } from './entities/ticket-order.entity';
import { TicketOrdersController } from './ticket-orders.controller';
import { TicketOrdersService } from './ticket-orders.service';

@Module({
	imports: [
		NotificationsModule,
		PlatformSettingsModule,
		TypeOrmModule.forFeature([
			TicketOrderEntity,
			TicketOrderItemEntity,
			IssuedTicketEntity,
			EventEntity,
			EventPrivateAccessTokenEntity,
			TicketTypeEntity,
			ReferralCodeEntity,
			DiscountCouponEntity,
			InvoiceEntity,
			InvoiceItemEntity,
			PaymentIntentEntity,
			UserEntity,
		]),
	],
	controllers: [TicketOrdersController],
	providers: [TicketOrdersService],
	exports: [TicketOrdersService],
})
export class TicketOrdersModule {}
