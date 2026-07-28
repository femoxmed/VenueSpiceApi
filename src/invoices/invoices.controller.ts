import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ResendInvoiceDto } from './dto/resend-invoice.dto';

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get('me')
  findMine(@Req() req: { user: { id: string } }) {
    return this.invoicesService.findByUser(req.user.id);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  findAll() {
    return this.invoicesService.findAll();
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':invoiceId/resend')
  resendInvoice(@Param('invoiceId') invoiceId: string, @Body() dto: ResendInvoiceDto) {
    return this.invoicesService.resendInvoice(invoiceId, dto.email);
  }
}
