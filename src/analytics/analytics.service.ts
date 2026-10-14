import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { ReportQueryDto } from './dto/report-query.dto';
import { REPORTS, ReportName, reportPeriod } from './report-utils';

type Viewer = { id: string; role: Role };
const columns = {
  registrations: [{ key: 'registrations', label: 'New accounts' }],
  'event-creation': [{ key: 'events', label: 'Events created' }],
  'organizer-adoption': [{ key: 'registered', label: 'New organizers' }, { key: 'active', label: 'Active organizers' }, { key: 'published', label: 'Organizers with published events created in period' }],
  'ticket-sales': [{ key: 'orders', label: 'Confirmed orders' }, { key: 'paidTickets', label: 'Paid-price tickets' }, { key: 'freeTickets', label: 'Zero-price tickets' }, { key: 'tickets', label: 'Total tickets issued through checkout' }],
  revenue: [{ key: 'grossSales', label: 'Gross checkout sales' }, { key: 'buyerPaid', label: 'Buyer payments' }, { key: 'platformFees', label: 'Platform fees' }, { key: 'processingFees', label: 'Processing fees charged' }, { key: 'refunds', label: 'Completed refunds' }, { key: 'estimatedNetRevenue', label: 'Estimated platform revenue after refund allocation' }],
};
const definitions = {
  registrations: 'Accounts created during the period, including unverified accounts. Platform-wide; event/organizer attribution is unavailable.',
  'event-creation': 'Events counted by creation date, including drafts and cancelled events.',
  'organizer-adoption': 'Organizers are organizations of type organization. Active means created an event or received a confirmed order in the period. Published means currently published events created in the period; publication history is unavailable. Distinct organizer totals are calculated independently of chart buckets.',
  'ticket-sales': 'Confirmed checkout orders by paid date, including orders later refunded. Counts exclude merchandise. Paid/free classification uses the stored ticket unit price before order-level discounts. Refunds do not subtract historical ticket sales.',
  revenue: 'Confirmed checkout sales by paid date, including merchandise and orders later refunded. Completed refunds use completion date. Estimated platform revenue = platform fees minus the platform-fee share of refunds (refund amount / original buyer payment). Actual fee reversals, processor costs and disputes are not reconciled; this is not accounting profit.',
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DataSource) {}

  async authorize(report: ReportName, query: ReportQueryDto, user: Viewer) {
    const admin = [Role.ADMIN, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN].includes(user.role);
    if (report === 'registrations') {
      if (!admin) throw new ForbiddenException('Registration analytics are administrator-only');
      if (query.organizationId || query.eventId) throw new BadRequestException('Registration data has no event or organization attribution');
    }
    if (!admin) {
      if (!query.organizationId) throw new ForbiddenException('Select an organization you belong to');
      const allowed = await this.db.query(`SELECT o.id FROM organizations o WHERE o.id = $1 AND (o.owner_user_id = $2 OR EXISTS (SELECT 1 FROM organization_members m WHERE m.organization_id = o.id AND m.user_id = $2 AND m.status = 'active'))`, [query.organizationId, user.id]);
      if (!allowed.length) throw new ForbiddenException('You cannot access this organization');
    }
    if (query.eventId) {
      const events = await this.db.query(`SELECT id FROM events WHERE id = $1 AND ($2::uuid IS NULL OR "organizationId" = $2)`, [query.eventId, query.organizationId || null]);
      if (!events.length) throw new BadRequestException('Event does not belong to the selected organization');
    }
  }

  async report(name: string, query: ReportQueryDto, user: Viewer) {
    if (!(REPORTS as readonly string[]).includes(name)) throw new BadRequestException('Unknown report');
    const report = name as ReportName;
    const period = reportPeriod(query);
    await this.authorize(report, query, user);
    const [current, previous] = await Promise.all([
      this.aggregate(report, query, period.start, period.end, period.groupBy),
      this.aggregate(report, query, period.previousStart, period.start, period.groupBy),
    ]);
    return { report, timezone: 'UTC', start: query.start, end: query.end, groupBy: period.groupBy,
      organizationId: query.organizationId || null, eventId: query.eventId || null,
      previousStart: period.previousStart.toISOString().slice(0, 10), previousEnd: new Date(period.start.getTime() - 86400000).toISOString().slice(0, 10),
      definition: definitions[report], columns: columns[report], rows: current.rows, totals: current.totals,
      previousRows: previous.rows, previousTotals: previous.totals };
  }

  private async aggregate(report: ReportName, query: ReportQueryDto, start: Date, end: Date, group: string) {
    // All user input is parameterized. Raw names below match TypeORM's existing default join columns.
    const params = [start, end, query.organizationId || null, query.eventId || null, group];
    const scope = (alias: string) => `($3::uuid IS NULL OR ${alias}."organizationId" = $3) AND ($4::uuid IS NULL OR ${alias}.${alias === 'e' ? 'id' : '"eventId"'} = $4)`;
    let source: string;
    let measures: string;
    let money = false;
    if (report === 'registrations') {
      source = `SELECT created_at AS at, ''::text AS currency FROM users WHERE created_at >= $1 AND created_at < $2`;
      measures = `COUNT(*) AS registrations`;
    } else if (report === 'event-creation') {
      source = `SELECT e.created_at AS at, ''::text AS currency FROM events e WHERE e.created_at >= $1 AND e.created_at < $2 AND ${scope('e')}`;
      measures = `COUNT(*) AS events`;
    } else if (report === 'organizer-adoption') {
      source = `WITH eligible AS (SELECT o.id, o.created_at FROM organizations o WHERE o.type = 'organization' AND ($3::uuid IS NULL OR o.id = $3) AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM events e WHERE e.id = $4 AND e."organizationId" = o.id)))
      SELECT o.created_at AS at, ''::text AS currency, o.id, 'registered' AS kind FROM eligible o WHERE o.created_at >= $1 AND o.created_at < $2
      UNION ALL SELECT e.created_at, '', o.id, 'active' FROM events e JOIN eligible o ON o.id = e."organizationId" WHERE e.created_at >= $1 AND e.created_at < $2 AND ($4::uuid IS NULL OR e.id = $4)
      UNION ALL SELECT t.paid_at, '', o.id, 'active' FROM ticket_orders t JOIN eligible o ON o.id = t."organizationId" WHERE t.paid_at >= $1 AND t.paid_at < $2 AND t.status IN ('paid','refunded') AND ($4::uuid IS NULL OR t."eventId" = $4)
      UNION ALL SELECT e.created_at, '', o.id, 'published' FROM events e JOIN eligible o ON o.id = e."organizationId" WHERE e.status = 'published' AND e.created_at >= $1 AND e.created_at < $2 AND ($4::uuid IS NULL OR e.id = $4)`;
      measures = `COUNT(DISTINCT id) FILTER (WHERE kind = 'registered') AS registered, COUNT(DISTINCT id) FILTER (WHERE kind = 'active') AS active, COUNT(DISTINCT id) FILTER (WHERE kind = 'published') AS published`;
    } else if (report === 'ticket-sales') {
      source = `SELECT t.paid_at AS at, ''::text AS currency, t.id,
        COALESCE(i.paid,0) AS paid, COALESCE(i.free,0) AS free
        FROM ticket_orders t LEFT JOIN LATERAL (SELECT SUM(quantity) FILTER (WHERE unit_price > 0) AS paid, SUM(quantity) FILTER (WHERE unit_price = 0) AS free FROM ticket_order_items WHERE "orderId" = t.id) i ON true
        WHERE t.paid_at >= $1 AND t.paid_at < $2 AND t.status IN ('paid','refunded') AND ${scope('t')}`;
      measures = `COUNT(*) AS orders, COALESCE(SUM(paid),0) AS "paidTickets", COALESCE(SUM(free),0) AS "freeTickets", COALESCE(SUM(paid + free),0) AS tickets`;
    } else {
      money = true;
      source = `SELECT t.paid_at AS at, t.currency,
        COALESCE((t.fee_snapshot->>'grossSubtotal')::numeric,t.subtotal) AS gross,
        t.total AS buyer, t.platform_fee AS platform, t.processing_fee AS processing, 0::numeric AS refund, 0::numeric AS refund_fee
        FROM ticket_orders t WHERE t.paid_at >= $1 AND t.paid_at < $2 AND t.status IN ('paid','refunded') AND ${scope('t')}
        UNION ALL SELECT r.completed_at, r.currency, 0, 0, 0, 0, r.amount,
        CASE WHEN t.total > 0 THEN r.amount * t.platform_fee / t.total ELSE 0 END
        FROM refund_requests r JOIN ticket_orders t ON t.id = r.order_id::uuid
        WHERE r.status = 'succeeded' AND r.completed_at >= $1 AND r.completed_at < $2 AND ${scope('t')}`;
      measures = `COALESCE(SUM(gross),0) AS "grossSales", COALESCE(SUM(buyer),0) AS "buyerPaid", COALESCE(SUM(platform),0) AS "platformFees", COALESCE(SUM(processing),0) AS "processingFees", COALESCE(SUM(refund),0) AS refunds, COALESCE(SUM(platform - refund_fee),0) AS "estimatedNetRevenue"`;
    }
    // Typed bounds keep unused parameters valid for reports without organization filters.
    const sql = `WITH bounds AS (SELECT $1::timestamptz AS start, $2::timestamptz AS finish, $3::uuid AS org, $4::uuid AS event, $5::text AS grouping), source AS (${source}),
      aggregated AS (SELECT to_char(date_trunc($5, at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket, currency, ${measures} FROM source GROUP BY 1,2),
      totals AS (SELECT 'total'::text AS bucket, currency, ${measures} FROM source GROUP BY currency)
      SELECT 'row' AS kind, * FROM aggregated UNION ALL SELECT 'total' AS kind, * FROM totals ORDER BY bucket, currency`;
    const result = await this.db.query(sql, params);
    const keys = columns[report].map(c => c.key);
    const normalize = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'kind').map(([k,v]) => [k, keys.includes(k) ? Number(Number(v).toFixed(2)) : v]));
    const totals = result.filter((r: any) => r.kind === 'total').map(normalize);
    const rawRows = result.filter((r: any) => r.kind === 'row').map(normalize);
    const currencies: string[] = money ? totals.map((r: any) => r.currency) : [''];
    const zero = (bucket: string, currency: string) => ({ bucket, currency, ...Object.fromEntries(keys.map(k => [k, 0])) });
    if (!money && !totals.length) totals.push(zero('total', ''));
    const cursor = new Date(start);
    if (group === 'week') cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
    if (group === 'month') cursor.setUTCDate(1);
    const rows: Record<string, unknown>[] = [];
    const index = new Map(rawRows.map((r: any) => [`${r.bucket}:${r.currency}`, r]));
    while (cursor < end) {
      const bucket = cursor.toISOString().slice(0, 10);
      for (const currency of currencies) rows.push(index.get(`${bucket}:${currency}`) as Record<string, unknown> || zero(bucket, currency));
      if (group === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1); else cursor.setUTCDate(cursor.getUTCDate() + (group === 'week' ? 7 : 1));
    }
    return { rows, totals };
  }
}
