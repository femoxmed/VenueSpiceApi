import { IsOptional, IsString } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
