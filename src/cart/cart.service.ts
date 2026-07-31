import {
	BadRequestException,
	Injectable,
	NotFoundException,
	OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { ProductEntity } from '../products/entities/product.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';
import { CheckoutCartDto } from './dto/checkout-cart.dto';
import { CartItem } from './interfaces/cart-item.interface';

type StoredCart = {
	items: CartItem[];
	updatedAt: string;
};

@Injectable()
export class CartService implements OnModuleDestroy {
	private readonly redis: Redis;
	private readonly cartTtlSeconds: number;

	constructor(
		private readonly configService: ConfigService,
		@InjectRepository(ProductEntity)
		private readonly productsRepository: Repository<ProductEntity>,
		@InjectRepository(UserEntity)
		private readonly customersRepository: Repository<UserEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		private readonly ordersService: OrdersService,
		private readonly paymentsService: PaymentsService,
	) {
		this.redis = new Redis({
			host: this.configService.get<string>('REDIS_HOST', '127.0.0.1'),
			port: this.configService.get<number>('REDIS_PORT', 6379),
			db: this.configService.get<number>('REDIS_DB', 0),
			tls:
				this.configService.get<string>('REDIS_TLS', 'false') === 'true'
					? {}
					: undefined,
			maxRetriesPerRequest: 3,
			lazyConnect: false,
		});

		this.cartTtlSeconds = Number(
			this.configService.get<string>('CART_TTL_SECONDS', '2592000'),
		);
	}

	async onModuleDestroy() {
		await this.redis.quit();
	}

	async getCart(userId: string) {
		const storedCart = await this.readCart(userId);
		return this.enrichCart(storedCart.items);
	}

	async getCartForAdmin(userId: string) {
		const storedCart = await this.readCart(userId);
		return this.enrichCart(storedCart.items);
	}

	async getAllActiveCarts() {
		const keys = await this.redis.keys('cart:user:*');
		const carts = [];

		for (const key of keys) {
			const userId = key.replace('cart:user:', '');
			const cart = await this.readCart(userId);

			if (cart.items.length > 0) {
				const enriched = await this.enrichCart(cart.items);
				carts.push({
					userId,
					updatedAt: cart.updatedAt,
					...enriched,
				});
			}
		}

		return carts;
	}

	async addItem(userId: string, dto: AddCartItemDto) {
		await this.assertProductsExist([dto.productId]);
		const cart = await this.readCart(userId);
		const items = this.normalizeItems([...cart.items, dto]);
		await this.writeCart(userId, items);
		return this.enrichCart(items);
	}

	async updateItem(userId: string, productId: string, dto: UpdateCartItemDto) {
		const cart = await this.readCart(userId);

		const updatedItems =
			dto.quantity === 0
				? cart.items.filter(
						(item) => !this.matchesCartLine(item, productId, dto.variantKey),
					)
				: cart.items.map((item) =>
						this.matchesCartLine(item, productId, dto.variantKey)
							? { ...item, quantity: dto.quantity }
							: item,
					);

		await this.writeCart(userId, this.normalizeItems(updatedItems));
		return this.enrichCart(await this.readItems(userId));
	}

	async removeItem(userId: string, productId: string, variantKey?: string) {
		const cart = await this.readCart(userId);
		const items = cart.items.filter(
			(item) => !this.matchesCartLine(item, productId, variantKey),
		);
		await this.writeCart(userId, items);
		return this.enrichCart(items);
	}

	async clearCart(userId: string) {
		await this.redis.del(this.getCartKey(userId));
		return {
			items: [],
			summary: {
				distinctItems: 0,
				itemCount: 0,
				subtotal: 0,
			},
		};
	}

	async mergeGuestCart(
		userId: string,
		dto: MergeCartDto | { items: AddCartItemDto[] },
	) {
		const guestItems = await this.filterExistingCartItems(dto.items ?? []);

		const serverItems = await this.readItems(userId);
		const mergedItems = this.normalizeItems([...serverItems, ...guestItems]);

		await this.writeCart(userId, mergedItems);
		return this.enrichCart(mergedItems);
	}

	async checkout(userId: string, dto: CheckoutCartDto = {}) {
		const prepared = await this.createCartOrder(userId, dto);
		const order = prepared.order;

		if (!order) {
			throw new BadRequestException('Unable to create order from cart');
		}

		const paymentIntent = await this.paymentsService.createIntent({
			orderId: order.id,
			idempotencyKey: 'order:' + order.id,
		});
		const authorizationUrl =
			'authorizationUrl' in paymentIntent
				? paymentIntent.authorizationUrl
				: undefined;

		await this.clearCart(userId);

		return {
			...prepared,
			message: 'Cart checked out successfully',
			paymentIntent,
			authorizationUrl,
		};
	}

	async prepareCheckout(userId: string, dto: CheckoutCartDto = {}) {
		return this.createCartOrder(userId, dto);
	}

	private async createCartOrder(userId: string, dto: CheckoutCartDto = {}) {
		let items = await this.readItems(userId);

		if (items.length === 0) {
			throw new BadRequestException('Cart is empty');
		}

		await this.assertProductsExist(items.map((item) => item.productId));
		items = await this.applyCompulsoryAddOns(userId, items);

		const subtotal = await this.calculateSubtotal(items);
		const tax = Math.round(subtotal * 0.075);
		const deliveryFee = 5000;
		const idempotencyKey = this.buildCheckoutAttemptKey(userId);

		const order = await this.ordersService.create({
			userId,
			status: dto.status ?? 'pending',
			idempotencyKey,
			tax,
			deliveryFee,
			checkoutDetails: {
				fullName: dto.fullName,
				email: dto.email,
				phone: dto.phone,
				state: dto.state,
				city: dto.city,
				postalCode: dto.postalCode,
				address: dto.address,
				consent: dto.consent ?? false,
			},
				items: items.map((item) => ({
					productId: item.productId,
					qty: item.quantity,
					variant: item.variant,
				})),
			});

		if (!order) {
			throw new BadRequestException('Unable to create order from cart');
		}

		return {
			message: 'Checkout order prepared',
			order,
			pricing: {
				subtotal: Number((order as any).total ?? subtotal) - tax - deliveryFee,
				tax: Number((order as any).tax ?? tax),
				deliveryFee: Number((order as any).deliveryFee ?? deliveryFee),
				total: Number((order as any).total ?? subtotal + tax + deliveryFee),
			},
			idempotencyKey,
		};
	}

	private buildCheckoutAttemptKey(userId: string) {
		return `cart-checkout:${userId}:${randomUUID()}`;
	}

	private async calculateSubtotal(items: CartItem[]) {
		const productIds = [...new Set(items.map((item) => item.productId))];
		const products = await this.productsRepository.findBy({
			id: In(productIds),
		});
		const productMap = new Map(
			products.map((product) => [product.id, product]),
		);

		return items.reduce((sum, item) => {
			const product = productMap.get(item.productId);
			return sum + Number(product?.price ?? 0) * item.quantity;
		}, 0);
	}

	private async applyCompulsoryAddOns(userId: string, items: CartItem[]) {
		const productIds = [...new Set(items.map((item) => item.productId))];
		const products = await this.productsRepository.findBy({ id: In(productIds) });
		const existingIds = new Set(items.map((item) => item.productId));
		const compulsoryItems = products.flatMap((product) =>
			(product.addOns || [])
				.filter((addOn) => addOn.isCompulsory && !existingIds.has(addOn.productId))
				.map((addOn) => ({
					productId: addOn.productId,
					quantity: 1,
					type: 'accessory' as const,
				})),
		);

		if (compulsoryItems.length === 0) {
			return items;
		}

		await this.assertProductsExist(compulsoryItems.map((item) => item.productId));
		const normalizedItems = this.normalizeItems([...items, ...compulsoryItems]);
		await this.writeCart(userId, normalizedItems);
		return normalizedItems;
	}

	private async resolveCustomerId(userId: string, customerId?: string) {
		if (customerId) {
			const customer = await this.customersRepository.findOne({
				where: { id: customerId },
			});
			if (!customer) {
				throw new NotFoundException('Customer not found');
			}
			return customer.id;
		}

		const user = await this.usersRepository.findOne({ where: { id: userId } });
		if (!user) {
			throw new NotFoundException('User not found');
		}

		const customer = await this.customersRepository.findOne({
			where: { email: user.email.toLowerCase().trim() },
		});

		if (!customer) {
			throw new BadRequestException(
				'No customer profile is linked to this account. Provide customerId during checkout or create a matching customer profile.',
			);
		}

		return customer.id;
	}

	private async assertProductsExist(productIds: string[]) {
		const uniqueProductIds = [...new Set(productIds)];

		if (uniqueProductIds.length === 0) {
			return;
		}

		const products = await this.productsRepository.findBy({
			id: In(uniqueProductIds),
		});

		const foundIds = new Set(products.map((product) => product.id));
		const missingIds = uniqueProductIds.filter((id) => !foundIds.has(id));

		if (missingIds.length > 0) {
			throw new NotFoundException(
				'Products not found: ' + missingIds.join(', '),
			);
		}
	}

	private async filterExistingCartItems<T extends CartItem>(items: T[]) {
		const uniqueProductIds = [...new Set(items.map((item) => item.productId))];

		if (uniqueProductIds.length === 0) {
			return items;
		}

		const products = await this.productsRepository.find({
			where: { id: In(uniqueProductIds) },
			select: { id: true },
		});
		const foundIds = new Set(products.map((product) => product.id));
		return items.filter((item) => foundIds.has(item.productId));
	}

	private async readItems(userId: string) {
		const cart = await this.readCart(userId);
		return cart.items;
	}

	private async readCart(userId: string): Promise<StoredCart> {
		const raw = await this.redis.get(this.getCartKey(userId));

		if (!raw) {
			return { items: [], updatedAt: new Date().toISOString() };
		}

		try {
			const parsed = JSON.parse(raw) as StoredCart;
			return {
				items: Array.isArray(parsed.items) ? parsed.items : [],
				updatedAt: parsed.updatedAt ?? new Date().toISOString(),
			};
		} catch {
			return { items: [], updatedAt: new Date().toISOString() };
		}
	}

	private async writeCart(userId: string, items: CartItem[]) {
		const payload: StoredCart = {
			items,
			updatedAt: new Date().toISOString(),
		};

		await this.redis.set(
			this.getCartKey(userId),
			JSON.stringify(payload),
			'EX',
			this.cartTtlSeconds,
		);
	}

	private getCartKey(userId: string) {
		return 'cart:user:' + userId;
	}

	private normalizeItems(items: CartItem[]) {
		const merged = new Map<string, CartItem>();

		items
			.filter((item) => item.quantity > 0)
				.forEach((item) => {
					const key =
						item.productId +
						'::' +
						(item.installedProductId ?? '') +
						'::' +
						(item.variant?.id ?? item.variant?.label ?? '');
				const existing = merged.get(key);

				if (!existing) {
					merged.set(key, {
						productId: item.productId,
							quantity: item.quantity,
							installedProductId: item.installedProductId,
							type: item.type,
							variant: item.variant,
						});
					return;
				}

				merged.set(key, {
					...existing,
					quantity: existing.quantity + item.quantity,
				});
			});

		return Array.from(merged.values());
	}

	private cartVariantKey(item: CartItem) {
		return item.variant?.id ?? item.variant?.label ?? '';
	}

	private matchesCartLine(
		item: CartItem,
		productId: string,
		variantKey?: string,
	) {
		if (item.productId !== productId) return false;
		if (variantKey === undefined) return true;
		return this.cartVariantKey(item) === variantKey;
	}

	private async enrichCart(items: CartItem[]) {
		const productIds = [...new Set(items.map((item) => item.productId))];
		const products =
			productIds.length > 0
				? await this.productsRepository.find({
						where: { id: In(productIds) },
						relations: ['mainImage', 'bannerImage', 'galleryImages'],
					})
				: [];
		const productMap = new Map(
			products.map((product) => [product.id, product]),
		);
		const addOnIds = [
			...new Set(
				products.flatMap((product) =>
					(product.addOns || []).map((addOn) => addOn.productId),
				),
			),
		];
		const addOnProducts =
			addOnIds.length > 0
				? await this.productsRepository.find({
						where: { id: In(addOnIds) },
						relations: ['mainImage', 'bannerImage', 'galleryImages'],
					})
				: [];
		const addOnProductMap = new Map(
			addOnProducts.map((product) => [product.id, product]),
		);

		const enrichedItems = items.map((item) => {
			const product = productMap.get(item.productId);
			return {
				...item,
				id: item.productId,
				productId: item.productId,
				productName: product?.name ?? 'Unknown product',
				name: product?.name ?? 'Unknown product',
					slug: product?.slug,
					shortDescription: product?.shortDescription,
					variant: item.variant,
					image:
						item.variant?.imageUrl ||
						product?.mainImage?.url ||
					product?.bannerImage?.url ||
					product?.galleryImages?.[0]?.url ||
					undefined,
				addOns: (product?.addOns || [])
					.map((addOn) => {
						const addOnProduct = addOnProductMap.get(addOn.productId);
						if (!addOnProduct) return null;
						return {
							productId: addOn.productId,
							isCompulsory: addOn.isCompulsory ?? false,
							name: addOnProduct.name,
							price: Number(addOnProduct.price ?? 0),
							shortDescription: addOnProduct.shortDescription,
							image:
								addOnProduct.mainImage?.url ||
								addOnProduct.bannerImage?.url ||
								addOnProduct.galleryImages?.[0]?.url ||
								undefined,
						};
					})
					.filter(Boolean),
				unitPrice: Number(product?.price ?? 0),
				price: Number(product?.price ?? 0),
				lineTotal: Number(product?.price ?? 0) * item.quantity,
			};
		});

		return {
			items: enrichedItems,
			summary: {
				distinctItems: enrichedItems.length,
				itemCount: enrichedItems.reduce((sum, item) => sum + item.quantity, 0),
				subtotal: enrichedItems.reduce((sum, item) => sum + item.lineTotal, 0),
			},
		};
	}
}
