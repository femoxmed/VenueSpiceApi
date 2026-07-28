import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EventEntity } from './entities/event.entity';
import { TicketTypeEntity } from './entities/ticket-type.entity';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
	imports: [TypeOrmModule.forFeature([EventEntity, TicketTypeEntity, OrganizationEntity]), OrganizationsModule],
	controllers: [EventsController],
	providers: [EventsService],
	exports: [EventsService],
})
export class EventsModule {}
