import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

export class ReportQueryDto {
  @IsOptional() @IsIn(['csv', 'xlsx']) format?: 'csv' | 'xlsx';
  @Matches(/^\d{4}-\d{2}-\d{2}$/) start: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) end: string;
  @IsOptional() @IsIn(['day', 'week', 'month']) groupBy?: 'day' | 'week' | 'month';
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() eventId?: string;
}
