import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
	constructor(private readonly organizationsService: OrganizationsService) {}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Get()
	findAll() {
		return this.organizationsService.findAll();
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@Get('mine')
	findMine(@Req() req: { user: { id: string } }) {
		return this.organizationsService.findMine(req.user.id);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Post()
	create(
		@Body() dto: CreateOrganizationDto,
		@Req() req: { user: { id: string; email?: string; role?: Role } },
	) {
		return this.organizationsService.create(dto, req.user, req as any);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN)
	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.organizationsService.findOne(id);
	}

	@Get(':id/stripe/status')
	getStripeStatus(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.organizationsService.getStripeStatus(id, req.user);
	}

	@Post(':id/stripe/connect')
	createStripeConnectLink(
		@Param('id') id: string,
		@Body() dto: { returnUrl?: string },
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizationsService.createStripeConnectLink(id, req.user, dto.returnUrl);
	}

	@Post(':id/stripe/mock-complete')
	completeStripeOnboarding(
		@Param('id') id: string,
		@Body() dto: Record<string, unknown>,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizationsService.completeMockStripeOnboarding(id, req.user, dto);
	}

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
