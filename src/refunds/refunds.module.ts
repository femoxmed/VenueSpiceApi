import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserEntity } from '../auth/entities/user.entity';
import { TicketTypeEntity } from '../events/entities/ticket-type.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { PaymentIntentEntity } from '../payments/entities/payment-intent.entity';
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
			InvoiceEntity,
			PaymentIntentEntity,
		]),
		AuditModule,
		NotificationsModule,
	],
	controllers: [RefundsController],
	providers: [RefundsService],
	exports: [RefundsService],
})
export class RefundsModule {}
