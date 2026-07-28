import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateServiceTypeDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  basePrice: number;

  @IsIn(['fixed', 'quote', 'warranty', 'free'])
  billingMode: string;

  @IsOptional()
  @IsBoolean()
  requiresTechnician?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedDurationMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
