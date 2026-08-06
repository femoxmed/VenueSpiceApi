import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsPhoneNumber, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
	@ApiProperty({ example: 'Sweet Finger Catering' })
	@IsString()
	name: string;

	@ApiPropertyOptional({ example: 'sweet-finger-catering' })
	@IsOptional()
	@IsString()
	slug?: string;

	@ApiPropertyOptional({ example: 'sweetfingers' })
	@IsOptional()
	@IsString()
	organizerUsername?: string;

	@ApiPropertyOptional({ enum: ['vendor', 'organization', 'influencer'], example: 'vendor' })
	@IsOptional()
	@IsIn(['vendor', 'organization', 'influencer'])
	type?: 'vendor' | 'organization' | 'influencer';

	@ApiPropertyOptional({ example: '6d79a82f-43ef-4b78-8d7f-e5eaa7a815ce' })
	@IsOptional()
	@IsUUID()
	ownerUserId?: string;

	@ApiPropertyOptional({ example: 'hello@sweetfinger.com' })
	@IsOptional()
	@IsEmail()
	contactEmail?: string;

	@ApiPropertyOptional({ example: '+2348012345678' })
	@IsOptional()
	@IsPhoneNumber()
	contactPhone?: string;

	@ApiPropertyOptional({ example: 'Catering' })
	@IsOptional()
	@IsString()
	businessCategory?: string;

	@ApiPropertyOptional({ example: 'https://example.com/logo.png' })
	@IsOptional()
	@IsString()
	logoUrl?: string;

	@ApiPropertyOptional({ example: 'https://sweetfinger.com' })
	@IsOptional()
	@IsString()
	website?: string;

	@ApiPropertyOptional({ example: 'Nigeria' })
	@IsOptional()
	@IsString()
	country?: string;

	@ApiPropertyOptional({ example: '100001' })
	@IsOptional()
	@IsString()
	postalCode?: string;

	@ApiPropertyOptional({ example: 'Lagos' })
	@IsOptional()
	@IsString()
	stateProvince?: string;

	@ApiPropertyOptional({ example: 'Sweet Finger Catering LLC' })
	@IsOptional()
	@IsString()
	legalBusinessName?: string;

	@ApiPropertyOptional({ example: 'Founder' })
	@IsOptional()
	@IsString()
	businessRole?: string;

	@ApiPropertyOptional({ example: 'business@sweetfinger.com' })
	@IsOptional()
	@IsEmail()
	businessEmail?: string;

	@ApiPropertyOptional({ example: '+2348012345678' })
	@IsOptional()
	@IsPhoneNumber()
	businessPhone?: string;

	@ApiPropertyOptional({ example: true })
	@IsOptional()
	@IsBoolean()
	einRegistered?: boolean;

	@ApiPropertyOptional({ example: '12-3456789' })
	@IsOptional()
	@IsString()
	einRegistrationNumber?: string;

	@ApiPropertyOptional({ type: [String], example: ['https://example.com/cover-1.jpg', 'https://example.com/cover-2.jpg'] })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	coverImageUrls?: string[];

	@ApiPropertyOptional({ example: true })
	@IsOptional()
	@IsBoolean()
	termsAccepted?: boolean;

	@ApiPropertyOptional({ example: 'Instagram' })
	@IsOptional()
	@IsString()
	influencerPlatform?: string;

	@ApiPropertyOptional({ example: '@eventbox_creator' })
	@IsOptional()
	@IsString()
	influencerHandle?: string;

	@ApiPropertyOptional({ example: 'https://instagram.com/eventbox_creator' })
	@IsOptional()
	@IsString()
	influencerProfileUrl?: string;

	@ApiPropertyOptional({ example: 'Events and lifestyle' })
	@IsOptional()
	@IsString()
	influencerNiche?: string;

	@ApiPropertyOptional({ example: 25000 })
	@IsOptional()
	@IsInt()
	@Min(0)
	influencerAudienceSize?: number;

	@ApiPropertyOptional({ example: 3.5 })
	@IsOptional()
	@IsNumber()
	@Min(0)
	influencerEngagementRate?: number;

	@ApiPropertyOptional({ example: 'Premium catering and event food service for private and corporate events.' })
	@IsOptional()
	@IsString()
	description?: string;
}
