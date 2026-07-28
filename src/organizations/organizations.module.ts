import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from './entities/organization.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { VendorsController } from './vendors.controller';

@Module({
	imports: [TypeOrmModule.forFeature([OrganizationEntity])],
	controllers: [OrganizationsController, VendorsController],
	providers: [OrganizationsService],
	exports: [OrganizationsService],
})
export class OrganizationsModule {}
