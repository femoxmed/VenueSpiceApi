import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
@Injectable()
export class BuyerAuthGuard extends AuthGuard('buyer-jwt') {}
@Injectable()
export class OptionalBuyerAuthGuard extends BuyerAuthGuard {
 canActivate(context:ExecutionContext){
  if(!context.switchToHttp().getRequest().headers.authorization) return true;
  return super.canActivate(context);
 }
}
