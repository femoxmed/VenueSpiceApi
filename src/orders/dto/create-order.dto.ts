import {
	IsArray,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	Min,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreateOrderItemDto {
	@IsString()
	productId: string;

	@IsInt()
	@Min(1)
	qty: number;

	@IsOptional()
	variant?: {
		id?: string;
		label?: string;
		value?: string;
		imageUrl?: string;
	};

	@IsOptional()
	@IsString()
	deliveredAt?: string;

	@IsOptional()
	@IsString()
	activatedAt?: string;

	@IsOptional()
	@IsString()
	installedAt?: string;

	@IsOptional()
	@IsString()
	installerName?: string;

	@IsOptional()
	@IsInt()
	@Min(1)
	warrantyMonths?: number;

	@IsOptional()
	@IsString()
	warrantyExpiresAt?: string;

	@IsOptional()
	maintenanceRequired?: boolean;

	@IsOptional()
	@IsString()
	maintenanceStatus?: string;

	@IsOptional()
	@IsString()
	nextMaintenanceDate?: string;
}

export class CreateOrderDto {
	@IsString()
	userId: string;

	@IsString()
	status: string;

	@IsOptional()
	@IsString()
	idempotencyKey?: string;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	tax?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	deliveryFee?: number;

	@IsOptional()
	checkoutDetails?: Record<string, unknown>;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateOrderItemDto)
	items: CreateOrderItemDto[];
}
