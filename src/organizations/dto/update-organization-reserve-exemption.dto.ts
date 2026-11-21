import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationReserveExemptionDto {
	@IsBoolean()
	exempt: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	reason?: string;
}
