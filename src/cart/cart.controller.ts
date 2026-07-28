import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';
import { CheckoutCartDto } from './dto/checkout-cart.dto';

type AuthenticatedRequest = {
	user: {
		id: string;
	};
};

@ApiTags('Cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
	constructor(private readonly cartService: CartService) {}

	@Get()
	getCart(@Req() req: AuthenticatedRequest) {
		return this.cartService.getCart(req.user.id);
	}

	@Post('items')
	addItem(@Req() req: AuthenticatedRequest, @Body() dto: AddCartItemDto) {
		return this.cartService.addItem(req.user.id, dto);
	}

	@Patch('items/:productId')
	updateItem(
		@Req() req: AuthenticatedRequest,
		@Param('productId') productId: string,
		@Body() dto: UpdateCartItemDto,
	) {
		return this.cartService.updateItem(req.user.id, productId, dto);
	}

	@Delete('items/:productId')
	removeItem(
		@Req() req: AuthenticatedRequest,
		@Param('productId') productId: string,
		@Query('variantKey') variantKey?: string,
	) {
		return this.cartService.removeItem(req.user.id, productId, variantKey);
	}

	@Delete()
	clearCart(@Req() req: AuthenticatedRequest) {
		return this.cartService.clearCart(req.user.id);
	}

	@Post('merge')
	mergeCart(@Req() req: AuthenticatedRequest, @Body() dto: MergeCartDto) {
		return this.cartService.mergeGuestCart(req.user.id, dto);
	}

	@Post('checkout')
	checkout(@Req() req: AuthenticatedRequest, @Body() dto: CheckoutCartDto) {
		return this.cartService.checkout(req.user.id, dto);
	}

	@Post('checkout/prepare')
	prepareCheckout(@Req() req: AuthenticatedRequest, @Body() dto: CheckoutCartDto) {
		return this.cartService.prepareCheckout(req.user.id, dto);
	}

	@Roles(Role.SUPER_ADMIN)
	@UseGuards(RolesGuard)
	@Get('admin/all')
	getAllActiveCarts() {
		return this.cartService.getAllActiveCarts();
	}

	@Roles(Role.SUPER_ADMIN)
	@UseGuards(RolesGuard)
	@Get('admin/user/:userId')
	getCartForAdmin(@Param('userId') userId: string) {
		return this.cartService.getCartForAdmin(userId);
	}
}
