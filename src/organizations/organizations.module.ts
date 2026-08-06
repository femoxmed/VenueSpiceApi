import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from './entities/organization.entity';
import { OrganizationMemberEntity } from './entities/organization-member.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { VendorsController } from './vendors.controller';
import { AuditModule } from '../audit/audit.module';
import { UserEntity } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
	imports: [TypeOrmModule.forFeature([OrganizationEntity, OrganizationMemberEntity, UserEntity]), AuditModule, NotificationsModule],
	controllers: [OrganizationsController, VendorsController],
	providers: [OrganizationsService],
	exports: [OrganizationsService],
})
export class OrganizationsModule {}
