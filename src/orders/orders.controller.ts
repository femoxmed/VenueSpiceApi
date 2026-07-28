import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  findAll() {
    return this.ordersService.findAll();
  }

  @Get('me/history')
  findMine(@Req() req: { user: { id: string } }) {
    return this.ordersService.findByUser(req.user.id);
  }

  @Get('me/devices')
  findMyDevices(@Req() req: { user: { id: string } }) {
    return this.ordersService.findPurchasedDevices(req.user.id);
  }

  @Get(':orderId/items')
  findOrderItems(
    @Param('orderId') orderId: string,
    @Req() req: { user: { id: string; role?: Role } },
  ) {
    return this.ordersService.findItemsForOrder(orderId, req.user.id, req.user.role);
  }

  @Get(':orderId')
  findOne(
    @Param('orderId') orderId: string,
    @Req() req: { user: { id: string; role?: Role } },
  ) {
    return this.ordersService.findOneForUser(orderId, req.user.id, req.user.role);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @UseGuards(RolesGuard)
  @Patch('items/:itemId')
  updateOrderItemDetails(
    @Param('itemId') itemId: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.ordersService.updateOrderItemDetails(itemId, dto as any);
  }
}
