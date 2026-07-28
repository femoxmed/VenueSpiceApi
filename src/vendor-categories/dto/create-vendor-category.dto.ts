import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVendorCategoryDto {
	@ApiProperty({ example: 'Catering' })
	@IsString()
	label: string;

	@ApiPropertyOptional({ example: 'catering', description: 'Optional URL/search slug. Generated from label when omitted.' })
	@IsOptional()
	@IsString()
	slug?: string;

	@ApiPropertyOptional({ example: ['food', 'chef', 'caterer'], type: [String] })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	searchTerms?: string[];

	@ApiPropertyOptional({ example: 'catering', description: 'Frontend icon key for this vendor category.' })
	@IsOptional()
	@IsString()
	iconKey?: string;

	@ApiPropertyOptional({ example: 10, default: 0 })
	@IsOptional()
	@IsInt()
	@Min(0)
	sortOrder?: number;

	@ApiPropertyOptional({ example: true, default: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean;
}
