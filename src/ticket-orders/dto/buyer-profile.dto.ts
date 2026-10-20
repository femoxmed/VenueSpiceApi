import { IsString, IsPhoneNumber, MinLength, MaxLength } from 'class-validator';
export class BuyerProfileDto {
 @IsString() @MinLength(2) @MaxLength(120) fullName:string;
 @IsPhoneNumber() phone:string;
}
