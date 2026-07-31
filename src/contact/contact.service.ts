import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ContactService {
	constructor(
		private readonly notificationsService: NotificationsService,
		private readonly configService: ConfigService,
	) {}

	async createMessage(dto: CreateContactMessageDto) {
		const recipient =
			this.configService.get<string>('CONTACT_EMAIL_TO') ||
			this.configService.get<string>('SUPPORT_EMAIL') ||
			this.extractEmailAddress(
				this.configService.get<string>('SMTP_FROM', 'no-reply@example.com'),
			);

		await this.notificationsService.queueEmail(
			recipient,
			`New Venue Spice contact message from ${dto.fullName}`,
			this.notificationsService.buildBrandedEmail({
				eyebrow: 'Contact form',
				title: 'New website message',
				greeting: 'Hello Venue Spice team,',
				intro: 'A customer submitted a message from the contact page.',
				rows: [
					{ label: 'Full name', value: dto.fullName },
					{ label: 'Email', value: dto.email },
					{ label: 'Mobile number', value: dto.phone },
					{ label: 'Subject', value: dto.subject || 'General Inquiry' },
					{ label: 'Source', value: dto.source || 'Contact page' },
				],
				body: `<p>${this.escapeHtml(dto.message).replace(/\n/g, '<br>')}</p>`,
				footerNote: 'This message was submitted through the Venue Spice website.',
			}),
			{ replyTo: dto.email },
		);

		return {
			message: 'Your message has been received. Our team will respond shortly.',
		};
	}

	private extractEmailAddress(value: string) {
		return value.match(/<([^>]+)>/)?.[1] || value;
	}

	private escapeHtml(value: string) {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}
}
