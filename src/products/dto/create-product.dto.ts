import {
	IsArray,
	IsBoolean,
	IsDateString,
	IsIn,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	Min,
	ValidateNested,
} from 'class-validator';
import { Transform, Type, plainToInstance } from 'class-transformer';

function parseJsonArray<T>(value: unknown, dto: new () => T) {
	const parsedValue =
		typeof value === 'string'
			? value.trim()
				? JSON.parse(value)
				: []
			: value;

	return Array.isArray(parsedValue)
		? plainToInstance(dto, parsedValue)
		: parsedValue;
}

export class ProductColorVariationDto {
	@IsString()
	id: string;

	@IsString()
	label: string;

	@IsString()
	value: string;

	@IsOptional()
	image?: any;

	@IsOptional()
	@IsString()
	imageUrl?: string;
}

export class ProductFeatureDto {
	@IsString()
	title: string;

	@IsOptional()
	@IsString()
	titleLine2?: string;

	@IsString()
	description: string;

	@IsOptional()
	@IsString()
	imageUrl?: string;

	@IsOptional()
	image?: any;

	@IsOptional()
	@IsString()
	imageAlt?: string;

	@IsOptional()
	@IsString()
	imageClassName?: string;
}

export class ProductSpecificationDto {
	@IsString()
	label: string;

	@IsString()
	value: string;
}

export class ProductBoxItemDto {
	@IsString()
	title: string;

	@IsOptional()
	@IsString()
	imageUrl?: string;

	@IsOptional()
	image?: any;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsString()
	imageAlt?: string;
}

export class ProductAddOnDto {
	@IsString()
	productId: string;

	@IsOptional()
	@IsBoolean()
	@Type(() => Boolean)
	isCompulsory?: boolean;
}

export class CreateProductDto {
	@IsString()
	name: string;

	@IsOptional()
	@IsString()
	slug?: string;

	@IsString()
	sku: string;

	@IsNumber()
	@Min(0)
	@Type(() => Number)
	price: number;

	@IsInt()
	@Min(0)
	@Type(() => Number)
	stock: number;

	@IsOptional()
	@IsString()
	shortDescription?: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsString()
	startingPriceLabel?: string;

	@IsOptional()
	@Transform(({ value }) => parseJsonArray(value, ProductColorVariationDto))
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductColorVariationDto)
	colors?: ProductColorVariationDto[];

	@IsOptional()
	@Transform(({ value }) => parseJsonArray(value, ProductFeatureDto))
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductFeatureDto)
	features?: ProductFeatureDto[];

	@IsOptional()
	@Transform(({ value }) => parseJsonArray(value, ProductSpecificationDto))
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductSpecificationDto)
	specifications?: ProductSpecificationDto[];

	@IsOptional()
	@Transform(({ value }) => parseJsonArray(value, ProductBoxItemDto))
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductBoxItemDto)
	boxItems?: ProductBoxItemDto[];

	@IsOptional()
	@Transform(({ value }) => parseJsonArray(value, ProductAddOnDto))
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductAddOnDto)
	addOns?: ProductAddOnDto[];

	@IsOptional()
	@IsIn(['draft', 'active', 'archived'])
	status?: 'draft' | 'active' | 'archived';

	@IsOptional()
	@Transform(({ value }) => (value === '' ? null : value))
	@IsDateString()
	featuredAt?: string | null;

	@IsOptional()
	@IsInt()
	@Type(() => Number)
	sortOrder?: number;

	@IsOptional()
	bannerImage?: any;

	@IsOptional()
	mainImage?: any;

	@IsOptional()
	galleryImages?: any[];
}
