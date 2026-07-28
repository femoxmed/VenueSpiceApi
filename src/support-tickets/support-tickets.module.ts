import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicketEntity } from './entities/support-ticket.entity';
import { SupportTicketMessageEntity } from './entities/support-ticket-message.entity';
import { UserEntity } from '../auth/entities/user.entity';
import {
	SupportTicketEmailController,
	SupportTicketsController,
} from './support-tickets.controller';
import { SupportTicketsService } from './support-tickets.service';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			SupportTicketEntity,
			SupportTicketMessageEntity,
			UserEntity,
			ServiceBookingEntity,
			ProductEntity,
		]),
		NotificationsModule,
	],
	controllers: [SupportTicketsController, SupportTicketEmailController],
	providers: [SupportTicketsService],
	exports: [SupportTicketsService],
})
export class SupportTicketsModule {}
