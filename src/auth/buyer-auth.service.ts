import { BadRequestException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomInt, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';
import { BuyerLoginChallengeEntity, BuyerLoginLimitEntity } from './entities/buyer-login.entity';
import { UserEntity } from './entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from './auth.service';

@Injectable()
export class BuyerAuthService {
 constructor(private readonly db:DataSource, private readonly config:ConfigService, private readonly jwt:JwtService, private readonly mail:NotificationsService, private readonly auth:AuthService) {}
 private hash(value:string) { return createHmac('sha256',this.config.get<string>('JWT_SECRET','change-me')).update(value).digest('hex'); }
 async request(email:string, ip:string, accepted:boolean) {
  if (!accepted) throw new BadRequestException('Accept the account terms to continue.');
  email=email.trim().toLowerCase();
  const code=String(randomInt(100000,1000000)), challengeId=randomUUID(), now=new Date();
  await this.db.transaction(async m=>{
   // Database-backed limits survive process restarts and apply across all instances.
   for(const [key,max] of [[`email:${this.hash(email)}`,5],[`ip:${this.hash(ip)}`,300]] as const) {
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
    let limit=await m.findOneBy(BuyerLoginLimitEntity,{key});
    if(!limit || now.getTime()-limit.windowAt.getTime()>=3600000) limit=m.create(BuyerLoginLimitEntity,{key,count:0,windowAt:now});
    if(limit.count>=max) throw new HttpException('Too many sign-in requests. Please try again later.',429);
    limit.count++;await m.save(limit);
   }
   const previous=await m.findOneBy(BuyerLoginChallengeEntity,{email});
   if(previous && now.getTime()-previous.sentAt.getTime()<60000) throw new HttpException('Please wait 60 seconds before requesting another code.',429);
   await m.save(BuyerLoginChallengeEntity,m.create(BuyerLoginChallengeEntity,{email,challengeId,codeHash:this.hash(`${challengeId}:${code}`),sentAt:now,expiresAt:new Date(now.getTime()+600000),attempts:0,consumedAt:null}));
  });
  await this.mail.queueEmail(email,'Your Venue Spice ticket sign-in code',this.mail.buildBrandedEmail({title:'Sign in to buy and view tickets',intro:`Your one-time code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.`}));
  return {challengeId,message:'Check your email for a sign-in code.',retryAfter:60};
 }
 async verify(email:string,challengeId:string,code:string) {
  email=email.trim().toLowerCase();
  const result=await this.db.transaction(async m=>{
   await m.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`email:${this.hash(email)}`]);
   const challenge=await m.findOneBy(BuyerLoginChallengeEntity,{email});
   if(!challenge || challenge.challengeId!==challengeId || challenge.consumedAt || challenge.expiresAt.getTime()<=Date.now() || challenge.attempts>=5) return null;
   challenge.attempts++;
   const valid=timingSafeEqual(Buffer.from(challenge.codeHash,'hex'),Buffer.from(this.hash(`${challengeId}:${code}`),'hex'));
   if(!valid){await m.save(challenge);return null;}
   challenge.consumedAt=new Date();await m.save(challenge);
   let user=await m.getRepository(UserEntity).createQueryBuilder('u').where('LOWER(u.email) = :email',{email}).getOne();
   if(user && !user.isActive) return null;
   if(!user){
    user=m.create(UserEntity,{email,fullName:'',passwordHash:await bcrypt.hash(randomBytes(32).toString('hex'),10),role:Role.CUSTOMER,accountType:'customer',isActive:true,verifiedAt:new Date(),customerTermsAcceptedAt:challenge.sentAt});
    // An overlapping normal registration must never create a duplicate or grant its roles.
    await m.createQueryBuilder().insert().into(UserEntity).values({email:user.email,fullName:user.fullName,passwordHash:user.passwordHash,role:user.role,accountType:user.accountType,isActive:true,verifiedAt:user.verifiedAt,customerTermsAcceptedAt:user.customerTermsAcceptedAt}).orIgnore().execute();
    user=await m.findOneBy(UserEntity,{email});
   }
   if(!user || !user.isActive) return null;
   if(!user.verifiedAt){user.verifiedAt=new Date();user.emailVerificationCodeHash=null;user.emailVerificationExpiresAt=null;await m.save(user);}
   return user;
  });
  if(!result) throw new UnauthorizedException('Invalid or expired code. Request a new code if needed.');
  const emailProofAt=Date.now();
  // Email-code login grants business access only to supported non-platform accounts.
  const businessAccount=['organization','influencer','vendor'].includes(result.accountType || '') && [Role.ORG_ADMIN,Role.ORG_STAFF,Role.AGENT,Role.USER,Role.CUSTOMER].includes(result.role);
  const scope=businessAccount ? undefined : 'buyer';
  const claims={sub:result.id,email:result.email,role:result.role,...(scope ? {scope} : {}),emailProofAt};
  return {accessToken:this.jwt.sign(claims),refreshToken:this.jwt.sign({...claims,type:'refresh'},{secret:this.config.get<string>('JWT_REFRESH_SECRET')||this.config.get<string>('JWT_SECRET','change-me'),expiresIn:'30d'}),user:{...await this.auth.validateUser(result.id),sessionScope:scope}};
 }
}
