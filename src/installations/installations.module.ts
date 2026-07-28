import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstallationEntity } from '../installations/entities/installation.entity';
import { InstallationsController } from './installations.controller';
import { InstallationsService } from './installations.service';

@Module({
  imports: [TypeOrmModule.forFeature([InstallationEntity])],
  controllers: [InstallationsController],
  providers: [InstallationsService],
  exports: [InstallationsService],
})
export class InstallationsModule {}
