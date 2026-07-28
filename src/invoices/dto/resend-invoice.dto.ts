import { IsEmail, IsOptional } from 'class-validator';

export class ResendInvoiceDto {
  @IsOptional()
  @IsEmail()
  email?: string;
}
