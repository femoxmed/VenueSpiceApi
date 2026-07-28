import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBlogDto {
	@IsString()
	@MinLength(3)
	@MaxLength(180)
	title: string;

	@IsOptional()
	@IsString()
	slug?: string;

	@IsString()
	@MinLength(10)
	excerpt: string;

	@IsString()
	@MinLength(20)
	content: string;

	@IsOptional()
	@IsString()
	category?: string;

	@IsOptional()
	@IsIn(['draft', 'published', 'archived'])
	status?: 'draft' | 'published' | 'archived';

	@IsOptional()
	@IsString()
	publishedAt?: string | null;

	@IsOptional()
	@IsString()
	featuredAt?: string | null;

	@IsOptional()
	@IsArray()
	relatedProductIds?: string[];
}
