import { IsDateString, IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDiscountCouponStatusDto {
	@IsIn([
		'pending_influencer_signup',
		'pending_influencer_approval',
		'active',
		'declined',
		'paused',
		'expired',
		'archived',
	])
	status:
		| 'pending_influencer_signup'
		| 'pending_influencer_approval'
		| 'active'
		| 'declined'
		| 'paused'
		| 'expired'
		| 'archived';
}

export class UpdateDiscountCouponDto {
	@ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
	@IsOptional()
	@IsDateString()
	startsAt?: string;

	@ApiPropertyOptional({ example: '2026-08-31T23:59:59.000Z' })
	@IsOptional()
	@IsDateString()
	endsAt?: string;

	@ApiPropertyOptional({ example: 250 })
	@IsOptional()
	@IsNumber()
	@Min(1)
	maxUses?: number;
}
