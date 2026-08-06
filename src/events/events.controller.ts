import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { EventsService } from './events.service';

@ApiTags('Events')
@Controller('events')
export class EventsController {
	constructor(private readonly eventsService: EventsService) {}

	@Get('public')
	findPublic() {
		return this.eventsService.findPublic();
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Get()
	findAll(
		@Query('organizationId') organizationId: string | undefined,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.eventsService.findAll(organizationId, req.user);
	}

	@Get('public/:slug')
	findPublicOne(@Param('slug') slug: string) {
		return this.eventsService.findPublicOne(slug);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Post()
	create(@Body() dto: CreateEventDto, @Req() req: { user: { id: string; role: Role } }) {
		return this.eventsService.create(dto, req.user);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Get(':id')
	findOne(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.eventsService.findOne(id, req.user);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Patch(':id')
	update(
		@Param('id') id: string,
		@Body() dto: Partial<CreateEventDto>,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.eventsService.update(id, dto, req.user, req as any);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Patch(':id/status')
	updateStatus(
		@Param('id') id: string,
		@Body('status') status: 'draft' | 'published' | 'cancelled' | 'archived',
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.eventsService.updateStatus(id, status, req.user, req as any);
	}
}
