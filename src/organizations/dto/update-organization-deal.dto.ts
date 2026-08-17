import { IsBoolean, IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateOrganizationDealDto {
	@IsNumber()
	@Min(0)
	venueSpiceFeePercent: number;

	@IsNumber()
	@Min(0)
	venueSpiceFeeFixed: number;

	@IsDateString()
	startsAt: string;

	@IsDateString()
	endsAt: string;

	@IsOptional()
	@IsBoolean()
	notifyOrganizer?: boolean;
}
