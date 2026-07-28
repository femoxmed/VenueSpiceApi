import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceBookingEntity } from '../service-bookings/entities/service-booking.entity';
import { ServiceBookingsController } from './service-bookings.controller';
import { ServiceBookingsService } from './service-bookings.service';
import { UserEntity } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceTypeEntity } from '../service-types/entities/service-type.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { InvoiceItemEntity } from '../invoices/entities/invoice-item.entity';
import { OrderItemEntity } from '../orders/entities/order-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceBookingEntity, UserEntity, UserEntity, ServiceTypeEntity, InvoiceEntity, InvoiceItemEntity, OrderItemEntity]),
    NotificationsModule,
  ],
  controllers: [ServiceBookingsController],
  providers: [ServiceBookingsService],
  exports: [ServiceBookingsService],
})
export class ServiceBookingsModule {}
