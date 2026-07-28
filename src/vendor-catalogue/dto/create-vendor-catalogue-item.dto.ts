import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVendorCatalogueItemDto {
	@ApiProperty({ example: 'Puff Pastry Fruit Tart' })
	@IsString()
	name: string;

	@ApiPropertyOptional({ example: 'https://example.com/catalogue/pastry.jpg' })
	@IsOptional()
	@IsUrl({ require_protocol: true })
	imageUrl?: string;

	@ApiProperty({ example: 2.5, description: 'Fixed price, or minimum price when priceType is range.' })
	@IsNumber()
	@Min(0)
	@Type(() => Number)
	price: number;

	@ApiPropertyOptional({ enum: ['fixed', 'range'], default: 'fixed' })
	@IsOptional()
	@IsIn(['fixed', 'range'])
	priceType?: 'fixed' | 'range';

	@ApiPropertyOptional({ example: 2.5, description: 'Required when priceType is range.' })
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Type(() => Number)
	minPrice?: number;

	@ApiPropertyOptional({ example: 5, description: 'Required when priceType is range.' })
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Type(() => Number)
	maxPrice?: number;

	@ApiProperty({ enum: ['Per Serve', 'Per Unit', 'Per Hour', 'Per Day', 'Per Event', 'Per Guest'], example: 'Per Serve' })
	@IsString()
	@IsIn(['Per Serve', 'Per Unit', 'Per Hour', 'Per Day', 'Per Event', 'Per Guest'])
	unitMeasure: string;

	@ApiPropertyOptional({ example: 100, default: 1 })
	@IsOptional()
	@IsInt()
	@Min(1)
	@Type(() => Number)
	minimumOrderQuantity?: number;

	@ApiPropertyOptional({ example: 'Freshly baked pastry tray for breakfast events and receptions.' })
	@IsOptional()
	@IsString()
	description?: string;
}
