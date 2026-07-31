import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

class TestEmailDto {
	@IsEmail()
	email: string;
}
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { NotificationsService } from './notifications.service';

class QueueEmailDto {
	@IsEmail()
	to: string;

	@IsString()
	subject: string;

	@IsString()
	html: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
	constructor(private readonly notificationsService: NotificationsService) {}

	@Roles(Role.SUPER_ADMIN)
	@Post('email')
	queueEmail(@Body() dto: QueueEmailDto) {
		return this.notificationsService.queueEmail(dto.to, dto.subject, dto.html);
	}

	@Roles(Role.SUPER_ADMIN)
	@Post('email/test')
	async sendTestEmail(@Body() dto: TestEmailDto) {
		const email = dto.email;
		const subject = 'Test Email from Venue Spice Platform';
		const html = this.notificationsService.buildBrandedEmail({
			eyebrow: 'System test',
			title: 'Email configuration test',
			greeting: 'Hello,',
			intro:
				'This is a test email to verify your SMTP configuration is working correctly.',
			rows: [{ label: 'Sent at', value: new Date() }],
			note:
				'If you received this email, your email settings are properly configured.',
		});

		try {
			await this.notificationsService.sendEmailNow(email, subject, html);
			return {
				success: true,
				message: 'Test email sent successfully',
				recipient: email,
			};
		} catch (error) {
			return {
				success: false,
				message: 'Failed to send test email',
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}
}
