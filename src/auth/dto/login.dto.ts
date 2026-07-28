import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

class LoginCartItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
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

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoginCartItemDto)
  guestCartItems?: LoginCartItemDto[];
}
