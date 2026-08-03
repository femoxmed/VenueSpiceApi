import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PlatformSettingEntity } from './entities/platform-setting.entity';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

@Module({
	imports: [AuditModule, TypeOrmModule.forFeature([PlatformSettingEntity])],
	controllers: [PlatformSettingsController],
	providers: [PlatformSettingsService],
	exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
