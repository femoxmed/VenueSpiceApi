import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Query,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyAdminOtpDto } from './dto/verify-admin-otp.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Post('login')
	login(@Body() dto: LoginDto) {
		return this.authService.login(dto);
	}

	@Post('verify-admin-otp')
	verifyAdminOtp(@Body() dto: VerifyAdminOtpDto) {
		return this.authService.verifyAdminOtp(dto);
	}

	@Post('refresh')
	refresh(@Body() dto: { refreshToken: string }) {
		return this.authService.refresh(dto.refreshToken);
	}

	@Post('register')
	register(@Body() dto: RegisterDto) {
		return this.authService.register(dto);
	}

	@Post('verify-email')
	verifyEmail(@Body() dto: VerifyEmailDto) {
		return this.authService.verifyEmail(dto);
	}

	@Post('resend-verification')
	resendVerification(@Body() dto: ResendVerificationDto) {
		return this.authService.resendVerification(dto);
	}

	@Post('forgot-password')
	forgotPassword(@Body() dto: ForgotPasswordDto) {
		return this.authService.forgotPassword(dto);
	}

	@Post('reset-password')
	resetPassword(@Body() dto: ResetPasswordDto) {
		return this.authService.resetPassword(dto);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@Get('me')
	me(@Req() req: { user: unknown }) {
		return req.user;
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@Patch('me')
	updateMe(
		@Req() req: { user: { id: string } },
		@Body() dto: { fullName?: string; phone?: string },
	) {
		return this.authService.updateMe(req.user.id, dto);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Get('users')
	listUsers(@Query('role') role?: string) {
		return this.authService.listUsers(role);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Post('users')
	createUser(@Body() dto: CreateUserDto, @Req() req: { user: { id: string; email?: string; role: Role } }) {
		return this.authService.createUser(dto, req.user, req as any);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Patch('users/:userId/status')
	updateUserStatus(
		@Param('userId') userId: string,
		@Body() dto: UpdateUserStatusDto,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.authService.updateUserStatus(userId, dto.isActive, req.user, req as any);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN, Role.ADMIN)
	@Get('users/:userId')
	getUser(@Param('userId') userId: string) {
		return this.authService.getUserById(userId);
	}

	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.SUPER_ADMIN)
	@Patch('users/:userId')
	updateUser(
		@Param('userId') userId: string,
		@Body() dto: Partial<CreateUserDto>,
		@Req() req: { user: { id: string; email?: string; role: Role } },
	) {
		return this.authService.updateUser(userId, dto, req.user, req as any);
	}
}
