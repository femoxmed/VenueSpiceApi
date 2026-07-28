import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InstallationsService } from './installations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@ApiTags('Installations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('installations')
export class InstallationsController {
  constructor(private readonly installationsService: InstallationsService) {}

  @Get('me')
  findMine(@Req() req: { user: { id: string } }) {
    return this.installationsService.findByCustomer(req.user.id);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.TECHNICIAN)
  @UseGuards(RolesGuard)
  @Get()
  findAll() {
    return this.installationsService.findAll();
  }
}
