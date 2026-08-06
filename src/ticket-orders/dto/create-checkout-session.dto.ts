import {
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsEmail,
	IsInt,
	IsOptional,
	IsPhoneNumber,
	IsString,
	Min,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CheckoutTicketItemDto {
	@IsString()
	ticketTypeId: string;

	@IsInt()
	@Min(1)
	quantity: number;
}

export class CreateCheckoutSessionDto {
	@IsString()
	eventId: string;

	@IsString()
	customerName: string;

	@IsEmail()
	customerEmail: string;

	@IsOptional()
	@IsPhoneNumber()
	customerPhone?: string;

	@IsOptional()
	@IsString()
	referralCode?: string;

	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => CheckoutTicketItemDto)
	items: CheckoutTicketItemDto[];

	@IsBoolean()
	termsAccepted: boolean;
}
