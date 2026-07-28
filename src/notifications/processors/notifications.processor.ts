import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationsService } from '../notifications.service';

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job<{ to: string; subject: string; html: string; replyTo?: string; headers?: Record<string, string> }>) {
    if (job.name === 'send-email') {
      return this.notificationsService.sendEmailNowWithOptions(job.data);
    }

    return null;
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Queue job completed: ${job.id} (${job.name})`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const attemptsMade = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;
    this.logger.error(
      `Queue job failed: ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) attempt ${attemptsMade}/${maxAttempts}`,
      error.stack,
    );
  }
}
