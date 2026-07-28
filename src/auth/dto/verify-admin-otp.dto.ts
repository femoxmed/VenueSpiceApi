import { IsEmail, IsString, MinLength } from 'class-validator';

export class VerifyAdminOtpDto {
	@IsEmail()
	email: string;

	@IsString()
	@MinLength(6)
	code: string;
}
