import { Body, Controller, Post, Req } from '@nestjs/common';
import { Equals, IsEmail, IsPhoneNumber, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { BuyerAuthService } from './buyer-auth.service';
class RequestCodeDto {
 @IsEmail() @MaxLength(254) email:string;
 @Equals(true) termsAccepted:boolean;
}
class VerifyCodeDto {
 @IsEmail() @MaxLength(254) email:string;
 @IsUUID() challengeId:string;
 @Matches(/^\d{6}$/) code:string;
}
class GuestIdentityDto {
 @IsString() @MinLength(2) @MaxLength(120) name: string;
 @IsEmail() @MaxLength(254) email: string;
 @IsPhoneNumber() phone: string;
}
@Controller('auth/buyer')
export class BuyerAuthController {
 constructor(private readonly service:BuyerAuthService) {}
 @Post('request-code') request(@Body() dto:RequestCodeDto,@Req() req:Request){return this.service.request(dto.email,req.ip||req.socket.remoteAddress||'unknown',dto.termsAccepted);}
 @Post('verify-code') verify(@Body() dto:VerifyCodeDto){return this.service.verify(dto.email,dto.challengeId,dto.code);}
 @Post('guest-identity') guestIdentity(@Body() dto:GuestIdentityDto){return this.service.guestIdentity(dto.name,dto.email,dto.phone);}
}
