import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { NewsletterSubscriberEntity } from './entities/newsletter-subscriber.entity';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

@Module({
	imports: [
		TypeOrmModule.forFeature([NewsletterSubscriberEntity]),
		JwtModule.register({}),
		NotificationsModule,
	],
	controllers: [NewsletterController],
	providers: [NewsletterService],
})
export class NewsletterModule {}
