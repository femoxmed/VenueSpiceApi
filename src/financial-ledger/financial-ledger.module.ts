import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { EventEntity } from '../events/entities/event.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { WithdrawalRequestEntity } from '../organizer-sales/entities/withdrawal-request.entity';
import { RefundRequestEntity } from '../refunds/entities/refund-request.entity';
import { FinancialLedgerEntryEntity } from './entities/financial-ledger-entry.entity';
import { FinancialLedgerService } from './financial-ledger.service';

@Module({
	imports: [
		AuditModule,
		PlatformSettingsModule,
		TypeOrmModule.forFeature([
			FinancialLedgerEntryEntity,
			TicketOrderEntity,
			OrganizationEntity,
			WithdrawalRequestEntity,
			RefundRequestEntity,
			EventEntity,
		]),
	],
	providers: [FinancialLedgerService],
	exports: [FinancialLedgerService],
})
export class FinancialLedgerModule {}
