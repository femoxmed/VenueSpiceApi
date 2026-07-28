import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { FindMyTicketDto } from './dto/find-my-ticket.dto';
import { TicketOrdersService } from './ticket-orders.service';

@ApiTags('Ticket Orders')
@Controller('ticket-orders')
export class TicketOrdersController {
	constructor(private readonly ticketOrdersService: TicketOrdersService) {}

	@Post('checkout')
	createCheckoutSession(@Body() dto: CreateCheckoutSessionDto) {
		return this.ticketOrdersService.createCheckoutSession(dto);
	}

	@Post('find-my-ticket')
	findMyTicket(@Body() dto: FindMyTicketDto) {
		return this.ticketOrdersService.findMyTicket(dto);
	}

	@Post('stripe/webhook')
	handleStripeWebhook(@Body() payload: any) {
		return this.ticketOrdersService.handleStripeWebhook(payload);
	}

	@Post(':id/demo-pay')
	completeDemoPayment(@Param('id') id: string) {
		return this.ticketOrdersService.completeDemoPayment(id);
	}

	@Post(':id/stripe/confirm')
	confirmStripeCheckout(@Param('id') id: string, @Query('sessionId') sessionId: string) {
		return this.ticketOrdersService.confirmStripeCheckout(id, sessionId);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF)
	@Get()
	findAll() {
		return this.ticketOrdersService.findAll();
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF)
	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.ticketOrdersService.findOne(id);
	}
}
