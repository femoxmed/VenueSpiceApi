import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { ProductEntity } from '../products/entities/product.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, UserEntity, UserEntity]),
    OrdersModule,
    PaymentsModule,
  ],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
