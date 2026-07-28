import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { SupportTicketEntity } from '../support-tickets/entities/support-ticket.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { ServiceTypeEntity } from '../service-types/entities/service-type.entity';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			UserEntity,
			OrderEntity,
			OrderItemEntity,
			ServiceBookingEntity,
			InvoiceEntity,
			SupportTicketEntity,
			UserEntity,
			ServiceTypeEntity,
		]),
	],
	controllers: [AdminController],
	providers: [AdminService],
	exports: [AdminService],
})
export class AdminModule {}
