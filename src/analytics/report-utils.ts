import { BadRequestException } from '@nestjs/common';
import { ReportQueryDto } from './dto/report-query.dto';

export const REPORTS = ['registrations', 'event-creation', 'organizer-adoption', 'ticket-sales', 'revenue'] as const;
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
export function reportCsv(report: { report: string; timezone: string; start: string; end: string; organizationId: string | null; eventId: string | null; columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; previousRows: Record<string, unknown>[] }) {
  const metadata = [report.report, report.timezone, report.start, report.end, report.organizationId, report.eventId];
  const headers = ['Report', 'Timezone', 'Selected start', 'Selected end', 'Organization filter', 'Event filter', 'Period', 'Bucket', 'Currency', ...report.columns.map(c => c.label)];
  return [headers.map(csvCell).join(','), ...[['current', report.rows], ['previous', report.previousRows]].flatMap(([period, rows]) =>
    (rows as Record<string, unknown>[]).map(row => [...metadata, period, row.bucket, row.currency, ...report.columns.map(c => row[c.key])].map(csvCell).join(','))
  )].join('\r\n');
}
