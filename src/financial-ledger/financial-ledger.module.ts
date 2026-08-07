import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { FinancialLedgerEntryEntity } from './entities/financial-ledger-entry.entity';
import { FinancialLedgerService } from './financial-ledger.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			FinancialLedgerEntryEntity,
			TicketOrderEntity,
		]),
	],
	providers: [FinancialLedgerService],
	exports: [FinancialLedgerService],
})
export class FinancialLedgerModule {}
