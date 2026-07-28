import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateServiceBookingDto {
  @IsString()
  customerId: string;

  @IsString()
  preferredDate: string;

  @IsString()
  issue: string;

  @IsString()
  serviceTypeId: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  technicianId?: string;

  @IsOptional()
  @IsString()
  paidItemId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  overridePrice?: number;
}
