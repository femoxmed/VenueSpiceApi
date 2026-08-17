import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateOrganizationMemberDto } from './dto/create-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';
import { UpdateOrganizationDealDto } from './dto/update-organization-deal.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
	constructor(private readonly organizationsService: OrganizationsService) {}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Get()
	findAll() {
		return this.organizationsService.findAll();
	}

	@UseGuards(JwtAuthGuard)
	@Get('mine')
	findMine(@Req() req: { user: { id: string } }) {
		return this.organizationsService.findMine(req.user.id);
	}

	@Get('username-availability')
	checkOrganizerUsernameAvailability(
		@Query('username') username = '',
		@Query('organizationId') organizationId?: string,
	) {
		return this.organizationsService.checkOrganizerUsernameAvailability(username, organizationId);
	}

	@Get('username-suggestions')
	suggestOrganizerUsernames(
		@Query('firstName') firstName = '',
		@Query('lastName') lastName = '',
	) {
		return this.organizationsService.suggestOrganizerUsernames(firstName, lastName);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Post()
	create(
		@Body() dto: CreateOrganizationDto,
		@Req() req: { user: { id: string; email?: string; role?: Role } },
	) {
		return this.organizationsService.create(dto, req.user, req as any);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Patch(':id/deal')
	updateDeal(
		@Param('id') id: string,
		@Body() dto: UpdateOrganizationDealDto,
		@Req() req: { user: { id: string; email?: string; role?: Role } },
	) {
		return this.organizationsService.updateDeal(id, dto, req.user, req as any);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN)
	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.organizationsService.findOne(id);
	}

	@UseGuards(JwtAuthGuard)
	@Get(':id/stripe/status')
	getStripeStatus(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.organizationsService.getStripeStatus(id, req.user);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF)
	@Get(':id/team')
	listTeam(@Param('id') id: string, @Req() req: { user: { id: string; email?: string; role?: Role } }) {
		return this.organizationsService.listOrganizationMembers(id, req.user);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN)
	@Post(':id/team')
	createTeamMember(
		@Param('id') id: string,
		@Body() dto: CreateOrganizationMemberDto,
		@Req() req: { user: { id: string; email?: string; role?: Role } },
	) {
		return this.organizationsService.createOrganizationMember(id, dto, req.user, req as any);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN)
	@Patch(':id/team/:memberId')
	updateTeamMember(
		@Param('id') id: string,
		@Param('memberId') memberId: string,
		@Body() dto: UpdateOrganizationMemberDto,
		@Req() req: { user: { id: string; email?: string; role?: Role } },
	) {
		return this.organizationsService.updateOrganizationMember(id, memberId, dto, req.user, req as any);
	}

	@UseGuards(JwtAuthGuard)
	@Post(':id/stripe/connect')
	createStripeConnectLink(
		@Param('id') id: string,
		@Body() dto: { returnUrl?: string },
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizationsService.createStripeConnectLink(id, req.user, dto.returnUrl);
	}

	@UseGuards(JwtAuthGuard)
	@Post(':id/stripe/mock-complete')
	completeStripeOnboarding(
		@Param('id') id: string,
		@Body() dto: Record<string, unknown>,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizationsService.completeMockStripeOnboarding(id, req.user, dto);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.USER)
	@Patch(':id')
	update(
		@Param('id') id: string,
		@Body() dto: Partial<CreateOrganizationDto>,
		@Req() req: { user: { id: string; role?: Role } },
	) {
		return this.organizationsService.update(id, dto, req.user, req as any);
	}
}
