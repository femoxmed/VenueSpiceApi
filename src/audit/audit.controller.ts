import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
export class AuditController {
	constructor(private readonly auditService: AuditService) {}

	@ApiOperation({ summary: 'List audit log entries' })
	@ApiQuery({ name: 'page', required: false, example: 1 })
	@ApiQuery({ name: 'limit', required: false, example: 50 })
	@ApiResponse({ status: 200, description: 'Paginated audit log entries.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@Get()
	async findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
		return this.auditService.findAll(page || 1, limit || 50);
	}

	@ApiOperation({ summary: 'List audit log entries for a user' })
	@ApiParam({ name: 'userId', description: 'User id' })
	@ApiQuery({ name: 'page', required: false, example: 1 })
	@ApiQuery({ name: 'limit', required: false, example: 50 })
	@ApiResponse({ status: 200, description: 'Paginated audit log entries for the user.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@Get('user/:userId')
	async findByUserId(
		@Param('userId') userId: string,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
	) {
		return this.auditService.findByUserId(userId, page || 1, limit || 50);
	}

	@ApiOperation({ summary: 'List audit log entries for an entity' })
	@ApiParam({ name: 'entityType', description: 'Audited entity type', example: 'organization' })
	@ApiParam({ name: 'entityId', description: 'Audited entity id' })
	@ApiQuery({ name: 'page', required: false, example: 1 })
	@ApiQuery({ name: 'limit', required: false, example: 50 })
	@ApiResponse({ status: 200, description: 'Paginated audit log entries for the entity.' })
	@ApiResponse({ status: 401, description: 'Authentication required.' })
	@Get('entity/:entityType/:entityId')
	async findByEntity(
		@Param('entityType') entityType: string,
		@Param('entityId') entityId: string,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
	) {
		return this.auditService.findByEntity(
			entityType,
			entityId,
			page || 1,
			limit || 50,
		);
	}
}
