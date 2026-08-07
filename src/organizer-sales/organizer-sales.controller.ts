import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizerSalesService } from './organizer-sales.service';

@ApiTags('Organizer Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF, Role.USER)
@Controller('organizer-sales')
export class OrganizerSalesController {
	constructor(private readonly organizerSalesService: OrganizerSalesService) {}

	@Get('summary')
	summary(
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizerSalesService.summary(organizationId, req.user);
	}

	@Get('orders')
	orders(
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizerSalesService.orders(organizationId, req.user);
	}

	@Get('orders/:id')
	orderDetail(
		@Param('id') id: string,
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizerSalesService.orderDetail(organizationId, id, req.user);
	}

	@Get('events/:id')
	eventDetail(
		@Param('id') id: string,
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizerSalesService.eventDetail(organizationId, id, req.user);
	}

	@Get('tickets/:id')
	ticketDetail(
		@Param('id') id: string,
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizerSalesService.ticketDetail(organizationId, id, req.user);
	}

	@Get('merchandise/:id')
	merchandiseDetail(
		@Param('id') id: string,
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizerSalesService.merchandiseDetail(organizationId, id, req.user);
	}

	@Get('balance')
	balance(
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizerSalesService.balance(organizationId, req.user);
	}

	@Get('withdrawal-requests')
	withdrawalRequests(
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.organizerSalesService.listWithdrawalRequests(organizationId, req.user);
	}

	@Post('withdrawal-requests')
	requestWithdrawal(
		@Query('organizationId') organizationId: string,
		@Body() body: { amount?: number; note?: string },
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.organizerSalesService.requestWithdrawal(organizationId, req.user, body);
	}

	@Post('stripe-dashboard-link')
	stripeDashboardLink(
		@Query('organizationId') organizationId: string,
		@Req() req: { user: { id: string; role: Role } },
	) {
		return this.organizerSalesService.createStripeDashboardLink(organizationId, req.user);
	}

	@Post('withdraw')
	withdraw(
		@Query('organizationId') organizationId: string,
		@Body() body: { amount?: number; note?: string },
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.organizerSalesService.requestWithdrawal(organizationId, req.user, body);
	}

	@Get('admin/withdrawal-requests')
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	adminWithdrawalRequests(@Query('status') status?: string) {
		return this.organizerSalesService.listAdminWithdrawalRequests(status);
	}

	@Get('admin/stripe-balance')
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	adminStripeBalance() {
		return this.organizerSalesService.getStripePlatformBalance();
	}

	@Patch('admin/withdrawal-requests/:id/approve')
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	approveWithdrawalRequest(
		@Param('id') id: string,
		@Body() body: { note?: string },
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.organizerSalesService.approveWithdrawalRequest(id, req.user, body);
	}

	@Patch('admin/withdrawal-requests/:id/reject')
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	rejectWithdrawalRequest(
		@Param('id') id: string,
		@Body() body: { note?: string },
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.organizerSalesService.rejectWithdrawalRequest(id, req.user, body);
	}

	@Post('admin/withdrawal-requests/:id/pay')
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN)
	payWithdrawalRequest(
		@Param('id') id: string,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.organizerSalesService.payWithdrawalRequest(id, req.user);
	}
}
