import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OrderEntity } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { InvoiceEntity } from '../invoices/entities/invoice.entity';
import { InvoiceItemEntity } from '../invoices/entities/invoice-item.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { UserEntity } from '../auth/entities/user.entity';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class OrdersService {
	constructor(
		@InjectRepository(OrderEntity)
		private readonly ordersRepository: Repository<OrderEntity>,
		@InjectRepository(OrderItemEntity)
		private readonly orderItemsRepository: Repository<OrderItemEntity>,
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(ProductEntity)
		private readonly productsRepository: Repository<ProductEntity>,
		@InjectRepository(InvoiceEntity)
		private readonly invoicesRepository: Repository<InvoiceEntity>,
		@InjectRepository(InvoiceItemEntity)
		private readonly invoiceItemsRepository: Repository<InvoiceItemEntity>,
		private readonly notificationsService: NotificationsService,
	) {}

	async findAll() {
		const orders = await this.ordersRepository.find({
			relations: { items: { product: true }, user: true },
			order: { createdAt: 'DESC' },
		});
		return orders.map((order) => this.serializeOrder(order));
	}

	async findByUser(userId: string) {
		const orders = await this.ordersRepository.find({
			where: { user: { id: userId } },
			relations: { items: { product: true }, user: true },
			order: { createdAt: 'DESC' },
		});
		return orders.map((order) => this.serializeOrder(order));
	}

	async findPurchasedDevices(userId: string) {
		const paidOrders = await this.ordersRepository.find({
			where: { user: { id: userId }, status: 'paid' },
			relations: { items: { product: true }, user: true },
			order: { createdAt: 'DESC' },
		});

		return paidOrders.flatMap((order) =>
			(order.items || []).flatMap((item) =>
				Array.from({ length: Math.max(1, Number(item.qty ?? 1)) }, (_, index) => ({
					id: item.qty > 1 ? `${item.id}:${index + 1}` : item.id,
					orderItemId: item.id,
					orderId: order.id,
					productId: item.product?.id,
					orderDate: order.createdAt,
					paidAt: order.createdAt,
					qty: 1,
					unitPrice: Number(item.unitPrice ?? 0),
					totalPaid: Number(item.unitPrice ?? 0),
					variant: item.variant ?? this.defaultProductVariant(item.product),
					deliveredAt: item.deliveredAt ?? null,
					activatedAt: item.activatedAt ?? null,
					installedAt: item.installedAt ?? null,
					installerName: item.installerName ?? null,
					warrantyMonths: item.warrantyMonths ?? 12,
					warrantyExpiresAt:
						item.warrantyExpiresAt ??
						this.addMonths(
							item.installedAt ?? item.activatedAt ?? order.createdAt,
							item.warrantyMonths ?? 12,
						),
					maintenanceRequired: item.maintenanceRequired ?? false,
					maintenanceStatus: item.maintenanceStatus ?? 'not_required',
					nextMaintenanceDate:
						item.nextMaintenanceDate ??
						this.addMonths(item.installedAt ?? item.activatedAt ?? order.createdAt, 12),
					deviceSerial:
						item.deviceSerial ??
						`AQZ-${item.id.replace(/-/g, '').slice(0, 10).toUpperCase()}-${index + 1}`,
					product: item.product,
				})),
			),
		);
	}

	async findItemsForOrder(orderId: string, userId: string, role?: Role) {
		const order = await this.ordersRepository.findOne({
			where: { id: orderId },
			relations: { user: true },
		});

		if (!order) {
			throw new NotFoundException('Order not found');
		}

		const isAdmin = role === Role.SUPER_ADMIN || role === Role.ADMIN;
		if (!isAdmin && order.user.id !== userId) {
			throw new ForbiddenException('You do not have access to this order');
		}

		const items = await this.orderItemsRepository.find({
			where: { order: { id: orderId } },
			relations: { product: true },
			order: { id: 'ASC' },
		});

		return items.map((item) => this.serializeOrderItem(item, orderId));
	}

	async updateOrderItemDetails(
		itemId: string,
		dto: Partial<{
			deliveredAt: string | null;
			activatedAt: string | null;
			installedAt: string | null;
			installerName: string | null;
			warrantyMonths: number;
			warrantyExpiresAt: string | null;
			maintenanceRequired: boolean;
			maintenanceStatus: string;
			nextMaintenanceDate: string | null;
			deviceSerial: string | null;
		}>,
	) {
		const item = await this.orderItemsRepository.findOne({
			where: { id: itemId },
			relations: { product: true, order: true },
		});

		if (!item) {
			throw new NotFoundException('Order item not found');
		}

		Object.assign(item, {
			deliveredAt: dto.deliveredAt ?? item.deliveredAt,
			activatedAt: dto.activatedAt ?? item.activatedAt,
			installedAt: dto.installedAt ?? item.installedAt,
			installerName: dto.installerName ?? item.installerName,
			warrantyMonths: dto.warrantyMonths ?? item.warrantyMonths ?? 12,
			warrantyExpiresAt: dto.warrantyExpiresAt ?? item.warrantyExpiresAt,
			maintenanceRequired:
				dto.maintenanceRequired ?? item.maintenanceRequired ?? false,
			maintenanceStatus:
				dto.maintenanceStatus ?? item.maintenanceStatus ?? 'not_required',
			nextMaintenanceDate: dto.nextMaintenanceDate ?? item.nextMaintenanceDate,
			deviceSerial: dto.deviceSerial ?? item.deviceSerial,
		});

		if (!item.warrantyExpiresAt) {
			item.warrantyExpiresAt = this.addMonths(
				item.installedAt ?? item.activatedAt ?? item.order?.createdAt,
				item.warrantyMonths ?? 12,
			);
		}

		if (!item.nextMaintenanceDate) {
			item.nextMaintenanceDate = this.addMonths(
				item.installedAt ?? item.activatedAt ?? item.order?.createdAt,
				12,
			);
		}

		return this.orderItemsRepository.save(item);
	}

	async findOneForUser(orderId: string, userId: string, role?: Role) {
		const order = await this.ordersRepository.findOne({
			where: { id: orderId },
			relations: { items: { product: true }, user: true },
		});

		if (!order) {
			throw new NotFoundException('Order not found');
		}

		const isAdmin = role === Role.SUPER_ADMIN || role === Role.ADMIN;
		if (!isAdmin && order.user.id !== userId) {
			throw new ForbiddenException('You do not have access to this order');
		}

		return this.serializeOrder(order);
	}

	async create(dto: CreateOrderDto) {
		if (dto.idempotencyKey) {
			const existingOrder = await this.ordersRepository.findOne({
				where: { idempotencyKey: dto.idempotencyKey },
				relations: { items: { product: true }, user: true },
			});

			if (existingOrder) {
				return this.serializeOrder(existingOrder);
			}
		}

		const user = await this.usersRepository.findOne({
			where: { id: dto.userId },
		});

		if (!user) {
			throw new NotFoundException('User not found');
		}

		const products = await this.productsRepository.findBy({
			id: In(dto.items.map((item) => item.productId)),
		});
		const productMap = new Map(
			products.map((product) => [product.id, product]),
		);

		const items = dto.items.flatMap((item) => {
			const product = productMap.get(item.productId);
			if (!product) {
				throw new NotFoundException('Product ' + item.productId + ' not found');
			}
			return Array.from({ length: item.qty }, () =>
				this.orderItemsRepository.create({
					product,
					qty: 1,
					unitPrice: Number(product.price),
					variant: item.variant ?? null,
					deliveredAt: item.deliveredAt ?? null,
					activatedAt: item.activatedAt ?? null,
					installedAt: item.installedAt ?? null,
					installerName: item.installerName ?? null,
					warrantyMonths: item.warrantyMonths ?? 12,
					warrantyExpiresAt: item.warrantyExpiresAt ?? null,
					maintenanceRequired: item.maintenanceRequired ?? false,
					maintenanceStatus: item.maintenanceStatus ?? 'not_required',
					nextMaintenanceDate: item.nextMaintenanceDate ?? null,
				}),
			);
		});

		const subtotal = items.reduce(
			(sum, item) => sum + Number(item.unitPrice) * item.qty,
			0,
		);
		const tax = Number(dto.tax ?? 0);
		const deliveryFee = Number(dto.deliveryFee ?? 0);
		const total = subtotal + tax + deliveryFee;

		const savedOrder = await this.ordersRepository.save(
			this.ordersRepository.create({
				user,
				status: dto.status,
				idempotencyKey: dto.idempotencyKey ?? null,
				total,
				tax,
				deliveryFee,
				checkoutDetails: dto.checkoutDetails ?? null,
				items,
			}),
		);

		const savedInvoice = await this.invoicesRepository.save(
			this.invoicesRepository.create({
				invoiceNumber: this.buildInvoiceNumber(),
				user,
				order: savedOrder,
				status: 'pending',
				subtotal,
				tax: tax + deliveryFee,
				total,
				issuedAt: new Date(),
				items: items.map((item) =>
					this.invoiceItemsRepository.create({
						description: item.product.name,
						qty: item.qty,
						unitPrice: item.unitPrice,
						lineTotal: Number(item.unitPrice) * item.qty,
					}),
				),
			}),
		);

		await this.notificationsService.queueEmail(
			user.email,
			'Aquzera order confirmation',
			this.notificationsService.buildOrderCreatedEmail(
				user.fullName,
				savedOrder.id,
				savedInvoice.invoiceNumber,
				total,
			),
		);

		const order = await this.ordersRepository.findOne({
			where: { id: savedOrder.id },
			relations: { items: { product: true }, user: true },
		});

		return order ? this.serializeOrder(order) : order;
	}

	private serializeOrder(order: OrderEntity) {
		return {
			...order,
			items: (order.items || []).map((item) =>
				this.serializeOrderItem(item, order.id),
			),
		};
	}

	private serializeOrderItem(item: OrderItemEntity, orderId: string) {
		return {
			...item,
			orderId,
			productId: item.product?.id,
			variant: item.variant ?? this.defaultProductVariant(item.product),
		};
	}

	private defaultProductVariant(product?: ProductEntity | null) {
		const color = product?.colors?.find(
			(color) => color?.id || color?.label || color?.value || color?.image?.url || color?.imageUrl,
		);

		if (!color) return null;

		return {
			id: color.id,
			label: color.label,
			value: color.value,
			imageUrl: color.image?.url || color.imageUrl,
		};
	}

	private addMonths(value: string | Date | undefined | null, months: number) {
		if (!value) return null;
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return null;
		date.setMonth(date.getMonth() + months);
		return date.toISOString().slice(0, 10);
	}

	private buildInvoiceNumber() {
		return 'AQZ-INV-' + Date.now();
	}
}
