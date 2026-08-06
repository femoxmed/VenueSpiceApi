import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';

export class CreateOrganizationMemberDto {
	@ApiProperty({ example: 'Jane Partner' })
	@IsString()
	fullName: string;

	@ApiProperty({ example: 'jane@example.com' })
	@IsEmail()
	email: string;

	@ApiPropertyOptional({ minLength: 8, example: 'temporaryPassword123' })
	@IsOptional()
	@IsString()
	@MinLength(8)
	password?: string;

	@ApiPropertyOptional({ enum: [Role.ORG_ADMIN, Role.ORG_STAFF], example: Role.ORG_STAFF })
	@IsOptional()
	@IsEnum(Role)
	role?: Role.ORG_ADMIN | Role.ORG_STAFF;
}
