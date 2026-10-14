import { Body, Controller, Get, Header, HttpCode, HttpException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Role } from '../common/enums/role.enum';
import { AnalyticsService } from './analytics.service';
import { TrackingService } from './tracking.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { TrackEventDto } from './dto/track-event.dto';
import { reportXlsx } from './report-xlsx';
import { reportCsv } from './report-utils';

@Controller('analytics')
export class AnalyticsController {
  private readonly rates = new Map<string, { count: number; until: number }>();
  constructor(private readonly analytics: AnalyticsService, private readonly tracking: TrackingService, private readonly config: ConfigService) {}

  @Get('reports/:report') @UseGuards(JwtAuthGuard) @Header('Cache-Control', 'private, no-store')
  report(@Param('report') report: string, @Query() query: ReportQueryDto, @Req() req: { user: { id: string; role: Role } }) {
    return this.analytics.report(report, query, req.user);
  }

  @Get('reports/:report/export') @UseGuards(JwtAuthGuard)
  async export(@Param('report') report: string, @Query() query: ReportQueryDto, @Req() req: { user: { id: string; role: Role } }, @Res() res: Response) {
    const data = await this.analytics.report(report, query, req.user);
    res.setHeader('Cache-Control', 'private, no-store');
    if (query.format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${data.report}-${data.start}-${data.end}.xlsx"`);
      return res.send(await reportXlsx(data));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${data.report}-${data.start}-${data.end}.csv"`);
    res.send('\uFEFF' + reportCsv(data));
  }

  @Post('events') @HttpCode(202)
  async track(@Body() dto: TrackEventDto, @Req() req: Request) {
    if (this.config.get('ANALYTICS_TRACKING_ENABLED', 'false') !== 'true') return { accepted: false };
    const allowed = this.config.get<string>('ANALYTICS_ALLOWED_ORIGINS', '').split(',').map(s => s.trim()).filter(Boolean);
    if (!req.headers.origin || !allowed.includes(req.headers.origin)) throw new HttpException('Tracking origin is not allowed', 403);
    // Bounded, per-instance abuse control; proxy-wide limiting belongs at the edge.
    const now = Date.now();
    for (const [key, value] of this.rates) if (value.until <= now) this.rates.delete(key);
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const rate = this.rates.get(key) || { count: 0, until: now + 60000 };
    if (rate.count >= 120 || (!this.rates.has(key) && this.rates.size >= 10000)) throw new HttpException('Too many tracking requests', 429);
    rate.count++;
    this.rates.set(key, rate);
    const geo: { country?: string; state?: string; city?: string } = {};
    // Enable only behind CloudFront with direct origin access blocked and these headers overwritten.
    if (this.config.get('ANALYTICS_TRUST_CLOUDFRONT_GEO', 'false') === 'true') {
      for (const [key, header] of Object.entries({ country: 'cloudfront-viewer-country', state: 'cloudfront-viewer-country-region-name', city: 'cloudfront-viewer-city' })) {
        const value = req.headers[header];
        if (typeof value === 'string') {
          try { geo[key as keyof typeof geo] = decodeURIComponent(value).replace(/[\x00-\x1f]/g, '').slice(0, 100); } catch { /* Invalid geo remains unknown. */ }
        }
      }
    }
    return this.tracking.record(dto, geo);
  }
}
