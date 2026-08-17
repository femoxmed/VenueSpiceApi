import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CheckInService } from './check-in.service';
import { ScanTicketDto } from './dto/scan-ticket.dto';
import { UpdateTicketHolderDto } from './dto/update-ticket-holder.dto';

@ApiTags('Check In')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
@Controller('check-in')
export class CheckInController {
	constructor(private readonly checkInService: CheckInService) {}

	@Get('events')
	listEvents(
		@Req() req: { user: { id: string; email?: string; role: Role } },
		@Query('organizationId') organizationId?: string,
	) {
		return this.checkInService.listEvents(req.user, organizationId);
	}

	@Get('events/:eventId/stats')
	stats(
		@Param('eventId') eventId: string,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.checkInService.stats(eventId, req.user);
	}

	@Get('events/:eventId/search')
	search(
		@Param('eventId') eventId: string,
		@Req() req: { user: { id: string; email?: string; role: Role } },
		@Query('q') q?: string,
	) {
		return this.checkInService.search(eventId, req.user, q);
	}

	@Get('events/:eventId/tickets')
	listTickets(
		@Param('eventId') eventId: string,
		@Req() req: { user: { id: string; email?: string; role: Role } },
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string,
		@Query('search') search?: string,
		@Query('status') status?: string,
	) {
		return this.checkInService.listTickets(eventId, req.user, { page, pageSize, search, status });
	}

	@Post('scan')
	scan(
		@Body() dto: ScanTicketDto,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.checkInService.scan(dto, req.user);
	}

	@Post('lookup')
	lookup(
		@Body() dto: ScanTicketDto,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.checkInService.lookup(dto, req.user);
	}

	@Patch('tickets/:ticketId/holder')
	updateTicketHolder(
		@Param('ticketId') ticketId: string,
		@Body() dto: UpdateTicketHolderDto,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.checkInService.updateTicketHolder(ticketId, dto, req.user);
	}

	@Get('tickets/:ticketId/history')
	ticketAssignmentHistory(
		@Param('ticketId') ticketId: string,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.checkInService.ticketAssignmentHistory(ticketId, req.user);
	}
}
