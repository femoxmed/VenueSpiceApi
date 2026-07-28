import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';

@ApiTags('Vendors')
@Controller('vendors')
export class VendorsController {
	constructor(private readonly organizationsService: OrganizationsService) {}

	@ApiOperation({ summary: 'Search public vendors' })
	@ApiQuery({ name: 'q', required: false, description: 'Search by vendor name or profile text', example: 'catering' })
	@ApiQuery({ name: 'category', required: false, description: 'Vendor category slug or label', example: 'catering' })
	@ApiQuery({ name: 'location', required: false, description: 'Preferred location text', example: 'Miami' })
	@ApiResponse({ status: 200, description: 'Public vendor search results.' })
	@Get('public')
	findPublicVendors(
		@Query('q') query?: string,
		@Query('category') category?: string,
		@Query('location') location?: string,
	) {
		return this.organizationsService.findPublicVendors({ query, category, location });
	}

	@ApiOperation({ summary: 'Get a public vendor profile by slug' })
	@ApiParam({ name: 'slug', description: 'Vendor organization slug', example: 'sweet-finger-catering' })
	@ApiResponse({ status: 200, description: 'Public vendor profile.' })
	@ApiResponse({ status: 404, description: 'Vendor not found.' })
	@Get('public/:slug')
	findPublicVendor(@Param('slug') slug: string) {
		return this.organizationsService.findPublicVendor(slug);
	}
}
