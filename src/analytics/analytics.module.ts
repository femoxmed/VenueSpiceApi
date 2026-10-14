import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { TrackingService } from './tracking.service';
@Module({ controllers: [AnalyticsController], providers: [AnalyticsService, TrackingService] })
export class AnalyticsModule {}
