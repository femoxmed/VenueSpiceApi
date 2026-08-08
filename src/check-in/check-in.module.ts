import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { EventEntity } from '../events/entities/event.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationMemberEntity } from '../organizations/entities/organization-member.entity';
import { IssuedTicketEntity } from '../ticket-orders/entities/issued-ticket.entity';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';

@Module({
	imports: [
		AuditModule,
		TypeOrmModule.forFeature([
			EventEntity,
			OrganizationEntity,
			IssuedTicketEntity,
			OrganizationMemberEntity,
		]),
	],
	controllers: [CheckInController],
	providers: [CheckInService],
})
export class CheckInModule {}
