import { Body, Query, DefaultValuePipe, ParseIntPipe, ParseUUIDPipe, BadRequestException, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import { ReviewRefundRequestDto } from './dto/review-refund-request.dto';
import { AdminRefundDto } from './dto/admin-refund.dto';
import { RefundReconciliationService } from './refund-reconciliation.service';
import { RefundReason } from './refund-policy';
import { RefundsService } from './refunds.service';

@ApiTags('Refunds')
@Controller('refunds')
export class RefundsController {
	constructor(private readonly refundsService: RefundsService, private readonly reconciliation: RefundReconciliationService) {}

 @UseGuards(JwtAuthGuard, RolesGuard)
 @Roles(Role.SUPER_ADMIN,Role.PLATFORM_ADMIN,Role.ADMIN)
 @Get('reconciliation')
 report(@Query('page',new DefaultValuePipe(1),ParseIntPipe) page:number,@Req() req:{user:{role:Role}}) {
  if(page<1 || page>100000) throw new BadRequestException('Invalid report page');
  return this.reconciliation.report(page,req.user);
 }
 @UseGuards(JwtAuthGuard, RolesGuard)
 @Roles(Role.SUPER_ADMIN,Role.PLATFORM_ADMIN,Role.ADMIN)
 @Get('admin-preview/:orderId')
 preview(@Param('orderId',ParseUUIDPipe) orderId:string,@Query('cancellationReason') cancellationReason:RefundReason,@Req() req:{user:{role:Role}}) {
  return this.refundsService.adminPreview(orderId,req.user,cancellationReason);
 }
 @UseGuards(JwtAuthGuard, RolesGuard)
 @Roles(Role.SUPER_ADMIN,Role.PLATFORM_ADMIN,Role.ADMIN)
 @Post('admin-issue')
 issue(@Body() dto:AdminRefundDto,@Req() req:{user:{id:string;role:Role;email?:string}}) {
  return this.refundsService.adminIssue(dto,req.user,req as any);
 }

	@ApiOperation({ summary: 'Request a ticket order refund' })
	@ApiResponse({ status: 201, description: 'Refund request created.' })
	@Post('requests')
	createRequest(@Body() dto: CreateRefundRequestDto) {
		return this.refundsService.createRequest(dto);
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'List refund requests' })
	@ApiResponse({ status: 200, description: 'Refund requests.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN, Role.ORG_STAFF)
	@Get('requests')
	findAll(@Req() req: { user: { id: string; role: Role } }) {
		return this.refundsService.findAll(req.user);
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'Approve and process a refund request' })
	@ApiParam({ name: 'id', description: 'Refund request id' })
	@ApiResponse({ status: 200, description: 'Refund approved and processed.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN)
	@Post('requests/:id/approve')
	approve(
		@Param('id') id: string,
		@Body() dto: ReviewRefundRequestDto,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.refundsService.approve(id, dto, req.user, req as any);
	}

	@ApiBearerAuth()
	@ApiOperation({ summary: 'Decline a refund request' })
	@ApiParam({ name: 'id', description: 'Refund request id' })
	@ApiResponse({ status: 200, description: 'Refund declined.' })
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.PLATFORM_ADMIN, Role.ADMIN, Role.ORG_ADMIN)
	@Post('requests/:id/decline')
	decline(
		@Param('id') id: string,
		@Body() dto: ReviewRefundRequestDto,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.refundsService.decline(id, dto, req.user, req as any);
	}
}
