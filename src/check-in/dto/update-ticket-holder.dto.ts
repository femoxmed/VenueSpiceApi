import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTicketHolderDto {
	@IsString()
	@MinLength(2)
	@MaxLength(120)
	holderName: string;

	@IsEmail()
	@MaxLength(160)
	holderEmail: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	note?: string;
}
