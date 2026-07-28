import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './processors/notifications.processor';

@Module({
	imports: [
		BullModule.registerQueue({
			name: 'notifications',
		}),
	],
	controllers: [NotificationsController],
	providers: [NotificationsService, NotificationsProcessor],
	exports: [NotificationsService],
})
export class NotificationsModule {}
