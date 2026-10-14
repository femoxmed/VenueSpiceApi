import {
	IsArray,
	IsUUID,
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

export class CheckoutTicketAttendeeDto {
	@IsString()
	name: string;

	@IsEmail()
	email: string;
}

export class CheckoutTicketItemDto {
	@IsString()
	ticketTypeId: string;

	@IsInt()
	@Min(1)
	quantity: number;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CheckoutTicketAttendeeDto)
	attendees?: CheckoutTicketAttendeeDto[];
}

export class CheckoutAddOnItemDto {
	@IsString()
	addOnId: string;

	@IsInt()
	@Min(1)
	quantity: number;
}

export class CreateCheckoutSessionDto {
	@IsOptional() @IsUUID() analyticsSessionId?: string;
	@IsOptional() @IsUUID() analyticsVisitorId?: string;

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

	@IsOptional()
	@IsString()
	privateAccessToken?: string;

	@IsOptional()
	@IsString()
	accessCode?: string;

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

	@IsBoolean()
	termsAccepted: boolean;
}
