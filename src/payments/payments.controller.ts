import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { VerifyPaymentIntentDto } from './dto/verify-payment-intent.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Post('intents')
  createIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentsService.createIntent(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('me/intents')
  createMyIntent(
    @Req() req: { user: { id: string } },
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.paymentsService.createIntent(dto, req.user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Get('intents/:paymentIntentId')
  getIntent(@Param('paymentIntentId') paymentIntentId: string) {
    return this.paymentsService.getIntent(paymentIntentId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Post('intents/:paymentIntentId/verify')
  verifyIntent(
    @Param('paymentIntentId') paymentIntentId: string,
    @Body() dto: VerifyPaymentIntentDto,
  ) {
    return this.paymentsService.verifyIntent(paymentIntentId, dto.reference);
  }

  @Post('webhooks/paystack')
  handlePaystackWebhook(
    @Req() req: { rawBody?: Buffer; body: any },
    @Headers('x-paystack-signature') signature?: string,
  ) {
    return this.paymentsService.handleWebhook(req.body, signature, req.rawBody);
  }
}
