import { IsOptional, IsString } from 'class-validator';

export class VerifyPaymentIntentDto {
  @IsOptional()
  @IsString()
  reference?: string;
}
