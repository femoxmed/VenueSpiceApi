import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('Platform Settings')
@ApiBearerAuth()
@Controller('platform-settings')
export class PlatformSettingsController {
	constructor(private readonly platformSettingsService: PlatformSettingsService) {}

	@Get('public/pricing')
	@ApiOperation({ summary: 'Read public checkout pricing and tax settings' })
	@ApiResponse({ status: 200, description: 'Public pricing settings returned.' })
	getPublicPricing() {
		return this.platformSettingsService.getPricingSettings();
	}

	@Get()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@ApiOperation({ summary: 'List platform settings and active pricing configuration' })
	@ApiResponse({ status: 200, description: 'Platform settings returned.' })
	findAll() {
		return this.platformSettingsService.findAll();
	}

	@Patch('pricing')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@ApiOperation({ summary: 'Update platform pricing settings' })
	@ApiResponse({ status: 200, description: 'Pricing settings updated.' })
	updatePricing(
		@Body() dto: UpdatePlatformSettingsDto,
		@Req() req: { user?: { id?: string; email?: string; role?: string } },
	) {
		return this.platformSettingsService.updatePricingSettings(dto, req.user);
	}
}
