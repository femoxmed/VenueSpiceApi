import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { VendorCatalogueItemEntity } from './entities/vendor-catalogue-item.entity';
import { VendorCatalogueController } from './vendor-catalogue.controller';
import { VendorCatalogueService } from './vendor-catalogue.service';
import { AuditModule } from '../audit/audit.module';

@Module({
	imports: [TypeOrmModule.forFeature([VendorCatalogueItemEntity, OrganizationEntity]), AuditModule],
	controllers: [VendorCatalogueController],
	providers: [VendorCatalogueService],
	exports: [VendorCatalogueService],
})
export class VendorCatalogueModule {}
