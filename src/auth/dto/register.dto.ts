import { IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsPhoneNumber, IsString, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Oluwafemi Meduoye' })
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'femi@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @ApiPropertyOptional({ enum: ['vendor', 'organization', 'influencer'], example: 'vendor' })
  @IsOptional()
  @IsIn(['vendor', 'organization', 'influencer'])
  accountType?: 'vendor' | 'organization' | 'influencer';

  @ApiPropertyOptional({ example: 'Sweet Finger Catering' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiPropertyOptional({ example: 'femi-events' })
  @IsOptional()
  @IsString()
  organizerUsername?: string;

  @ApiPropertyOptional({ example: 'Catering' })
  @IsOptional()
  @IsString()
  businessCategory?: string;

  @ApiPropertyOptional({ example: 'Nigeria' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '100001' })
  @IsOptional()
  @IsString()
  postalCode?: string;

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

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  isActive?: boolean;
}
