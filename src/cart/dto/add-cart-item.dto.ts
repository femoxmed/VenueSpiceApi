import { IsIn, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AddCartItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsOptional()
  @IsString()
  installedProductId?: string;

  @IsOptional()
  @IsIn(['machine', 'filter', 'accessory', 'service'])
  type?: 'machine' | 'filter' | 'accessory' | 'service';

  @IsOptional()
  @IsObject()
  variant?: {
    id?: string;
    label?: string;
    value?: string;
    imageUrl?: string;
  };
}
