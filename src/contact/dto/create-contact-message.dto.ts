import { IsEmail, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class CreateContactMessageDto {
	@IsString()
	@MinLength(2)
	fullName: string;

	@IsEmail()
	email: string;

	@IsPhoneNumber()
	phone: string;

	@IsString()
	@MinLength(10)
	message: string;

	@IsOptional()
	@IsString()
	subject?: string;

	@IsOptional()
	@IsString()
	source?: string;
}
