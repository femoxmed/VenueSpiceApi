import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AnalyticsEventEntity } from './entities/analytics-event.entity';
import { TrackEventDto } from './dto/track-event.dto';
@Injectable()
export class TrackingService {
  constructor(private readonly db: DataSource) {}
  async record(dto: TrackEventDto) {
    if (dto.eventId) {
      const event = await this.db.query('SELECT id FROM events WHERE id = $1', [dto.eventId]);
      if (!event.length) throw new BadRequestException('Unknown event');
    }
    // Client retries cannot create duplicate events. Never accept client purchase confirmations.
    await this.db.createQueryBuilder().insert().into(AnalyticsEventEntity).values({
      id: dto.id, visitorId: dto.visitorId, sessionId: dto.sessionId, name: dto.name,
      page: dto.page, eventId: dto.eventId || null,
      source: dto.source?.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 100) || null,
      engagedSeconds: dto.name === 'engagement' ? dto.engagedSeconds || 0 : 0,
    }).orIgnore().execute();
    return { accepted: true };
  }
  @Cron('0 3 * * *', { timeZone: 'UTC' })
  async prune() {
    await this.db.query("DELETE FROM analytics_events WHERE received_at < NOW() - INTERVAL '90 days'");
  }
}
