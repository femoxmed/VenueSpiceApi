import {
	IsArray,
	IsBoolean,
	IsDateString,
	IsInt,
	Max,
	Min,
	IsNumber,
	IsObject,
	IsOptional,
	IsString,
	IsIn,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTicketTypeDto {
	@IsOptional()
	@IsString()
	id?: string;

	@IsString()
	name: string;

	@IsNumber()
	price: number;

	@IsInt()
	quantity: number;

	@IsOptional()
	@IsInt()
	limitPerPerson?: number;

	@IsOptional()
	@IsIn(['single', 'group'])
	admissionType?: 'single' | 'group';

	@IsOptional()
	@IsInt()
	groupSize?: number;

	@IsOptional()
	@IsBoolean()
	collectGroupAttendeeDetails?: boolean;

	@IsOptional()
	@IsBoolean()
	attendeeDetailsRequired?: boolean;

	@IsOptional()
	@IsDateString()
	salesStartAt?: string;

	@IsOptional()
	@IsDateString()
	salesEndAt?: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsBoolean()
	includeCharges?: boolean;
}

export class CreateEventDto {
	@IsString()
	organizationId: string;

	@IsString()
	title: string;

	@IsOptional()
	@IsString()
	slug?: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsString()
	category?: string;

	@IsOptional()
	@IsString()
	organizerName?: string;

	@IsOptional()
	@IsString()
	venue?: string;

	@IsOptional()
	@IsString()
	country?: string;

	@IsOptional()
	@IsString()
	city?: string;

	@IsOptional()
	@IsString()
	state?: string;

	@IsOptional()
	@IsString()
	streetAddress?: string;

	@IsOptional()
	@IsString()
	timezone?: string;

	@IsOptional()
	@IsBoolean()
	isVirtual?: boolean;

	@IsDateString()
	startsAt: string;

	@IsOptional()
	@IsDateString()
	endsAt?: string;

	@IsOptional()
	@IsString()
	coverImageUrl?: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	imageUrls?: string[];

	@IsOptional()
	@IsObject()
	socialLinks?: Record<string, string>;

	@IsOptional()
	@IsArray()
	appearances?: Array<Record<string, unknown>>;

	@IsOptional()
	@IsArray()
	addOns?: Array<Record<string, unknown>>;

	@IsOptional()
	@IsIn(['draft', 'published', 'cancelled', 'archived'])
	status?: 'draft' | 'published' | 'cancelled' | 'archived';

	@IsOptional()
	@IsInt()
	@Min(0)
	refundCutoffHours?: number;

	@IsOptional()
	@IsBoolean()
	refundsAllowed?: boolean;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(100)
	refundablePercentage?: number;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateTicketTypeDto)
	ticketTypes?: CreateTicketTypeDto[];
}
