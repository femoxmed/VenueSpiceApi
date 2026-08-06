import {
	BadRequestException,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import ms = require('ms');
import { IsNull, Repository } from 'typeorm';
import { PasswordResetRecordEntity } from './entities/password-reset-record.entity';
import { UserEntity } from './entities/user.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyAdminOtpDto } from './dto/verify-admin-otp.dto';
import { Role } from '../common/enums/role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { CartService } from '../cart/cart.service';
import { AuditService } from '../audit/audit.service';
import { Request } from 'express';

@Injectable()
export class AuthService {
	constructor(
		@InjectRepository(UserEntity)
		private readonly usersRepository: Repository<UserEntity>,
		@InjectRepository(OrganizationEntity)
		private readonly organizationsRepository: Repository<OrganizationEntity>,
		@InjectRepository(PasswordResetRecordEntity)
		private readonly passwordResetRecordsRepository: Repository<PasswordResetRecordEntity>,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
		private readonly notificationsService: NotificationsService,
		private readonly cartService: CartService,
		private readonly auditService: AuditService,
	) {}

	async login(payload: LoginDto) {
		const user = await this.usersRepository.findOne({
			where: { email: payload.email.toLowerCase().trim() },
		});

		if (!user || !user.isActive) {
			throw new UnauthorizedException('Invalid email or password');
		}

		const isPasswordValid = await bcrypt.compare(
			payload.password,
			user.passwordHash,
		);

		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid email or password');
		}

		if (!user.verifiedAt) {
			const code = this.generateVerificationCode();
			user.emailVerificationCodeHash = await bcrypt.hash(code, 10);
			user.emailVerificationExpiresAt = this.getVerificationExpiry();
			await this.usersRepository.save(user);

			await this.queueAuthEmail(
				user.email,
				'Verify your Venue Spice account',
				this.buildVerificationEmail(user.fullName, code),
			);

			return {
				requiresEmailVerification: true,
				email: user.email,
				message: 'Please verify your account. A new verification code has been sent to your email.',
			};
		}

		if (this.requiresAdminOtp(user.role)) {
			const code = this.generateVerificationCode();
			console.log(`[TEMP ADMIN OTP] ${user.email}: ${code}`);
			user.adminOtpCodeHash = await bcrypt.hash(code, 10);
			user.adminOtpExpiresAt = this.getVerificationExpiry();
			await this.usersRepository.save(user);

			await this.queueAuthEmail(
				user.email,
				'Venue Spice admin sign-in code',
				this.buildAdminOtpEmail(user.fullName, code),
			);

			return {
				requiresOtp: true,
				email: user.email,
				message: 'A sign-in code has been sent to your registered email.',
			};
		}

		const mergedCart = payload.guestCartItems?.length
			? await this.cartService.mergeGuestCart(user.id, {
					items: payload.guestCartItems,
				})
			: await this.cartService.getCart(user.id);

		return {
			accessToken: this.signAccessToken(user),
			refreshToken: this.signRefreshToken(user),
			user: this.toSafeUser(user),
			cart: mergedCart,
		};
	}

	async verifyAdminOtp(dto: VerifyAdminOtpDto) {
		const user = await this.usersRepository.findOne({
			where: { email: dto.email.toLowerCase().trim() },
		});

		if (!user || !user.isActive || !this.requiresAdminOtp(user.role)) {
			throw new UnauthorizedException('Invalid or expired sign-in code');
		}

		if (
			!user.adminOtpCodeHash ||
			!user.adminOtpExpiresAt ||
			user.adminOtpExpiresAt.getTime() < Date.now()
		) {
			throw new UnauthorizedException('Invalid or expired sign-in code');
		}

		const isCodeValid = await bcrypt.compare(dto.code, user.adminOtpCodeHash);

		if (!isCodeValid) {
			throw new UnauthorizedException('Invalid or expired sign-in code');
		}

		user.adminOtpCodeHash = null;
		user.adminOtpExpiresAt = null;
		await this.usersRepository.save(user);

		return {
			accessToken: this.signAccessToken(user),
			refreshToken: this.signRefreshToken(user),
			user: this.toSafeUser(user),
		};
	}

	async refresh(refreshToken: string) {
		if (!refreshToken) {
			throw new UnauthorizedException('Refresh token is required');
		}

		let payload: { sub: string; type?: string };
		try {
			payload = this.jwtService.verify(refreshToken, {
				secret: this.configService.get<string>('JWT_REFRESH_SECRET') ||
					this.configService.get<string>('JWT_SECRET', 'change-me'),
			});
		} catch {
			throw new UnauthorizedException('Invalid or expired refresh token');
		}

		if (payload.type !== 'refresh') {
			throw new UnauthorizedException('Invalid refresh token');
		}

		const user = await this.usersRepository.findOne({
			where: { id: payload.sub, isActive: true },
		});

		if (!user) {
			throw new UnauthorizedException('User not found or inactive');
		}

		return {
			accessToken: this.signAccessToken(user),
			refreshToken: this.signRefreshToken(user),
			user: this.toSafeUser(user),
		};
	}

	async validateUser(userId: string) {
		const user = await this.usersRepository.findOne({
			where: { id: userId, isActive: true },
		});

		if (!user) {
			throw new UnauthorizedException('User not found or inactive');
		}

		return this.toSafeUser(user);
	}

	async getUserById(userId: string) {
		const user = await this.usersRepository.findOne({ where: { id: userId } });

		if (!user) {
			throw new NotFoundException('User not found');
		}

		return this.toSafeUser(user);
	}

	async updateUser(userId: string, dto: Partial<CreateUserDto>, actor?: { id: string; email?: string; role?: Role }, request?: Request) {
		const user = await this.usersRepository.findOne({ where: { id: userId } });

		if (!user) {
			throw new NotFoundException('User not found');
		}

		const before = this.pickUserAuditFields(user);

		if (dto.fullName) {
			user.fullName = dto.fullName;
		}

		if (dto.email) {
			user.email = dto.email.toLowerCase().trim();
		}

		if (dto.role) {
			user.role = dto.role;
		}

		if (dto.isActive !== undefined) {
			user.isActive = dto.isActive;
		}

		if (dto.password) {
			user.passwordHash = await bcrypt.hash(dto.password, 10);
		}

		const saved = await this.usersRepository.save(user);
		await this.auditService.log(
			'user.updated',
			actor,
			'user',
			saved.id,
			this.buildChanges(before, this.pickUserAuditFields(saved)),
			{ updatedFields: Object.keys(dto).filter((key) => key !== 'password') },
			request,
		);
		return this.toSafeUser(saved);
	}

	async updateMe(userId: string, dto: { fullName?: string; phone?: string }) {
		const user = await this.usersRepository.findOne({ where: { id: userId } });

		if (!user) {
			throw new NotFoundException('User not found');
		}

		if (dto.fullName !== undefined) {
			user.fullName = dto.fullName.trim();
		}

		if (dto.phone !== undefined) {
			user.phone = dto.phone.trim();
		}

		return this.toSafeUser(await this.usersRepository.save(user));
	}

	async register(dto: RegisterDto) {
		const email = dto.email.toLowerCase().trim();
		const existing = await this.usersRepository.findOne({ where: { email } });

		if (existing) {
			throw new BadRequestException('A user with this email already exists');
		}

		const passwordHash = await bcrypt.hash(dto.password, 10);
		const verificationCode = this.generateVerificationCode();
		const user = await this.usersRepository.save(
			this.usersRepository.create({
				fullName: dto.fullName.trim(),
				email,
				passwordHash,
				phone: dto.phone?.trim() || null,
				accountType: dto.accountType ?? null,
				businessName: dto.businessName?.trim() || null,
				businessCategory: dto.businessCategory?.trim() || null,
				country: dto.country?.trim() || null,
				postalCode: dto.postalCode?.trim() || null,
				role: Role.USER,
				isActive: dto.isActive ?? true,
				verifiedAt: null,
				emailVerificationCodeHash: await bcrypt.hash(verificationCode, 10),
				emailVerificationExpiresAt: this.getVerificationExpiry(),
			}),
		);

		if (dto.accountType && dto.businessName?.trim()) {
			await this.createSignupOrganization(user, dto);
		}

		await this.queueAuthEmail(
			user.email,
			'Verify your Venue Spice account',
			this.buildVerificationEmail(user.fullName, verificationCode),
		);

		return {
			user: this.toSafeUser(user),
			message: 'Registration successful. Check your email for your verification code.',
		};
	}

	async verifyEmail(dto: VerifyEmailDto) {
		const email = dto.email.toLowerCase().trim();
		const user = await this.usersRepository.findOne({ where: { email } });

		if (!user) {
			throw new NotFoundException('User not found');
		}

		if (user.verifiedAt) {
			return {
				accessToken: this.signAccessToken(user),
				refreshToken: this.signRefreshToken(user),
				user: this.toSafeUser(user),
				message: 'Account already verified',
			};
		}

		if (
			!user.emailVerificationCodeHash ||
			!user.emailVerificationExpiresAt ||
			user.emailVerificationExpiresAt.getTime() < Date.now()
		) {
			throw new BadRequestException('Verification code has expired');
		}

		const isCodeValid = await bcrypt.compare(
			dto.code,
			user.emailVerificationCodeHash,
		);

		if (!isCodeValid) {
			throw new BadRequestException('Invalid verification code');
		}

		user.verifiedAt = new Date();
		user.activeAt = user.activeAt ?? new Date();
		user.emailVerificationCodeHash = null;
		user.emailVerificationExpiresAt = null;
		await this.usersRepository.save(user);

		await this.queueAuthEmail(
			user.email,
			'Welcome to Venue Spice',
			this.buildWelcomeEmail(user.fullName, user.role),
		);

		return {
			accessToken: this.signAccessToken(user),
			refreshToken: this.signRefreshToken(user),
			user: this.toSafeUser(user),
			message: 'Account verified',
		};
	}

	async resendVerification(dto: ResendVerificationDto) {
		const email = dto.email.toLowerCase().trim();
		const user = await this.usersRepository.findOne({ where: { email } });

		if (!user) {
			return {
				message: 'If the account exists, a verification email has been queued.',
			};
		}

		if (user.verifiedAt) {
			return { message: 'Account already verified' };
		}

		const verificationCode = this.generateVerificationCode();
		user.emailVerificationCodeHash = await bcrypt.hash(verificationCode, 10);
		user.emailVerificationExpiresAt = this.getVerificationExpiry();
		await this.usersRepository.save(user);

		await this.queueAuthEmail(
			user.email,
			'Verify your Venue Spice account',
			this.buildVerificationEmail(user.fullName, verificationCode),
		);

		return {
			message: 'If the account exists, a verification email has been queued.',
		};
	}

	async createUser(dto: CreateUserDto, actor?: { id: string; email?: string; role?: Role }, request?: Request) {
		const email = dto.email.toLowerCase().trim();
		const existing = await this.usersRepository.findOne({ where: { email } });

		if (existing) {
			throw new BadRequestException('A user with this email already exists');
		}

		const passwordHash = await bcrypt.hash(dto.password, 10);
		const user = await this.usersRepository.save(
			this.usersRepository.create({
				fullName: dto.fullName,
				email,
				passwordHash,
				role: dto.role,
				isActive: dto.isActive ?? true,
				verifiedAt: new Date(),
				activeAt: new Date(),
			}),
		);

		await this.notificationsService.queueEmail(
			user.email,
			'Your Venue Spice account has been created',
			this.buildAccountCreatedEmail(
				user.fullName,
				user.email,
				dto.password,
				user.role,
			),
		);

		await this.auditService.log(
			'user.created',
			actor,
			'user',
			user.id,
			{ after: this.pickUserAuditFields(user) },
			undefined,
			request,
		);

		return this.toSafeUser(user);
	}

	listUsers(role?: string) {
		const where: any = {};
		if (role) {
			where.role = role;
		}

		return this.usersRepository
			.find({
				where,
				order: { createdAt: 'DESC' },
			})
			.then((users) => users.map((user) => this.toSafeUser(user)));
	}

	async updateUserStatus(userId: string, isActive: boolean, actor?: { id: string; email?: string; role?: Role }, request?: Request) {
		const user = await this.usersRepository.findOne({ where: { id: userId } });

		if (!user) {
			throw new NotFoundException('User not found');
		}

		const before = this.pickUserAuditFields(user);
		user.isActive = isActive;
		const saved = await this.usersRepository.save(user);

		await this.notificationsService.queueEmail(
			user.email,
			isActive ? 'Venue Spice account re-activated' : 'Venue Spice account deactivated',
			this.buildStatusChangedEmail(user.fullName, isActive),
		);

		await this.auditService.log(
			isActive ? 'user.activated' : 'user.deactivated',
			actor,
			'user',
			saved.id,
			this.buildChanges(before, this.pickUserAuditFields(saved)),
			undefined,
			request,
		);

		return this.toSafeUser(saved);
	}

	private pickUserAuditFields(user: UserEntity) {
		return {
			fullName: user.fullName,
			email: user.email,
			role: user.role,
			isActive: user.isActive,
		};
	}

	private buildChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
		const changes: Record<string, { before: unknown; after: unknown }> = {};
		Object.keys(after).forEach((key) => {
			if (before[key] !== after[key]) {
				changes[key] = { before: before[key], after: after[key] };
			}
		});
		return changes;
	}

	async forgotPassword(dto: ForgotPasswordDto) {
		const email = dto.email.toLowerCase().trim();
		const user = await this.usersRepository.findOne({ where: { email } });

		if (!user) {
			return {
				message: 'If the account exists, a reset email has been queued.',
			};
		}

		const tokenId = randomUUID();
		const expiresInValue = this.configService.get<string>(
			'PASSWORD_RESET_EXPIRES_IN',
			'15m',
		);
		const expiresAt = new Date(Date.now() + Number(ms(expiresInValue)));

		await this.passwordResetRecordsRepository.update(
			{ userId: user.id, usedAt: IsNull(), revokedAt: IsNull() },
			{ revokedAt: new Date() },
		);

		await this.passwordResetRecordsRepository.save(
			this.passwordResetRecordsRepository.create({
				userId: user.id,
				tokenId,
				expiresAt,
			}),
		);

		const token = this.jwtService.sign(
			{ sub: user.id, email: user.email, type: 'password_reset', tokenId },
			{
				secret: this.configService.get<string>('JWT_SECRET', 'change-me'),
				expiresIn: expiresInValue,
			},
		);

		const passwordResetUrl =
			this.configService.get<string>(
				'PASSWORD_RESET_URL',
				'http://localhost:3000/reset-password',
			) +
			'?token=' +
			encodeURIComponent(token);

		await this.notificationsService.queueEmail(
			user.email,
			'Reset your Venue Spice password',
			this.buildPasswordResetEmail(
				user.fullName,
				passwordResetUrl,
				expiresInValue,
			),
		);

		return {
			message: 'If the account exists, a reset email has been queued.',
		};
	}

	async resetPassword(dto: ResetPasswordDto) {
		let payload: { sub: string; type: string; tokenId: string };

		try {
			payload = this.jwtService.verify(dto.token, {
				secret: this.configService.get<string>('JWT_SECRET', 'change-me'),
			});
		} catch {
			throw new BadRequestException('Invalid or expired reset token');
		}

		if (payload.type !== 'password_reset') {
			throw new BadRequestException('Invalid reset token type');
		}

		const resetRecord = await this.passwordResetRecordsRepository.findOne({
			where: {
				userId: payload.sub,
				tokenId: payload.tokenId,
			},
		});

		if (!resetRecord) {
			throw new BadRequestException('Reset token is invalid');
		}

		if (resetRecord.usedAt) {
			throw new BadRequestException('Reset token has already been used');
		}

		if (resetRecord.revokedAt) {
			throw new BadRequestException('Reset token has been revoked');
		}

		if (resetRecord.expiresAt.getTime() < Date.now()) {
			throw new BadRequestException('Reset token has expired');
		}

		const user = await this.usersRepository.findOne({
			where: { id: payload.sub },
		});

		if (!user) {
			throw new NotFoundException('User not found');
		}

		user.passwordHash = await bcrypt.hash(dto.password, 10);
		await this.usersRepository.save(user);

		resetRecord.usedAt = new Date();
		await this.passwordResetRecordsRepository.save(resetRecord);

		await this.passwordResetRecordsRepository.update(
			{ userId: user.id, usedAt: IsNull(), revokedAt: IsNull() },
			{ revokedAt: new Date() },
		);

		await this.notificationsService.queueEmail(
			user.email,
			'Your Venue Spice password has been changed',
			this.buildPasswordChangedEmail(user.fullName),
		);

		return {
			message: 'Password reset successful',
		};
	}

	private signAccessToken(user: UserEntity) {
		return this.jwtService.sign({
			sub: user.id,
			email: user.email,
			phone: user.phone,
			role: user.role,
		});
	}

	private signRefreshToken(user: UserEntity) {
		return this.jwtService.sign(
			{
				sub: user.id,
				email: user.email,
				type: 'refresh',
			},
			{
				secret:
					this.configService.get<string>('JWT_REFRESH_SECRET') ||
					this.configService.get<string>('JWT_SECRET', 'change-me'),
				expiresIn: this.configService.get<string>(
					'JWT_REFRESH_EXPIRES_IN',
					'30d',
				),
			},
		);
	}

	private toSafeUser(user: UserEntity) {
		return {
			id: user.id,
			fullName: user.fullName,
			email: user.email,
			phone: user.phone,
			role: user.role,
			accountType: user.accountType,
			businessName: user.businessName,
			businessCategory: user.businessCategory,
			country: user.country,
			postalCode: user.postalCode,
			isActive: user.isActive,
			verifiedAt: user.verifiedAt,
			activeAt: user.activeAt,
			subscriptionPlan: user.subscriptionPlan,
			installedProducts: user.installedProducts,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		};
	}

	private generateVerificationCode() {
		return Math.floor(100000 + Math.random() * 900000).toString();
	}

	private getVerificationExpiry() {
		return new Date(Date.now() + 10 * 60 * 1000);
	}

	private requiresAdminOtp(role: Role) {
		return role === Role.ADMIN || role === Role.SUPER_ADMIN || role === Role.WRITER;
	}

	private async createSignupOrganization(user: UserEntity, dto: RegisterDto) {
		const name = dto.businessName?.trim();
		if (!name || !dto.accountType) return null;

		const slug = await this.buildUniqueOrganizationSlug(name);
		const organizerUsername = dto.accountType === 'organization' && dto.organizerUsername?.trim()
			? await this.getAvailableOrganizerUsernameOrThrow(dto.organizerUsername)
			: null;

		return this.organizationsRepository.save(
			this.organizationsRepository.create({
				name,
				slug,
				organizerUsername,
				type: dto.accountType,
				ownerUserId: user.id,
				contactEmail: user.email,
				contactPhone: dto.phone?.trim() || null,
				businessCategory: dto.businessCategory?.trim() || null,
				country: dto.country?.trim() || null,
				postalCode: dto.postalCode?.trim() || null,
				influencerPlatform: dto.influencerPlatform?.trim() || null,
				influencerHandle: dto.influencerHandle?.trim() || null,
				influencerProfileUrl: dto.influencerProfileUrl?.trim() || null,
				influencerNiche: dto.influencerNiche?.trim() || null,
				influencerAudienceSize: dto.influencerAudienceSize ?? null,
				influencerEngagementRate: dto.influencerEngagementRate ?? null,
				status: 'active',
			}),
		);
	}

	private normalizeOrganizerUsername(value: string) {
		return value
			.trim()
			.replace(/^@+/, '')
			.toLowerCase()
			.replace(/\s+/g, '-');
	}

	private validateOrganizerUsername(value: string) {
		if (!value) return 'Enter an organizer username';
		if (value.length < 3) return 'Use at least 3 characters';
		if (value.length > 30) return 'Use 30 characters or fewer';
		if (!/^[a-z0-9._-]+$/.test(value)) {
			return 'Use only letters, numbers, dots, dashes, or underscores';
		}
		if (/^[._-]|[._-]$/.test(value)) {
			return 'Username cannot start or end with a symbol';
		}
		return '';
	}

	private async getAvailableOrganizerUsernameOrThrow(value: string) {
		const normalized = this.normalizeOrganizerUsername(value);
		const validationMessage = this.validateOrganizerUsername(normalized);
		if (validationMessage) throw new BadRequestException(validationMessage);
		const existing = await this.organizationsRepository.findOne({
			where: { organizerUsername: normalized },
		});
		if (existing) {
			throw new BadRequestException('Organizer username is already taken');
		}
		return normalized;
	}

	private async buildUniqueOrganizationSlug(name: string) {
		const baseSlug = this.slugify(name) || 'organization';
		let slug = baseSlug;
		let suffix = 2;

		while (await this.organizationsRepository.findOne({ where: { slug } })) {
			slug = `${baseSlug}-${suffix}`;
			suffix += 1;
		}

		return slug;
	}

	private slugify(value: string) {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)+/g, '');
	}

	private buildAdminOtpEmail(fullName: string, code: string) {
		return this.notificationsService.buildBrandedEmail({
			eyebrow: 'Admin sign-in',
			title: 'Your Venue Spice admin code',
			greeting: `Hello ${fullName},`,
			intro:
				'Use this one-time code to finish signing in to the Venue Spice admin console.',
			body: `<div style="margin-top:22px;padding:18px 20px;border:1px solid #C8D6FF;background:#F3F6FF;color:#171B24;font:900 30px Arial Black,Arial,sans-serif;letter-spacing:8px;text-align:center;border-radius:16px;">${code}</div>`,
			note: 'This code expires in 10 minutes.',
		});
	}

	private buildVerificationEmail(fullName: string, code: string) {
		return this.notificationsService.buildBrandedEmail({
			eyebrow: 'Email verification',
			title: 'Verify your Venue Spice account',
			greeting: `Hello ${fullName},`,
			intro:
				'Use this verification code to finish creating your Venue Spice account.',
			body: `<div style="margin-top:22px;padding:18px 20px;border:1px solid #C8D6FF;background:#F3F6FF;color:#171B24;font:900 30px Arial Black,Arial,sans-serif;letter-spacing:8px;text-align:center;border-radius:16px;">${code}</div>`,
			note: 'This code expires in 10 minutes.',
		});
	}

	private async queueAuthEmail(to: string, subject: string, html: string) {
		try {
			await this.notificationsService.sendEmailNow(to, subject, html);
			return;
		} catch (error) {
			console.error('Failed to send auth email immediately', error);
		}

		try {
			await this.notificationsService.queueEmail(to, subject, html);
		} catch (error) {
			console.error('Failed to queue auth email fallback', error);
		}
	}

	private buildWelcomeEmail(fullName: string, role: Role) {
		return this.notificationsService.buildBrandedEmail({
			eyebrow: 'Welcome',
			title: 'Welcome to Venue Spice',
			greeting: `Hello ${fullName},`,
			intro:
				'Your account has been created successfully. You can now sign in and manage your Venue Spice experience.',
			rows: [{ label: 'Role', value: role }],
			action: {
				label: 'Sign in',
				url: `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000').replace(/\/$/, '')}/login`,
			},
		});
	}

	private buildAccountCreatedEmail(
		fullName: string,
		email: string,
		password: string,
		role: Role,
	) {
		return this.notificationsService.buildBrandedEmail({
			eyebrow: 'Account created',
			title: 'Your Venue Spice account is ready',
			greeting: `Hello ${fullName},`,
			intro:
				'An account has been created for you on Venue Spice. Please sign in and update your password as soon as possible.',
			rows: [
				{ label: 'Role', value: role },
				{ label: 'Email', value: email },
				{ label: 'Temporary password', value: password },
			],
			action: {
				label: 'Sign in',
				url: `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000').replace(/\/$/, '')}/login`,
			},
		});
	}

	private buildStatusChangedEmail(fullName: string, isActive: boolean) {
		return this.notificationsService.buildBrandedEmail({
			eyebrow: 'Account status',
			title: 'Account status update',
			greeting: `Hello ${fullName},`,
			intro: `Your Venue Spice account has been ${isActive ? 'activated' : 'deactivated'}.`,
			rows: [{ label: 'Status', value: isActive ? 'Active' : 'Inactive' }],
		});
	}

	private buildPasswordResetEmail(
		fullName: string,
		passwordResetUrl: string,
		expiresInValue: string,
	) {
		return this.notificationsService.buildBrandedEmail({
			eyebrow: 'Password reset',
			title: 'Reset your password',
			greeting: `Hello ${fullName},`,
			intro:
				'Use the button below to reset your Venue Spice password. This link can only be used once.',
			rows: [{ label: 'Expires in', value: expiresInValue }],
			action: {
				label: 'Reset password',
				url: passwordResetUrl,
			},
		});
	}

	private buildPasswordChangedEmail(fullName: string) {
		return this.notificationsService.buildBrandedEmail({
			eyebrow: 'Security',
			title: 'Password changed',
			greeting: `Hello ${fullName},`,
			intro: 'Your Venue Spice password has been changed successfully.',
			note: 'If you did not perform this action, contact support immediately.',
		});
	}
}
