import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CrmService } from './crm.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('CRM')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Get()
  findAll() {
    return this.crmService.findAll();
  }
}
