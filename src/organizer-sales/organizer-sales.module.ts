import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FinancialLedgerModule } from '../financial-ledger/financial-ledger.module';
import { OrganizationMemberEntity } from '../organizations/entities/organization-member.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { TicketOrderEntity } from '../ticket-orders/entities/ticket-order.entity';
import { TicketTypeEntity } from '../events/entities/ticket-type.entity';
import { OrganizerSalesController } from './organizer-sales.controller';
import { OrganizerSalesService } from './organizer-sales.service';
import { WithdrawalRequestEntity } from './entities/withdrawal-request.entity';

@Module({
	imports: [
		ConfigModule,
		AuditModule,
		FinancialLedgerModule,
		TypeOrmModule.forFeature([
			OrganizationEntity,
			OrganizationMemberEntity,
			TicketOrderEntity,
			TicketTypeEntity,
			WithdrawalRequestEntity,
		]),
	],
	controllers: [OrganizerSalesController],
	providers: [OrganizerSalesService],
})
export class OrganizerSalesModule {}
