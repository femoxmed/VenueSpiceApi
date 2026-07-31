import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UserEntity } from '../auth/entities/user.entity';
import { TicketTypeEntity } from '../events/entities/ticket-type.entity';
import { IssuedTicketEntity } from '../ticket-orders/entities/issued-ticket.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { RefundRequestEntity } from './entities/refund-request.entity';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			RefundRequestEntity,
			TicketOrderEntity,
			IssuedTicketEntity,
			TicketTypeEntity,
			UserEntity,
		]),
		AuditModule,
	],
	controllers: [RefundsController],
	providers: [RefundsService],
	exports: [RefundsService],
})
export class RefundsModule {}
