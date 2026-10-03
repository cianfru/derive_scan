const DAY = 86400;

export function orderedHistory(rows, now = Date.now() / 1000) {
  const byTime = new Map();
  for (const row of rows || []) {
    if (Number.isFinite(row?.ts) && row.ts >= 0 && row.ts <= now) byTime.set(row.ts, row);
  }
  return [...byTime.values()].sort((a, b) => a.ts - b.ts);
}

export function dailyHistory(rows, now = Date.now() / 1000, interval = 900) {
  const days = new Map();
  for (const row of orderedHistory(rows, now)) {
    const day = Math.floor(row.ts / DAY);
    const previous = days.get(day);
    days.set(day, { ...row, daily: true, day_samples: (previous?.day_samples || 0) + 1,
      day_expected: Math.round(DAY / interval),
      partial_day: day === Math.floor(now / DAY) });
  }
  return [...days.values()].map(row => ({ ...row,
    partial_day: row.partial_day || row.day_samples < row.day_expected }));
}

export function historyWindow(rows, window = "30d", now = Date.now() / 1000) {
  const from = window === "all" ? -Infinity : now - Number.parseInt(window, 10) * DAY;
  return orderedHistory(rows, now).filter(row => row.ts >= from);
}

export function historySource(row, fallback = "recorded") {
  return row?.source === "reconstructed" ? "reconstructed" : row?.source || fallback;
}

export function metricValue(row, metric) {
  return Number.isFinite(row?.[metric]) ? row[metric] : null;
}

export function nearestObservation(rows, timestamp) {
  if (!rows.length || !Number.isFinite(timestamp)) return -1;
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid].ts < timestamp) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && timestamp - rows[lo - 1].ts <= rows[lo].ts - timestamp ? lo - 1 : lo;
}

// Time is the horizontal axis. Missing values, collection gaps and changes in
// provenance start a new segment; neither interpolation nor smoothing fills them.
export function historyGeometry(rows, metric, width, height, cadence, { zero = false, bounds = null } = {}) {
  const valid = rows.filter(row => metricValue(row, metric) !== null);
  if (!rows.length || !valid.length) return null;
  const left = 66, right = 20, top = 16, bottom = 32;
  const from = rows[0].ts, to = rows.at(-1).ts;
  let low = Math.min(...valid.map(row => row[metric])), high = Math.max(...valid.map(row => row[metric]));
  if (bounds) [low, high] = bounds;
  else {
    if (zero) { low = Math.min(low, 0); high = Math.max(high, 0); }
    const pad = (high - low) * .12 || Math.abs(high) * .05 || .1;
    low -= pad; high += pad;
  }
  const x = ts => from === to ? (left + width - right) / 2 : left + (ts - from) / (to - from) * (width - left - right);
  const y = value => top + (high - value) / (high - low) * (height - top - bottom);
  const paths = {};
  let previous = null, gaps = 0;
  rows.forEach((row, i) => {
    if (i) gaps += Math.max(0, Math.round((row.ts - rows[i - 1].ts) / cadence) - 1);
    const value = metricValue(row, metric);
    if (value === null) { previous = null; return; }
    const source = historySource(row);
    const connected = previous && historySource(previous) === source && row.ts - previous.ts <= cadence * 1.5;
    paths[source] = (paths[source] || "") + `${connected ? " L" : " M"}${x(row.ts).toFixed(2)},${y(value).toFixed(2)}`;
    previous = row;
  });
  const adjacent = (a, b) => a && b && metricValue(a, metric) !== null && metricValue(b, metric) !== null && historySource(a) === historySource(b) && Math.abs(b.ts - a.ts) <= cadence * 1.5;
  const isolated = rows.filter((row, i) => metricValue(row, metric) !== null && !adjacent(row, rows[i - 1]) && !adjacent(row, rows[i + 1]));
  return { from, to, low, high, left, right, top, bottom, x, y, paths, valid,
    missing: rows.length - valid.length + gaps, gaps, isolated };
}
