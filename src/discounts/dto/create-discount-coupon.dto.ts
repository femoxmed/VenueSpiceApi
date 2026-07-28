import { IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateDiscountCouponDto {
	@IsString()
	organizationId: string;

	@IsOptional()
	@IsString()
	eventId?: string;

	@IsOptional()
	@IsString()
	agentId?: string;

	@IsEmail()
	influencerEmail: string;

	@IsOptional()
	@IsString()
	influencerName?: string;

	@IsString()
	code: string;

	@IsIn(['percentage', 'fixed'])
	type: 'percentage' | 'fixed';

	@IsNumber()
	@Min(0)
	value: number;

	@IsNumber()
	@Min(0)
	@Max(100)
	influencerCommissionPercent: number;

	@IsOptional()
	@IsDateString()
	startsAt?: string;

	@IsOptional()
	@IsDateString()
	endsAt?: string;

	@IsOptional()
	@IsNumber()
	@Min(1)
	maxUses?: number;
}
