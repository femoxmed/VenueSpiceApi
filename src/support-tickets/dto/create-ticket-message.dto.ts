import {
	IsBoolean,
	IsNotEmpty,
	IsOptional,
	IsString,
	IsUUID,
	IsEnum,
} from 'class-validator';
import { TicketMessageSource } from '../entities/support-ticket-message.entity';

export class CreateTicketMessageDto {
	@IsString()
	@IsNotEmpty()
	content: string;

	@IsBoolean()
	@IsOptional()
	isInternalNote?: boolean;

	@IsOptional()
	attachments?: string[];

	@IsEnum(TicketMessageSource)
	@IsOptional()
	source?: TicketMessageSource;

	@IsString()
	@IsOptional()
	externalMessageId?: string;

	@IsString()
	@IsOptional()
	emailThreadId?: string;
}
