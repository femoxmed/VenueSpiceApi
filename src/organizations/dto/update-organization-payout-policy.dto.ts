import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateOrganizationPayoutPolicyDto {
	@IsIn(['platform_default', 'after_payment', 'after_event'])
	payoutPolicy: 'platform_default' | 'after_payment' | 'after_event';

	@IsInt()
	@Min(0)
	@Max(365)
	payoutDelayDays: number;

	@IsDateString()
	startsAt: string;

	@IsDateString()
	endsAt: string;

	@IsOptional()
	@IsString()
	reason?: string;

	@IsBoolean()
	refundRiskAccepted: boolean;

	@IsOptional()
	@IsBoolean()
	notifyOrganizer?: boolean;
}
