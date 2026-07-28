import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCartItemDto {
  @IsInt()
  @Min(0)
  @Type(() => Number)
  quantity: number;

  @IsOptional()
  @IsString()
  variantKey?: string;
}
