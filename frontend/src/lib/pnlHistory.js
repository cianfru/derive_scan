// A trader's P&L history (traders/{address}.json pnl_history: [[day, cumulative gross options P&L,
// cumulative premium traded]]), cut to a range and read at any day. P&L moves only on settlement days.

const DAY = 86400;
export const RANGES = [["30d", "30D", 30], ["90d", "90D", 90], ["1y", "1Y", 365], ["all", "All", null]];

const ts = (day) => Date.parse(`${day}T00:00:00Z`) / 1000;

/** The points of one range, each {t, day, pnl, prem}, from its start (carrying the value it had then)
 * to `through`, plus the range's base (the value at its start). Null without history. */
export function rangeSeries(history, through, days) {
  const rows = (history || []).map(([day, pnl, prem]) => ({ t: ts(day), day, pnl, prem }));
  if (!rows.length) return null;
  const end = through ? Math.max(ts(through), rows[rows.length - 1].t) : rows[rows.length - 1].t;
  const start = days == null ? rows[0].t : Math.max(rows[0].t, end - days * DAY);
  const before = rows.filter((r) => r.t <= start);
  const base = before.length ? before[before.length - 1] : { pnl: 0, prem: 0 };
  const points = [{ t: start, day: isoDay(start), pnl: base.pnl, prem: base.prem },
    ...rows.filter((r) => r.t > start && r.t <= end)];
  const last = points[points.length - 1];
  if (last.t < end) points.push({ t: end, day: isoDay(end), pnl: last.pnl, prem: last.prem });
  return { points, base: { pnl: base.pnl, prem: base.prem }, start, end };
}

/** The reading at a point: cumulative P&L to that day and the change since the range's start, in dollars
 * and as a return on the premium bought and sold on the options that settled in between. */
export function readingAt(series, point) {
  const change = point.pnl - series.base.pnl;
  const premium = point.prem - series.base.prem;
  return { day: point.day, total: point.pnl, change, ret: premium > 0 ? change / premium : null };
}

/** The index of the last point at or before time t (P&L holds between settlement days). */
export function pointAt(series, t) {
  let i = 0;
  while (i + 1 < series.points.length && series.points[i + 1].t <= t) i += 1;
  return i;
}

function isoDay(t) {
  return new Date(t * 1000).toISOString().slice(0, 10);
}
