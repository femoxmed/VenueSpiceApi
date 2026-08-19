import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuditModule } from '../audit/audit.module';
import { EventEntity } from './entities/event.entity';
import { EventPrivateAccessTokenEntity } from './entities/event-private-access-token.entity';
import { TicketTypeEntity } from './entities/ticket-type.entity';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
	imports: [TypeOrmModule.forFeature([EventEntity, EventPrivateAccessTokenEntity, TicketTypeEntity, OrganizationEntity]), OrganizationsModule, AuditModule],
	controllers: [EventsController],
	providers: [EventsService],
	exports: [EventsService],
})
export class EventsModule {}
