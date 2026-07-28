import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SupportTicketsService } from './support-tickets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';

@ApiTags('Support Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('support-tickets')
export class SupportTicketsController {
	constructor(private readonly supportTicketsService: SupportTicketsService) {}

	@Get('me')
	findMine(@Req() req: { user: { id: string } }) {
		return this.supportTicketsService.findByCustomer(req.user.id);
	}

	@Post('me')
	createMine(
		@Req() req: { user: { id: string } },
		@Body() dto: Omit<CreateSupportTicketDto, 'customerId' | 'status'>,
	) {
		return this.supportTicketsService.create({
			...dto,
			customerId: req.user.id,
			status: 'open',
		});
	}

	@Get('me/:id/messages')
	findMyMessages(
		@Param('id') id: string,
		@Req() req: { user: { id: string } },
	) {
		return this.supportTicketsService.findOneWithMessagesForCustomer(
			id,
			req.user.id,
		);
	}

	@Post('me/:id/messages')
	addMyMessage(
		@Param('id') id: string,
		@Body() dto: CreateTicketMessageDto,
		@Req() req: { user: { id: string } },
	) {
		return this.supportTicketsService.addCustomerMessage(id, req.user.id, dto);
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Get()
	findAll() {
		return this.supportTicketsService.findAll();
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Get('stats')
	getStats() {
		return this.supportTicketsService.getStats();
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.supportTicketsService.findOne(id);
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Get(':id/messages')
	findOneWithMessages(@Param('id') id: string) {
		return this.supportTicketsService.findOneWithMessages(id);
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Post()
	create(@Body() dto: CreateSupportTicketDto) {
		return this.supportTicketsService.create(dto);
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Put(':id')
	update(@Param('id') id: string, @Body() dto: UpdateSupportTicketDto) {
		return this.supportTicketsService.update(id, dto);
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Patch(':id/assign')
	assignTicket(@Param('id') id: string, @Body() dto: AssignTicketDto) {
		return this.supportTicketsService.assignTicket(id, dto);
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Patch(':id/status')
	updateStatus(@Param('id') id: string, @Body('status') status: string) {
		return this.supportTicketsService.updateStatus(id, status);
	}

	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@UseGuards(RolesGuard)
	@Post(':id/messages')
	addMessage(
		@Param('id') id: string,
		@Body() dto: CreateTicketMessageDto,
		@Req() req: any,
	) {
		return this.supportTicketsService.addMessage(id, req.user.id, dto, true);
	}

	@Roles(Role.SUPER_ADMIN)
	@UseGuards(RolesGuard)
	@Delete(':id')
	delete(@Param('id') id: string) {
		return this.supportTicketsService.delete(id);
	}
}

@ApiTags('Support Ticket Email')
@Controller('support-ticket-email')
export class SupportTicketEmailController {
	constructor(private readonly supportTicketsService: SupportTicketsService) {}

	@Post('inbound')
	addInboundEmail(
		@Body()
		dto: {
			ticketId?: string;
			emailThreadId?: string;
			fromEmail: string;
			content: string;
			externalMessageId?: string;
		},
	) {
		return this.supportTicketsService.addEmailMessage(dto);
	}
}
