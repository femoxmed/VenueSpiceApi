import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CheckInService } from './check-in.service';
import { ScanTicketDto } from './dto/scan-ticket.dto';

@ApiTags('Check In')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF)
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

	@Post('scan')
	scan(
		@Body() dto: ScanTicketDto,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.checkInService.scan(dto, req.user);
	}
}
