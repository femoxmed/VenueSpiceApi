import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from '../agents/entities/agent.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { EventEntity } from '../events/entities/event.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';
import { DiscountCouponEntity } from './entities/discount-coupon.entity';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			DiscountCouponEntity,
			OrganizationEntity,
			EventEntity,
			AgentEntity,
			UserEntity,
		]),
	],
	controllers: [DiscountsController],
	providers: [DiscountsService],
	exports: [DiscountsService],
})
export class DiscountsModule {}
