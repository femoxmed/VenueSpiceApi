import { BadRequestException } from '@nestjs/common';
import { ReportQueryDto } from './dto/report-query.dto';

export const REPORTS = ['registrations', 'event-creation', 'organizer-adoption', 'ticket-sales', 'revenue', 'website-traffic', 'user-engagement', 'checkout-conversion', 'traffic-source', 'event-status', 'event-performance', 'payment-refund', 'promoter-referral', 'geographic', 'user-retention'] as const;
export type ReportName = typeof REPORTS[number];
export function reportPeriod(query: ReportQueryDto) {
  const parse = (value: string) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Use valid YYYY-MM-DD dates');
    }
    return date;
  };
  const start = parse(query.start);
  const end = new Date(parse(query.end).getTime() + 86400000);
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration > 366 * 86400000) throw new BadRequestException('Choose a reporting period of 1–366 days');
  if (query.groupBy && !['day', 'week', 'month'].includes(query.groupBy)) throw new BadRequestException('Invalid grouping');
  return { start, end, previousStart: new Date(start.getTime() - duration), groupBy: query.groupBy || 'day' };
}
export function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${(typeof value === 'string' && /^[\s]*[=+\-@]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
}
export type ExportReport = {
  report: string; timezone: string; start: string; end: string; organizationId: string | null; eventId: string | null;
  definition?: string; generatedAt?: string; coverage?: { firstObservedAt: string | Date | null; retentionDays: number } | null;
  columns: {key:string;label:string;unit?:string}[]; dimensions?: {key:string;label:string}[];
  rows: Record<string,unknown>[]; previousRows: Record<string,unknown>[];
  totals?: Record<string,unknown>[]; previousTotals?: Record<string,unknown>[];
  breakdown?: Record<string,unknown>[]; previousBreakdown?: Record<string,unknown>[];
};
export function exportTable(report: ExportReport) {
  const metadata = [report.report, report.timezone, report.start, report.end, report.organizationId, report.eventId, report.definition, report.generatedAt, report.coverage?.firstObservedAt instanceof Date ? report.coverage.firstObservedAt.toISOString() : report.coverage?.firstObservedAt, report.coverage?.retentionDays];
  const dims = report.dimensions || [];
  const headers = ['Report', 'Timezone', 'Selected start', 'Selected end', 'Organization filter', 'Event filter', 'Definition', 'Generated at', 'First retained tracking activity', 'Tracking retention days', 'Period', 'Row type', 'Bucket', 'Currency', ...dims.map(d=>d.label), ...report.columns.map(c => `${c.label}${c.unit === 'percent' ? ' (%)' : c.unit === 'seconds' ? ' (seconds)' : ''}`)];
  const groups: [string,string,Record<string,unknown>[]][] = [
    ['current','bucket',report.rows],['current','total',report.totals || []],['current','breakdown',report.breakdown || []],
    ['previous','bucket',report.previousRows],['previous','total',report.previousTotals || []],['previous','breakdown',report.previousBreakdown || []],
  ];
  return { headers, rows: groups.flatMap(([period,kind,rows]) => rows.map(row => [...metadata,period,kind,row.bucket,row.currency,...dims.map(d=>row[d.key]),...report.columns.map(c=>row[c.key])])) };
}
export function reportCsv(report: ExportReport) {
  const {headers,rows} = exportTable(report);
  return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
