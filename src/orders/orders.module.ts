import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEntity } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { InvoiceItemEntity } from '../invoices/entities/invoice-item.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			OrderEntity,
			OrderItemEntity,
			UserEntity,
			ProductEntity,
			InvoiceEntity,
			InvoiceItemEntity,
		]),
		NotificationsModule,
	],
	controllers: [OrdersController],
	providers: [OrdersService],
	exports: [OrdersService],
})
export class OrdersModule {}
