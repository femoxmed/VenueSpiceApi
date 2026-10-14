import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AnalyticsEventEntity } from './entities/analytics-event.entity';
import { TrackEventDto } from './dto/track-event.dto';
@Injectable()
export class TrackingService {
  constructor(private readonly db: DataSource) {}
  async record(dto: TrackEventDto, geo: { country?: string; state?: string; city?: string } = {}) {
    if (dto.eventId) {
      const event = await this.db.query('SELECT id FROM events WHERE id = $1', [dto.eventId]);
      if (!event.length) throw new BadRequestException('Unknown event');
    }
    let promoterId: string | null = null;
    let referralCodeId: string | null = null;
    if (dto.name === 'referral_click') {
      if (!dto.eventId || !dto.referralCode) throw new BadRequestException('Referral tracking requires an event and code');
      const [referral] = await this.db.query(`SELECT r.id, g.id AS promoter_id FROM referral_codes r JOIN agents g ON g.id=r."agentId" JOIN events e ON e."organizationId"=g."organizationId" WHERE e.id=$1 AND UPPER(r.code)=$2 AND r.status='active' AND (r."eventId" IS NULL OR r."eventId"=e.id)`, [dto.eventId, dto.referralCode.trim().toUpperCase()]);
      if (referral) { referralCodeId = referral.id; promoterId = referral.promoter_id; }
      else {
        const [coupon] = await this.db.query(`SELECT c."agentId" AS promoter_id FROM discount_coupons c JOIN agents g ON g.id=c."agentId" JOIN events e ON e."organizationId"=c."organizationId" AND g."organizationId"=e."organizationId" WHERE e.id=$1 AND UPPER(c.code)=$2 AND c.status='active' AND (c."eventId" IS NULL OR c."eventId"=e.id) AND (c.starts_at IS NULL OR c.starts_at<=NOW()) AND (c.ends_at IS NULL OR c.ends_at>NOW())`, [dto.eventId,dto.referralCode.trim().toUpperCase()]);
        if (!coupon) return { accepted: false };
        promoterId = coupon.promoter_id;
      }
    }
    // Client retries cannot create duplicate events. Never accept client purchase confirmations.
    await this.db.createQueryBuilder().insert().into(AnalyticsEventEntity).values({
      id: dto.id, visitorId: dto.visitorId, sessionId: dto.sessionId, name: dto.name,
      page: dto.page, eventId: dto.eventId || null,
      referralCodeId, promoterId, country: geo.country || null, state: geo.state || null, city: geo.city || null,
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
