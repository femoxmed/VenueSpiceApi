import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class ReassignTicketOrderDto {
	@IsEmail()
	email: string;

	@IsString()
	@MinLength(2)
	fullName: string;

	@IsOptional()
	@IsUUID()
	userId?: string;

	@IsOptional()
	@IsBoolean()
	sendEmail?: boolean;
}
