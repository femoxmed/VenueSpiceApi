import {
	Body,
	Controller,
	Get,
	Post,
	Put,
	Param,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ServiceTypesService } from './service-types.service';
import { CreateServiceTypeDto } from './dto/create-service-type.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('Service Types')
@ApiBearerAuth()
@Controller('service-types')
export class ServiceTypesController {
	constructor(private readonly serviceTypesService: ServiceTypesService) {}

	@Get('public')
	findPublic() {
		return this.serviceTypesService.findActive();
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@Get()
	findAll() {
		return this.serviceTypesService.findAll();
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Post()
	create(@Body() dto: CreateServiceTypeDto) {
		return this.serviceTypesService.create(dto);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.serviceTypesService.findOne(id);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Put(':id')
	update(@Param('id') id: string, @Body() dto: Partial<CreateServiceTypeDto>) {
		return this.serviceTypesService.update(id, dto);
	}
}
