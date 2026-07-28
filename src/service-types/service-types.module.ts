import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceTypeEntity } from './entities/service-type.entity';
import { ServiceTypesController } from './service-types.controller';
import { ServiceTypesService } from './service-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceTypeEntity])],
  controllers: [ServiceTypesController],
  providers: [ServiceTypesService],
  exports: [ServiceTypesService],
})
export class ServiceTypesModule {}
