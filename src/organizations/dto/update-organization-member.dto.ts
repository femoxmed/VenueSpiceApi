import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';

export class UpdateOrganizationMemberDto {
	@ApiPropertyOptional({ enum: [Role.ORG_ADMIN, Role.ORG_STAFF], example: Role.ORG_STAFF })
	@IsOptional()
	@IsEnum(Role)
	role?: Role.ORG_ADMIN | Role.ORG_STAFF;

	@ApiPropertyOptional({ example: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean;
}
