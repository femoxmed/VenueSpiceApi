import {
	IsArray,
	IsOptional,
	IsString,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CheckoutAddOnItemDto, CheckoutTicketItemDto } from './create-checkout-session.dto';

export class PreviewCheckoutFeesDto {
	@IsString()
	eventId: string;

	@IsOptional()
	@IsString()
	referralCode?: string;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CheckoutTicketItemDto)
	items?: CheckoutTicketItemDto[];

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CheckoutAddOnItemDto)
	addOns?: CheckoutAddOnItemDto[];
}
