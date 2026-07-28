import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateAgentDto } from './dto/create-agent.dto';
import { AgentsService } from './agents.service';

@ApiTags('Agents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('agents')
export class AgentsController {
	constructor(private readonly agentsService: AgentsService) {}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Get()
	findAll(
		@Query('organizationId') organizationId: string | undefined,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.agentsService.findAll(organizationId, req.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.USER)
	@Post()
	create(@Body() dto: CreateAgentDto, @Req() req: { user: { id: string; role: Role } }) {
		return this.agentsService.create(dto, req.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Get(':id/performance')
	performance(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.agentsService.performance(id, req.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Get(':id')
	findOne(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.agentsService.findOne(id, req.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.USER)
	@Post(':id/referral-codes')
	createReferralCode(
		@Param('id') id: string,
		@Body('eventId') eventId?: string,
		@Body('code') code?: string,
		@Req() req?: { user: { id: string; role: Role } },
	) {
		return this.agentsService.createReferralCode(id, eventId, code, req?.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.USER)
	@Patch(':id/status')
	updateStatus(
		@Param('id') id: string,
		@Body('status') status: 'active' | 'paused' | 'pending_invite' | 'archived',
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.agentsService.updateStatus(id, status, req.user);
	}
}
