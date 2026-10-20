import { BuyerAuthService } from './buyer-auth.service';
import { BuyerAuthController } from './buyer-auth.controller';
import { BuyerJwtStrategy } from './buyer-jwt.strategy';
import { BuyerLoginChallengeEntity, BuyerLoginLimitEntity } from './entities/buyer-login.entity';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordResetRecordEntity } from './entities/password-reset-record.entity';
import { UserEntity } from './entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { CartModule } from '../cart/cart.module';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    NotificationsModule,
    CartModule,
    AuditModule,
    TypeOrmModule.forFeature([BuyerLoginChallengeEntity, BuyerLoginLimitEntity, UserEntity, PasswordResetRecordEntity, OrganizationEntity]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'change-me'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '1d') ?? '1d',
        },
      }),
    }),
  ],
  controllers: [AuthController, BuyerAuthController],
  providers: [AuthService, JwtStrategy, BuyerJwtStrategy, BuyerAuthService],
  exports: [AuthService],
})
export class AuthModule {}
