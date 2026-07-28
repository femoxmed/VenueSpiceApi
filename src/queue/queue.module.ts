import { Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'notifications' })],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
