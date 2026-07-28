import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateAgentDto {
	@IsString()
	organizationId: string;

	@IsString()
	fullName: string;

	@IsEmail()
	email: string;

	@IsOptional()
	@IsString()
	phone?: string;

	@IsOptional()
	@IsString()
	eventId?: string;

	@IsOptional()
	@IsString()
	code?: string;

	@IsOptional()
	@IsIn(['active', 'paused', 'pending_invite', 'archived'])
	status?: 'active' | 'paused' | 'pending_invite' | 'archived';
}
