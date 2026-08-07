import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePlatformSettingsDto {
	@IsOptional()
	@IsNumber()
	@Min(0)
	venueSpiceFeePercent?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	venueSpiceFeeFixed?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	paymentProcessingFeePercent?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	paymentProcessingFeeFixed?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	organizerPayoutHoldDays?: number;

	@IsOptional()
	@IsIn(['buyer', 'organizer'])
	defaultFeePayer?: 'buyer' | 'organizer';

	@IsOptional()
	@IsBoolean()
	stripeAutomaticTaxEnabled?: boolean;

	@IsOptional()
	@IsString()
	stripeTaxCode?: string;

	@IsOptional()
	@IsIn(['exclusive', 'inclusive', 'unspecified'])
	stripeTaxBehavior?: 'exclusive' | 'inclusive' | 'unspecified';
}
