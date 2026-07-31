import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import { NewsletterSubscriberEntity } from './entities/newsletter-subscriber.entity';

@Injectable()
export class NewsletterService {
	constructor(
		@InjectRepository(NewsletterSubscriberEntity)
		private readonly subscribersRepository: Repository<NewsletterSubscriberEntity>,
		private readonly notificationsService: NotificationsService,
		private readonly configService: ConfigService,
		private readonly jwtService: JwtService,
	) {}

	async subscribe(dto: SubscribeNewsletterDto) {
		const email = dto.email.toLowerCase().trim();
		const existing = await this.subscribersRepository.findOne({
			where: { email },
		});

		if (existing?.status === 'active') {
			return {
				message: 'You are already subscribed to the Venue Spice newsletter.',
				subscriber: this.serialize(existing),
			};
		}

		const subscriber = await this.subscribersRepository.save(
			this.subscribersRepository.create({
				...(existing ?? {}),
				email,
				source: dto.source?.trim() || existing?.source || 'Website footer',
				status: 'active',
				subscribedAt: new Date(),
				unsubscribedAt: null,
			}),
		);
		const appUrl = this.configService
			.get<string>('WEB_APP_URL', 'http://localhost:3000')
			.replace(/\/$/, '');
		const unsubscribeUrl = `${appUrl}/newsletter/unsubscribe?token=${encodeURIComponent(
			this.signUnsubscribeToken(subscriber),
		)}`;

		await this.notificationsService.queueEmail(
			email,
			'Welcome to the Venue Spice newsletter',
			this.notificationsService.buildBrandedEmail({
				eyebrow: 'Newsletter',
				title: 'You are in the loop',
				greeting: 'Hello,',
				intro:
					'Thanks for subscribing to Venue Spice updates. We will send you event inspiration, ticketing updates, and helpful organizer tips.',
				action: {
					label: 'Discover events',
					url: `${appUrl}/discover`,
				},
				note: 'You can unsubscribe from future newsletters at any time.',
				footerHtml: `This email was sent by Venue Spice. To stop receiving newsletter emails, <a href="${unsubscribeUrl}" style="color:#2960EC;text-decoration:underline;">unsubscribe here</a>.`,
			}),
		);

		return {
			message: 'Thanks for subscribing to the Venue Spice newsletter.',
			subscriber: this.serialize(subscriber),
		};
	}

	async unsubscribe(token: string) {
		if (!token) {
			throw new BadRequestException('Unsubscribe token is required');
		}

		let payload: { sub: string; email: string; type: string };
		try {
			payload = this.jwtService.verify(token, {
				secret: this.configService.get<string>('JWT_SECRET', 'change-me'),
			});
		} catch {
			throw new BadRequestException('Invalid unsubscribe link');
		}

		if (payload.type !== 'newsletter_unsubscribe') {
			throw new BadRequestException('Invalid unsubscribe link');
		}

		const subscriber = await this.subscribersRepository.findOne({
			where: { id: payload.sub },
		});

		if (!subscriber || subscriber.email !== payload.email) {
			throw new BadRequestException('Invalid unsubscribe link');
		}

		if (subscriber.status !== 'unsubscribed') {
			subscriber.status = 'unsubscribed';
			subscriber.unsubscribedAt = new Date();
			await this.subscribersRepository.save(subscriber);
		}

		return {
			message: 'You have been unsubscribed from the Venue Spice newsletter.',
			subscriber: this.serialize(subscriber),
		};
	}

	private serialize(subscriber: NewsletterSubscriberEntity) {
		return {
			id: subscriber.id,
			email: subscriber.email,
			status: subscriber.status,
			source: subscriber.source,
			subscribedAt: subscriber.subscribedAt,
		};
	}

	private signUnsubscribeToken(subscriber: NewsletterSubscriberEntity) {
		return this.jwtService.sign(
			{
				sub: subscriber.id,
				email: subscriber.email,
				type: 'newsletter_unsubscribe',
			},
			{
				secret: this.configService.get<string>('JWT_SECRET', 'change-me'),
				expiresIn: this.configService.get<string>(
					'NEWSLETTER_UNSUBSCRIBE_EXPIRES_IN',
					'365d',
				),
			},
		);
	}
}
