import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Module({
	imports: [TypeOrmModule.forFeature([AuditLogEntity])],
	controllers: [AuditController],
	providers: [AuditService],
	exports: [AuditService],
})
export class AuditModule {}
