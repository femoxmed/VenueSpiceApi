import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewRefundRequestDto {
	@ApiPropertyOptional({ example: 'Refund approved before cutoff.' })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	note?: string;
}
