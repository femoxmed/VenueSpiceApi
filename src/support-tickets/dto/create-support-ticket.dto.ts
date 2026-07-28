import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSupportTicketDto {
  @IsString()
  customerId: string;

  @IsString()
  subject: string;

  @IsString()
  description: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  chatThreadId?: string;
}
