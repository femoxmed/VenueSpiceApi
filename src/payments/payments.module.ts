import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { PaymentIntentEntity } from './entities/payment-intent.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			PaymentIntentEntity,
			InvoiceEntity,
			OrderEntity,
			ServiceBookingEntity,
		]),
		NotificationsModule,
	],
	controllers: [PaymentsController],
	providers: [PaymentsService],
	exports: [PaymentsService],
})
export class PaymentsModule {}
