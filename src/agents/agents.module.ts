import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from '../events/entities/event.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentEntity } from './entities/agent.entity';
import { ReferralCodeEntity } from './entities/referral-code.entity';

@Module({
	imports: [
		NotificationsModule,
		TypeOrmModule.forFeature([
			AgentEntity,
			ReferralCodeEntity,
			OrganizationEntity,
			EventEntity,
			TicketOrderEntity,
		]),
	],
	controllers: [AgentsController],
	providers: [AgentsService],
	exports: [AgentsService],
})
export class AgentsModule {}
