import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateDiscountCouponDto } from './dto/create-discount-coupon.dto';
import { UpdateDiscountCouponDto, UpdateDiscountCouponStatusDto } from './dto/update-discount-coupon.dto';
import { DiscountsService } from './discounts.service';

@ApiTags('Discounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('discounts')
export class DiscountsController {
	constructor(private readonly discountsService: DiscountsService) {}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Get()
	findAll(
		@Query('organizationId') organizationId: string | undefined,
		@Query('page') page: string | undefined,
		@Query('pageSize') pageSize: string | undefined,
		@Query('search') search: string | undefined,
		@Query('status') status: string | undefined,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.discountsService.findAll(organizationId, req.user, { page, pageSize, search, status });
	}

	@Roles(Role.USER, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Get('influencer/mine')
	findInfluencerCampaigns(@Req() req: { user: { id: string; role: Role } }) {
		return this.discountsService.findInfluencerCampaigns(req.user);
	}

	@Roles(Role.USER, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Get('influencer/earnings')
	findInfluencerEarnings(@Req() req: { user: { id: string; role: Role } }) {
		return this.discountsService.findInfluencerEarnings(req.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.USER)
	@Post()
	create(@Body() dto: CreateDiscountCouponDto, @Req() req: { user: { id: string; role: Role } }) {
		return this.discountsService.create(dto, req.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.USER)
	@Patch(':id')
	update(
		@Param('id') id: string,
		@Body() dto: UpdateDiscountCouponDto,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.discountsService.update(id, dto, req.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.USER)
	@Patch(':id/status')
	updateStatus(
		@Param('id') id: string,
		@Body() dto: UpdateDiscountCouponStatusDto,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.discountsService.updateStatus(id, dto.status, req.user);
	}

	@Roles(Role.USER, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN)
	@Post(':id/approve')
	approve(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.discountsService.approve(id, req.user);
	}

	@Roles(Role.USER, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN)
	@Post(':id/decline')
	decline(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.discountsService.decline(id, req.user);
	}

	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.USER)
	@Post(':id/revoke')
	revoke(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.discountsService.revoke(id, req.user);
	}
}
