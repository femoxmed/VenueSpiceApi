import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TicketCategory, TicketPriority } from '../entities/support-ticket.entity';

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
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

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
