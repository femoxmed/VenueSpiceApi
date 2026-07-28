import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateSupportTicketDto {
	@IsOptional()
	@IsString()
	subject?: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsString()
	status?: string;

	@IsOptional()
	@IsUUID()
	requestId?: string | null;

	@IsOptional()
	@IsUUID()
	productId?: string | null;

	@IsOptional()
	@IsString()
	chatThreadId?: string | null;
}
