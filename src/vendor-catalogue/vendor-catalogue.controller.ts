import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateVendorCatalogueItemDto } from './dto/create-vendor-catalogue-item.dto';
import { VendorCatalogueService } from './vendor-catalogue.service';

@ApiTags('Vendor Catalogue')
@Controller('vendor-catalogue')
export class VendorCatalogueController {
	constructor(private readonly vendorCatalogueService: VendorCatalogueService) {}

	@ApiOperation({ summary: 'List public catalogue items for a vendor' })
	@ApiParam({ name: 'vendor', description: 'Vendor slug or organization id', example: 'sweet-finger-catering' })
	@ApiResponse({ status: 200, description: 'Public catalogue items for the vendor.' })
	@Get('public/vendor/:vendor')
	findPublicByVendor(@Param('vendor') vendor: string) {
		return this.vendorCatalogueService.findPublicByVendor(vendor);
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'List catalogue items for the authenticated vendor organization' })
	@ApiResponse({ status: 200, description: 'Catalogue items owned by the current vendor.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Get('mine')
	findMine(@Req() req: { user: { id: string; role: Role } }) {
		return this.vendorCatalogueService.findMine(req.user);
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'Create a vendor catalogue item' })
	@ApiBody({ type: CreateVendorCatalogueItemDto })
	@ApiResponse({ status: 201, description: 'Catalogue item created.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Post()
	create(@Body() dto: CreateVendorCatalogueItemDto, @Req() req: { user: { id: string; role: Role } }) {
		return this.vendorCatalogueService.create(dto, req.user);
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'Update a vendor catalogue item' })
	@ApiParam({ name: 'id', description: 'Catalogue item id' })
	@ApiBody({ type: CreateVendorCatalogueItemDto })
	@ApiResponse({ status: 200, description: 'Catalogue item updated.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@ApiResponse({ status: 404, description: 'Catalogue item not found.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Patch(':id')
	update(@Param('id') id: string, @Body() dto: Partial<CreateVendorCatalogueItemDto>, @Req() req: { user: { id: string; role: Role } }) {
		return this.vendorCatalogueService.update(id, dto, req.user);
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'Archive a vendor catalogue item' })
	@ApiParam({ name: 'id', description: 'Catalogue item id' })
	@ApiResponse({ status: 200, description: 'Catalogue item archived.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@ApiResponse({ status: 404, description: 'Catalogue item not found.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
	@Delete(':id')
	archive(@Param('id') id: string, @Req() req: { user: { id: string; role: Role } }) {
		return this.vendorCatalogueService.archive(id, req.user);
	}
}
