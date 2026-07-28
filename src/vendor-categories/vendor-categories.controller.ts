import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateVendorCategoryDto } from './dto/create-vendor-category.dto';
import { VendorCategoriesService } from './vendor-categories.service';

@ApiTags('Vendor Categories')
@Controller('vendor-categories')
export class VendorCategoriesController {
	constructor(private readonly vendorCategoriesService: VendorCategoriesService) {}

	@ApiOperation({ summary: 'List active public vendor categories' })
	@ApiResponse({ status: 200, description: 'Active categories sorted for public vendor discovery.' })
	@Get('public')
	findPublic() {
		return this.vendorCategoriesService.findPublic();
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'List all vendor categories' })
	@ApiResponse({ status: 200, description: 'All vendor categories, including inactive categories.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Get()
	findAll() {
		return this.vendorCategoriesService.findAll();
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'Create a vendor category' })
	@ApiBody({ type: CreateVendorCategoryDto })
	@ApiResponse({ status: 201, description: 'Vendor category created.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Post()
	create(@Body() dto: CreateVendorCategoryDto) {
		return this.vendorCategoriesService.create(dto);
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'Update a vendor category' })
	@ApiParam({ name: 'id', description: 'Vendor category id' })
	@ApiBody({ type: CreateVendorCategoryDto })
	@ApiResponse({ status: 200, description: 'Vendor category updated.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@ApiResponse({ status: 404, description: 'Vendor category not found.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	@Patch(':id')
	update(@Param('id') id: string, @Body() dto: Partial<CreateVendorCategoryDto>) {
		return this.vendorCategoriesService.update(id, dto);
	}
}
