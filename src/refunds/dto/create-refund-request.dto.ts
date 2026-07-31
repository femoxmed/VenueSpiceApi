import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateRefundRequestDto {
	@ApiProperty({ example: 'b7b45db2-7e4d-4d20-aeb0-0f2f58fbd53d' })
	@IsUUID()
	orderId: string;

	@ApiProperty({ example: 'buyer@example.com' })
	@IsEmail()
	customerEmail: string;

	@ApiPropertyOptional({ example: 'I can no longer attend the event.' })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	reason?: string;
}
