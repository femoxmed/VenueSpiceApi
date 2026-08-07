import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { FinancialLedgerEntryEntity } from './entities/financial-ledger-entry.entity';
import { FinancialLedgerService } from './financial-ledger.service';

@Module({
	imports: [
		AuditModule,
		PlatformSettingsModule,
		TypeOrmModule.forFeature([
			FinancialLedgerEntryEntity,
			TicketOrderEntity,
		]),
	],
	providers: [FinancialLedgerService],
	exports: [FinancialLedgerService],
})
export class FinancialLedgerModule {}
