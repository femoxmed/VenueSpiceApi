import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, JobState, Queue } from 'bullmq';

@Injectable()
export class QueueService {
  constructor(@InjectQueue('notifications') private readonly notificationsQueue: Queue) {}

  async getOverview() {
    const [counts, metrics, redisInfo, isPaused] = await Promise.all([
      this.notificationsQueue.getJobCounts(
        'active',
        'completed',
        'delayed',
        'failed',
        'paused',
        'prioritized',
        'waiting',
        'waiting-children',
      ),
      this.notificationsQueue.getMetrics('completed', 0, 30),
      this.getRedisHealth(),
      this.notificationsQueue.isPaused(),
    ]);

    return {
      queue: this.notificationsQueue.name,
      counts,
      isPaused,
      redis: redisInfo,
      metrics,
      defaultJobOptions: this.notificationsQueue.opts.defaultJobOptions,
    };
  }

  async getJobs(state: JobState | 'latest' = 'latest', start = 0, end = 20) {
    let jobs: Job[];

    if (state === 'latest') {
      const states: JobState[] = ['active', 'waiting', 'delayed', 'completed', 'failed', 'prioritized'];
      const groups = await Promise.all(states.map((jobState) => this.notificationsQueue.getJobs([jobState], start, end, false)));
      jobs = groups.flat();
    } else {
      jobs = await this.notificationsQueue.getJobs([state], start, end, false);
    }

    return jobs.map((job) => this.serializeJob(job));
  }

  async retryJob(jobId: string) {
    const job = await this.notificationsQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException('Queue job not found');
    }

    await job.retry();
    const refreshed = await this.notificationsQueue.getJob(jobId);
    return refreshed ? this.serializeJob(refreshed) : { id: jobId, retried: true };
  }

  async pauseQueue() {
    await this.notificationsQueue.pause();
    return { queue: this.notificationsQueue.name, paused: true };
  }

  async resumeQueue() {
    await this.notificationsQueue.resume();
    return { queue: this.notificationsQueue.name, paused: false };
  }

  async cleanQueue(grace = 0, limit = 100, type: 'completed' | 'failed' | 'wait' | 'active' | 'paused' | 'delayed' = 'failed') {
    const cleaned = await this.notificationsQueue.clean(grace, limit, type);
    return {
      queue: this.notificationsQueue.name,
      type,
      cleanedJobIds: cleaned,
    };
  }

  private async getRedisHealth() {
    const client = await this.notificationsQueue.client;
    const ping = await client.ping();
    const info = await client.info('server');
    const redisVersion = info
      .split('\n')
      .find((line) => line.startsWith('redis_version:'))
      ?.split(':')[1]
      ?.trim();

    return {
      ping,
      status: client.status,
      redisVersion: redisVersion ?? 'unknown',
    };
  }

  private serializeJob(job: Job) {
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      opts: job.opts,
      progress: job.progress,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      returnvalue: job.returnvalue,
    };
  }
}
