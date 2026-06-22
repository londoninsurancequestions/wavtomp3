import { ensureAnonId } from './free-tier.js';
import { dbAll, dbRun, isPostgres } from './store.js';

export const FUNNEL_EVENT_TYPES = [
  'visit',
  'conversion',
  'limit_modal_shown',
  'modal_closed',
  'stripe_checkout',
  'paid_signup',
];

export function resolveVisitorKey(req, res, userId = null) {
  if (userId) return `user:${userId}`;
  return `anon:${ensureAnonId(req, res)}`;
}

export async function logFunnelEvent(req, res, eventType, { userId = null, meta = null } = {}) {
  if (!FUNNEL_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Invalid funnel event: ${eventType}`);
  }

  const visitorKey = resolveVisitorKey(req, res, userId);
  const metaJson = meta ? JSON.stringify(meta) : null;

  await dbRun(
    'INSERT INTO funnel_events (visitor_key, event_type, meta) VALUES (?, ?, ?)',
    [visitorKey, eventType, metaJson]
  );
}

function periodClause(period) {
  if (!period || period === 'all') return { sql: '', params: [] };

  const days = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : null;
  if (!days) return { sql: '', params: [] };

  if (period === 'today') {
    if (isPostgres()) {
      return { sql: ' AND created_at::date = CURRENT_DATE', params: [] };
    }
    return { sql: " AND date(created_at) = date('now')", params: [] };
  }

  if (isPostgres()) {
    return { sql: ` AND created_at >= NOW() - INTERVAL '${days} days'`, params: [] };
  }
  return { sql: " AND created_at >= datetime('now', ?)", params: [`-${days} days`] };
}

export async function getFunnelStats({ period = 'all' } = {}) {
  const { sql: periodSql, params: periodParams } = periodClause(period);

  const counts = {};
  for (const eventType of FUNNEL_EVENT_TYPES) {
    const row = await dbAll(
      `SELECT COUNT(DISTINCT visitor_key) AS n
       FROM funnel_events
       WHERE event_type = ?${periodSql}`,
      [eventType, ...periodParams]
    );
    counts[eventType] = Number(row[0]?.n ?? 0);
  }

  const steps = [
    { key: 'visit', label: 'Visitors' },
    { key: 'conversion', label: 'Converted files' },
    { key: 'limit_modal_shown', label: 'Hit limit & saw modal' },
    { key: 'modal_closed', label: 'Closed modal' },
    { key: 'stripe_checkout', label: 'Proceeded to Stripe' },
    { key: 'paid_signup', label: 'Paid signups' },
  ].map((step, index, arr) => {
    const count = counts[step.key] ?? 0;
    const prevCount = index > 0 ? (counts[arr[index - 1].key] ?? 0) : null;
    const fromVisitors = counts.visit > 0 ? count / counts.visit : null;
    const fromPrevious = prevCount > 0 ? count / prevCount : null;
    return {
      ...step,
      count,
      fromVisitors,
      fromPrevious,
    };
  });

  let dailySql;
  const dailyParams = [];
  if (isPostgres()) {
    dailySql = `
      SELECT created_at::date AS day, event_type, COUNT(DISTINCT visitor_key) AS visitors
      FROM funnel_events
      WHERE created_at >= CURRENT_DATE - INTERVAL '13 days'
      GROUP BY day, event_type
      ORDER BY day ASC`;
  } else {
    dailySql = `
      SELECT date(created_at) AS day, event_type, COUNT(DISTINCT visitor_key) AS visitors
      FROM funnel_events
      WHERE created_at >= datetime('now', '-13 days')
      GROUP BY day, event_type
      ORDER BY day ASC`;
  }

  const dailyRows = await dbAll(dailySql, dailyParams);
  const daily = {};
  for (const row of dailyRows) {
    const day = String(row.day).slice(0, 10);
    if (!daily[day]) daily[day] = {};
    daily[day][row.event_type] = Number(row.visitors ?? 0);
  }

  return {
    period,
    steps,
    totals: counts,
    daily: Object.entries(daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, events]) => ({ day, events })),
  };
}
