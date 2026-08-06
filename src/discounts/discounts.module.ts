import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from '../agents/entities/agent.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { EventEntity } from '../events/entities/event.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { ReferralCodeEntity } from '../agents/entities/referral-code.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';
import { DiscountCouponEntity } from './entities/discount-coupon.entity';

@Module({
	imports: [
		NotificationsModule,
		TypeOrmModule.forFeature([
			DiscountCouponEntity,
			OrganizationEntity,
			EventEntity,
			AgentEntity,
			UserEntity,
			TicketOrderEntity,
			ReferralCodeEntity,
		]),
	],
	controllers: [DiscountsController],
	providers: [DiscountsService],
	exports: [DiscountsService],
})
export class DiscountsModule {}
