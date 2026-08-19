import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { JobsOptions, Queue } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity';

type EmailAction = {
	label: string;
	url: string;
};

type EmailTemplateOptions = {
	preheader?: string;
	eyebrow?: string;
	title: string;
	greeting?: string;
	intro?: string;
	body?: string;
	rows?: Array<{ label: string; value: string | number | Date }>;
	action?: EmailAction;
	secondaryAction?: EmailAction;
	note?: string;
	footerNote?: string;
	footerHtml?: string;
};

@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
	private readonly logger = new Logger(NotificationsService.name);

	constructor(
		@InjectQueue('notifications') private readonly notificationsQueue: Queue,
		@InjectRepository(NotificationEntity)
		private readonly notificationsRepository: Repository<NotificationEntity>,
		private readonly configService: ConfigService,
	) {}

	async createInAppNotification(input: {
		userId: string;
		type: string;
		title: string;
		message: string;
		actionUrl?: string | null;
		metadata?: Record<string, unknown> | null;
	}) {
		return this.notificationsRepository.save(
			this.notificationsRepository.create({
				userId: input.userId,
				type: input.type,
				title: input.title,
				message: input.message,
				actionUrl: input.actionUrl ?? null,
				metadata: input.metadata ?? null,
			}),
		);
	}

	async listForUser(userId: string, limit = 20) {
		const take = Math.min(50, Math.max(1, Number(limit) || 20));
		const [items, unreadCount] = await Promise.all([
			this.notificationsRepository.find({
				where: { userId },
				order: { createdAt: 'DESC' },
				take,
			}),
			this.notificationsRepository.count({ where: { userId, readAt: IsNull() } }),
		]);

		return { items, unreadCount };
	}

	async markAllRead(userId: string) {
		await this.notificationsRepository
			.createQueryBuilder()
			.update(NotificationEntity)
			.set({ readAt: new Date() })
			.where('user_id = :userId', { userId })
			.andWhere('read_at IS NULL')
			.execute();
		return this.listForUser(userId);
	}

	async onApplicationBootstrap() {
		const shouldSend =
			this.configService.get<string>(
				'SMTP_SEND_STARTUP_TEST_EMAIL',
				'true',
			) !== 'false';

		if (!shouldSend) {
			return;
		}

		const to = this.getStartupTestRecipient();

		if (!to) {
			this.logger.warn(
				'Startup test email skipped: set SMTP_STARTUP_TEST_TO, SMTP_USER, or SMTP_FROM.',
			);
			return;
		}

		try {
			await this.sendEmailNow(
				to,
				'Venue Spice SMTP startup test',
				this.buildBrandedEmail({
					eyebrow: 'SMTP test',
					title: 'Venue Spice email is connected',
					greeting: 'Hello,',
					intro:
						'The Venue Spice API started successfully and sent this message using the configured SMTP transport.',
					rows: [
						{ label: 'Environment', value: process.env.NODE_ENV || 'local' },
						{ label: 'Sent at', value: new Date() },
					],
					note:
						'If you received this email, the server can connect to the SMTP provider.',
				}),
			);
			this.logger.log(`Startup test email sent to ${to}`);
		} catch (error) {
			this.logger.error(
				`Startup test email failed for ${to}`,
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	async queueEmail(
		to: string,
		subject: string,
		html: string,
		options?: JobsOptions & {
			replyTo?: string;
			headers?: Record<string, string>;
		},
	) {
		const attempts = this.configService.get<number>('QUEUE_RETRIES', 3);
		const backoffDelay = this.configService.get<number>(
			'QUEUE_BACKOFF_MS',
			5000,
		);

		return this.notificationsQueue.add(
			'send-email',
			{
				to,
				subject,
				html,
				replyTo: options?.replyTo,
				headers: options?.headers,
			},
			{
				attempts,
				backoff: { type: 'exponential', delay: backoffDelay },
				removeOnComplete: 100,
				removeOnFail: 200,
				...options,
			},
		);
	}

	async sendEmailNow(to: string, subject: string, html: string) {
		const transporter = this.createTransporter();

		return transporter.sendMail({
			from: this.configService.get<string>('SMTP_FROM', 'no-reply@example.com'),
			to,
			subject,
			html,
			text: this.htmlToText(html),
		});
	}

	async sendEmailNowWithOptions(options: {
		to: string;
		subject: string;
		html: string;
		replyTo?: string;
		headers?: Record<string, string>;
	}) {
		const transporter = this.createTransporter();

		return transporter.sendMail({
			from: this.configService.get<string>('SMTP_FROM', 'no-reply@example.com'),
			to: options.to,
			subject: options.subject,
			html: options.html,
			text: this.htmlToText(options.html),
			replyTo: options.replyTo,
			headers: options.headers,
		});
	}

	private createTransporter() {
		const host = this.configService.get<string>('SMTP_HOST');
		const port = Number(this.configService.get<string>('SMTP_PORT', '587'));
		const secure =
			this.configService.get<string>('SMTP_SECURE', 'false') === 'true';
		const user = this.configService.get<string>('SMTP_USER');
		const pass =
			this.configService.get<string>('SMTP_PASS') ||
			this.configService.get<string>('SMTP_PASSWORD');
		const rejectUnauthorized =
			this.configService.get<string>(
				'SMTP_TLS_REJECT_UNAUTHORIZED',
				'true',
			) !== 'false';
		const ignoreTLS =
			this.configService.get<string>('SMTP_IGNORE_TLS', 'false') === 'true';

		return nodemailer.createTransport({
			host,
			port,
			secure,
			auth: user
				? {
						user,
						pass,
					}
				: undefined,
			connectionTimeout: Number(
				this.configService.get<string>('SMTP_CONNECTION_TIMEOUT_MS', '30000'),
			),
			greetingTimeout: Number(
				this.configService.get<string>('SMTP_GREETING_TIMEOUT_MS', '30000'),
			),
			socketTimeout: Number(
				this.configService.get<string>('SMTP_SOCKET_TIMEOUT_MS', '60000'),
			),
			ignoreTLS,
			tls: {
				rejectUnauthorized,
			},
		});
	}

	buildBrandedEmail(options: EmailTemplateOptions) {
		const dashboardUrl = this.getPublicUrl(
			this.configService.get<string>('FRONTEND_DASHBOARD_URL') ||
				this.joinUrl(
					this.configService.get<string>('FRONTEND_URL', ''),
					'/dashboard',
				),
		);
		const supportEmail = this.configService.get<string>(
			'SUPPORT_EMAIL',
			this.extractEmailAddress(
				this.configService.get<string>('SMTP_FROM', 'no-reply@example.com'),
			),
		);
		const preheader = options.preheader || options.intro || options.title;
		const rows = options.rows?.length
			? `
				<table class="vs-data-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border-collapse:collapse;border:1px solid #E7ECFF;background:#F8FAFF;border-radius:12px;overflow:hidden;">
					${options.rows
						.map(
							(row) => `
								<tr>
									<td class="vs-data-label" style="padding:13px 16px;border-bottom:1px solid #E7ECFF;color:#68708A;font:700 11px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;width:38%;vertical-align:top;">${this.escapeHtml(row.label)}</td>
									<td class="vs-data-value" style="padding:13px 16px;border-bottom:1px solid #E7ECFF;color:#171B24;font:700 14px/1.5 Arial,sans-serif;word-break:break-word;vertical-align:top;">${this.escapeHtml(this.formatEmailValue(row.value))}</td>
								</tr>
							`,
						)
						.join('')}
				</table>
			`
			: '';
		const action = this.getPublicAction(options.action);
		const secondaryAction = this.getPublicAction(options.secondaryAction);
		const actionHtml = action
			? this.buildActionButton(action, false)
			: '';
		const secondaryActionHtml = secondaryAction
			? this.buildActionButton(secondaryAction, true)
			: '';
		const body = options.body ? this.sanitizeEmailHtml(options.body) : '';
		const note = options.note
			? `<div class="vs-note" style="margin-top:22px;padding:15px 16px;border-left:4px solid #2960EC;background:#F3F6FF;color:#333942;font:400 14px/1.7 Arial,sans-serif;border-radius:0 12px 12px 0;">${this.sanitizeEmailHtml(options.note)}</div>`
			: '';

		return `
<!doctype html>
<html>
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<meta name="color-scheme" content="light">
		<title>${this.escapeHtml(options.title)}</title>
		<style>
			@media only screen and (max-width: 600px) {
				.vs-outer { padding: 18px 10px !important; }
				.vs-container { max-width: 100% !important; }
				.vs-header-tagline { display: none !important; }
				.vs-card { border-radius: 16px !important; }
				.vs-card-body { padding: 24px 18px 22px !important; }
				.vs-logo-mark { width: 38px !important; height: 38px !important; border-radius: 12px !important; font-size: 16px !important; }
				.vs-brand-name { font-size: 20px !important; }
				.vs-brand-subtitle { font-size: 9px !important; letter-spacing: 1.6px !important; }
				.vs-eyebrow { margin-bottom: 10px !important; font-size: 10px !important; letter-spacing: 1.4px !important; }
				.vs-title { font-size: 24px !important; line-height: 1.22 !important; }
				.vs-greeting { margin-top: 18px !important; font-size: 15px !important; line-height: 1.6 !important; }
				.vs-copy { font-size: 14px !important; line-height: 1.7 !important; }
				.vs-data-table { margin: 18px 0 !important; }
				.vs-data-label,
				.vs-data-value { display: block !important; width: auto !important; padding: 11px 14px !important; }
				.vs-data-label { padding-bottom: 3px !important; border-bottom: 0 !important; }
				.vs-data-value { padding-top: 0 !important; }
				.vs-actions { margin-top: 20px !important; }
				.vs-button { display: block !important; width: auto !important; margin: 10px 0 0 !important; padding: 13px 16px !important; text-align: center !important; }
				.vs-note { margin-top: 18px !important; padding: 14px !important; font-size: 13px !important; line-height: 1.65 !important; }
				.vs-footer { padding: 18px 2px 0 !important; font-size: 11px !important; line-height: 1.65 !important; }
			}
		</style>
	</head>
	<body style="margin:0;padding:0;background:#EEF4FF;color:#171B24;">
		<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${this.escapeHtml(preheader)}</div>
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FB;border-collapse:collapse;">
			<tr>
				<td class="vs-outer" align="center" style="padding:30px 14px;">
					<table class="vs-container" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;border-collapse:collapse;">
						<tr>
							<td style="padding:0 0 16px 0;">
								<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
									<tr>
										<td>
											<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
												<tr>
													<td class="vs-logo-mark" style="width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#E5A21A 0%,#EA177C 52%,#3F22D8 100%);color:#FFFFFF;font:900 17px Arial Black,Arial,sans-serif;text-align:center;vertical-align:middle;">VS</td>
													<td style="padding-left:12px;">
														<div class="vs-brand-name" style="font:900 23px Arial Black,Arial,sans-serif;letter-spacing:0;color:#171B24;line-height:1;">Venue Spice</div>
														<div class="vs-brand-subtitle" style="margin-top:5px;font:700 10px Arial,sans-serif;letter-spacing:2.1px;color:#3F45FF;text-transform:uppercase;">Tickets. Vendors. Events.</div>
													</td>
												</tr>
											</table>
										</td>
										<td class="vs-header-tagline" align="right" style="font:700 11px Arial,sans-serif;letter-spacing:1.5px;color:#EA177C;text-transform:uppercase;">Your event starts here</td>
									</tr>
								</table>
							</td>
						</tr>
						<tr>
							<td class="vs-card" style="border:1px solid #E1E6F5;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(24,31,56,0.10);">
								<div style="height:7px;background:linear-gradient(90deg,#E5A21A 0%,#EA177C 50%,#3F45FF 100%);line-height:7px;font-size:7px;">&nbsp;</div>
								<div class="vs-card-body" style="padding:32px 30px 30px;">
									${options.eyebrow ? `<div class="vs-eyebrow" style="margin-bottom:12px;font:800 11px Arial,sans-serif;letter-spacing:1.8px;color:#2960EC;text-transform:uppercase;">${this.escapeHtml(options.eyebrow)}</div>` : ''}
									<h1 class="vs-title" style="margin:0;color:#171B24;font:900 28px/1.18 Arial Black,Arial,sans-serif;letter-spacing:0;">${this.escapeHtml(options.title)}</h1>
									${options.greeting ? `<p class="vs-greeting" style="margin:22px 0 0;color:#171B24;font:700 16px/1.65 Arial,sans-serif;">${this.escapeHtml(options.greeting)}</p>` : ''}
									${options.intro ? `<p class="vs-copy" style="margin:10px 0 0;color:#4A5268;font:400 15px/1.75 Arial,sans-serif;">${this.escapeHtml(options.intro)}</p>` : ''}
									${body ? `<div class="vs-copy" style="margin-top:16px;color:#4A5268;font:400 15px/1.75 Arial,sans-serif;">${body}</div>` : ''}
									${rows}
									${actionHtml || secondaryActionHtml ? `<div class="vs-actions" style="margin-top:24px;">${actionHtml}${secondaryActionHtml}</div>` : ''}
									${note}
								</div>
							</td>
						</tr>
						<tr>
							<td class="vs-footer" style="padding:20px 4px 0;color:#68708A;font:400 12px/1.7 Arial,sans-serif;">
								${options.footerHtml ? this.sanitizeEmailHtml(options.footerHtml) : this.escapeHtml(options.footerNote || 'This email was sent by Venue Spice.')}
								<br>
								Need help? Email <a href="mailto:${this.escapeHtml(supportEmail)}" style="color:#2960EC;text-decoration:underline;">${this.escapeHtml(supportEmail)}</a>${dashboardUrl ? ` or visit your <a href="${this.escapeHtml(dashboardUrl)}" style="color:#2960EC;text-decoration:underline;">Venue Spice dashboard</a>` : ''}.
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`;
	}

	buildCustomerCreatedEmail(fullName: string) {
		return this.buildBrandedEmail({
			eyebrow: 'Customer profile',
			title: 'Welcome to Venue Spice',
			greeting: `Hello ${fullName},`,
			intro:
				'Your customer profile has been created successfully in Venue Spice.',
			body:
				'<p>You will now receive order updates, invoices, maintenance reminders, and service notifications by email.</p>',
			action: {
				label: 'Open dashboard',
				url: this.joinUrl(
					this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
					'/dashboard',
				),
			},
		});
	}

	buildOrderCreatedEmail(
		fullName: string,
		orderId: string,
		invoiceNumber: string,
		total: number,
	) {
		return this.buildBrandedEmail({
			eyebrow: 'Order created',
			title: 'Your Venue Spice order is in',
			greeting: `Hello ${fullName},`,
			intro:
				'Your order has been created successfully. We will keep you updated as it moves forward.',
			rows: [
				{ label: 'Order ID', value: orderId },
				{ label: 'Invoice', value: invoiceNumber },
				{ label: 'Total', value: this.formatCurrency(total, 'NGN') },
			],
			action: {
				label: 'View order',
				url: this.joinUrl(
					this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
					'/dashboard/orders',
				),
			},
		});
	}

	buildInvoiceEmail(
		fullName: string,
		invoiceNumber: string,
		total: number,
		issuedAt: string | Date,
	) {
		return this.buildBrandedEmail({
			eyebrow: 'Invoice',
			title: 'Your Venue Spice invoice is ready',
			greeting: `Hello ${fullName},`,
			intro: 'Your invoice is ready for review.',
			rows: [
				{ label: 'Invoice', value: invoiceNumber },
				{ label: 'Total', value: this.formatCurrency(total, 'NGN') },
				{ label: 'Issued', value: issuedAt },
			],
			action: {
				label: 'View invoices',
				url: this.joinUrl(
					this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
					'/dashboard/orders',
				),
			},
		});
	}

	buildServiceBookingCreatedEmail(
		fullName: string,
		preferredDate: string,
		issue: string,
	) {
		return this.buildBrandedEmail({
			eyebrow: 'Service request',
			title: 'Your service request has been logged',
			greeting: `Hello ${fullName},`,
			intro:
				'Your Venue Spice service request has been created successfully. Our team will notify you once a technician has been assigned.',
			rows: [
				{ label: 'Preferred date', value: preferredDate },
				{ label: 'Issue', value: issue },
			],
			action: {
				label: 'View schedules',
				url: this.joinUrl(
					this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
					'/dashboard/schedules',
				),
			},
		});
	}

	buildTechnicianAssignmentEmail(
		fullName: string,
		preferredDate: string,
		issue: string,
		customerName: string,
	) {
		return this.buildBrandedEmail({
			eyebrow: 'Technician assignment',
			title: 'New Venue Spice field assignment',
			greeting: `Hello ${fullName},`,
			intro:
				'You have been assigned a new service visit. Please sign in to manage the visit.',
			rows: [
				{ label: 'Customer', value: customerName },
				{ label: 'Scheduled date', value: preferredDate },
				{ label: 'Issue', value: issue },
			],
			action: {
				label: 'Open admin',
				url: this.configService.get<string>(
					'ADMIN_URL',
					'http://localhost:5173',
				),
			},
		});
	}

	buildPaymentReceivedEmail(
		fullName: string,
		invoiceNumber: string,
		total: number,
		currency: string,
	) {
		return this.buildBrandedEmail({
			eyebrow: 'Payment confirmed',
			title: 'Payment received',
			greeting: `Hello ${fullName},`,
			intro:
				'We have received your payment. Thank you for choosing Venue Spice.',
			rows: [
				{ label: 'Invoice', value: invoiceNumber },
				{ label: 'Amount', value: this.formatCurrency(total, currency) },
			],
			action: {
				label: 'View invoices',
				url: this.joinUrl(
					this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
					'/dashboard/orders',
				),
			},
		});
	}

	buildServiceInvoiceCreatedEmail(
		fullName: string,
		invoiceNumber: string,
		total: number,
		serviceTypeName: string,
	) {
		return this.buildBrandedEmail({
			eyebrow: 'Service invoice',
			title: 'Service invoice created',
			greeting: `Hello ${fullName},`,
			intro:
				'Your billable service booking has been created and an invoice is ready for payment.',
			rows: [
				{ label: 'Service', value: serviceTypeName },
				{ label: 'Invoice', value: invoiceNumber },
				{ label: 'Total', value: this.formatCurrency(total, 'NGN') },
			],
			action: {
				label: 'Pay invoice',
				url: this.joinUrl(
					this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
					'/dashboard/schedules',
				),
			},
		});
	}

	buildSupportTicketMessageEmail(
		fullName: string,
		subject: string,
		authorName: string,
		content: string,
		ticketId: string,
		emailThreadId: string,
	) {
		return this.buildBrandedEmail({
			eyebrow: 'Support reply',
			title: subject,
			greeting: `Hello ${fullName},`,
			intro: `${authorName} replied to support ticket ${ticketId}.`,
			note: this.escapeHtml(content).replace(/\n/g, '<br>'),
			rows: [{ label: 'Thread ref', value: emailThreadId }],
			action: {
				label: 'Open ticket',
				url: this.joinUrl(
					this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
					'/dashboard/tickets',
				),
			},
			footerNote:
				'You can reply directly to this email or from your Venue Spice dashboard.',
		});
	}

	private buildActionButton(action: EmailAction, secondary: boolean) {
		const styles = secondary
			? 'display:inline-block;margin:8px 10px 0 0;padding:13px 18px;border:1px solid #C8D6FF;border-radius:999px;color:#2960EC;background:#FFFFFF;text-decoration:none;font:800 12px Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;'
			: 'display:inline-block;margin:8px 10px 0 0;padding:14px 20px;border:1px solid #2960EC;border-radius:999px;color:#FFFFFF;background:#2960EC;text-decoration:none;font:900 12px Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;';

		return `<a class="vs-button" href="${this.escapeHtml(action.url)}" style="${styles}">${this.escapeHtml(action.label)}</a>`;
	}

	private getPublicAction(action?: EmailAction) {
		if (!action) return null;
		const url = this.getActionUrl(action.url);
		return url ? { ...action, url } : null;
	}

	private getActionUrl(value?: string | null) {
		if (!value) return null;
		try {
			const url = new URL(value);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				return null;
			}
			return url.toString();
		} catch {
			return null;
		}
	}

	private getPublicUrl(value?: string | null) {
		if (!value) return null;
		try {
			const url = new URL(value);
			const hostname = url.hostname.toLowerCase();
			if (
				hostname === 'localhost' ||
				hostname === '127.0.0.1' ||
				hostname === '0.0.0.0' ||
				hostname === '::1'
			) {
				return null;
			}
			return url.toString();
		} catch {
			return null;
		}
	}

	private sanitizeEmailHtml(value: string) {
		return value
			.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
			.replace(/\son\w+="[^"]*"/gi, '')
			.replace(/\son\w+='[^']*'/gi, '');
	}

	private escapeHtml(value: string | number | Date | null | undefined) {
		return String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	private htmlToText(html: string) {
		return html
			.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
			.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|h1|h2|h3|tr|table)>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	}

	private extractEmailAddress(value: string) {
		return value.match(/<([^>]+)>/)?.[1] || value;
	}

	private getStartupTestRecipient() {
		const configured =
			this.configService.get<string>('SMTP_STARTUP_TEST_TO') ||
			this.configService.get<string>('SMTP_USER') ||
			this.configService.get<string>('SMTP_FROM', '');

		return configured ? this.extractEmailAddress(configured) : '';
	}

	private formatEmailValue(value: string | number | Date) {
		if (value instanceof Date) {
			return value.toLocaleDateString('en-NG', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			});
		}
		return String(value);
	}

	private formatCurrency(value: number, currency: string) {
		return new Intl.NumberFormat('en-NG', {
			style: 'currency',
			currency: currency || 'NGN',
			maximumFractionDigits: 0,
		}).format(Number(value ?? 0));
	}

	private joinUrl(base: string, path: string) {
		if (!base) return '';
		return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
	}
}
