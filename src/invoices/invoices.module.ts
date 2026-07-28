import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceItemEntity } from './entities/invoice-item.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([InvoiceEntity, InvoiceItemEntity]), NotificationsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [TypeOrmModule, InvoicesService],
})
export class InvoicesModule {}
