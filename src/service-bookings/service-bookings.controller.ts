import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ServiceBookingsService } from './service-bookings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateServiceBookingDto } from './dto/create-service-booking.dto';

@ApiTags('Service Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('service-bookings')
export class ServiceBookingsController {
  constructor(private readonly serviceBookingsService: ServiceBookingsService) {}

  @Get('me')
  findMine(@Req() req: { user: { id: string } }) {
    return this.serviceBookingsService.findByUser(req.user.id);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.TECHNICIAN)
  @UseGuards(RolesGuard)
  @Get()
  findAll() {
    return this.serviceBookingsService.findAll();
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  create(@Body() dto: CreateServiceBookingDto) {
    return this.serviceBookingsService.create(dto);
  }
}
