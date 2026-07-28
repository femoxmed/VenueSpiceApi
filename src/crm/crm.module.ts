import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmRecordEntity } from '../crm/entities/crm-record.entity';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  imports: [TypeOrmModule.forFeature([CrmRecordEntity])],
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
