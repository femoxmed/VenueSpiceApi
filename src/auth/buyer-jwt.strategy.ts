import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
@Injectable()
export class BuyerJwtStrategy extends PassportStrategy(Strategy,'buyer-jwt') {
 constructor(config:ConfigService,private readonly auth:AuthService){super({jwtFromRequest:ExtractJwt.fromAuthHeaderAsBearerToken(),ignoreExpiration:false,secretOrKey:config.get<string>('JWT_SECRET','change-me')});}
 async validate(payload:{sub:string;type?:string;scope?:string;emailProofAt?:number}){
  if(payload.type || (payload.scope && payload.scope!=='buyer')) throw new UnauthorizedException();
  return {...await this.auth.validateUser(payload.sub),emailProofAt:payload.emailProofAt,sessionScope:payload.scope};
 }
}
