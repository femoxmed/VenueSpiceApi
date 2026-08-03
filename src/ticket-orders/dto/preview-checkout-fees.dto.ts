import {
	ArrayMinSize,
	IsArray,
	IsOptional,
	IsString,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CheckoutTicketItemDto } from './create-checkout-session.dto';

export class PreviewCheckoutFeesDto {
	@IsString()
	eventId: string;

	@IsOptional()
	@IsString()
	referralCode?: string;

	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => CheckoutTicketItemDto)
	items: CheckoutTicketItemDto[];
}
