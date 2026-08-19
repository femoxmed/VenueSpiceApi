import { IsOptional, IsString } from 'class-validator';

export class VerifyPrivateEventAccessDto {
	@IsOptional()
	@IsString()
	accessCode?: string;

	@IsOptional()
	@IsString()
	privateAccessToken?: string;
}
