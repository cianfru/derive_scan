// Daily option readings over time, from site-data surface/{UND}.json (version 1) plus the newest snapshot.
// Value i of every published array belongs to the UTC day day0 + i * 86400; null is a gap and stays one.
// "traded": readings rebuilt from that day's traded options (5-day median). "recorded": daily medians of
// the recorded 15-minute quotes. The two are kept apart everywhere and are never joined into one path.

export const DAY = 86400;
export const MOVE_FACTOR = Math.sqrt(30 / 365);
const ok = (v) => v != null && Number.isFinite(v);

/** The 30-day priced move as a share of the index: annualised 30-day ATM IV x sqrt(30/365). */
export const movePct = (atm) => (ok(atm) && atm > 0 ? atm * MOVE_FACTOR : null);
/** 7-day minus 30-day ATM IV. Above zero: the week is priced higher than the month. */
export const termSpread = (atm7, atm30) => (ok(atm7) && ok(atm30) ? atm7 - atm30 : null);

/** The published file as timestamps and aligned arrays, or null when it holds no shown reading. */
export function decodeSurface(doc) {
  if (!doc || doc.status !== "ready" || !Number.isFinite(doc.day0) || !(doc.days > 0)) return null;
  const n = doc.days;
  const days = Array.from({ length: n }, (_, i) => doc.day0 + i * DAY);
  const traded = {};
  for (const [m, values] of Object.entries(doc.traded || {})) if (Array.isArray(values)) traded[m] = days.map((_, i) => (ok(values[i]) ? values[i] : null));
  const recorded = {};
  const from = doc.recorded && Number.isInteger(doc.recorded.from) ? doc.recorded.from : null;
  if (from != null) {
    for (const [m, values] of Object.entries(doc.recorded)) {
      if (m === "from" || !Array.isArray(values) || !traded[m]) continue;
      recorded[m] = days.map((_, i) => (i >= from && ok(values[i - from]) ? values[i - from] : null));
    }
  }
  return { und: doc.und, days, traded, recorded, recordedFrom: from, range: doc.range_1y || {}, overlap: doc.overlap || {}, firstTradeDay: doc.first_trade_day };
}

/** [[t, v]] pairs from a day axis and values, mapped (null stays null). */
export const pairs = (days, values, map = (v) => v) => days.map((t, i) => [t, values?.[i] == null ? null : map(values[i])]);
const combine = (a, b, f) => a && b ? a.map((v, i) => f(v, b[i])) : null;

/** Points within the window ending at `end`: "3M" (91 days), "1Y" (365 days) or "All". */
export const WINDOWS = { "3M": 91 * DAY, "1Y": 365 * DAY, All: Infinity };
export function windowSlice(points, win, end) {
  const span = WINDOWS[win] ?? Infinity;
  if (!Array.isArray(points) || span === Infinity) return points || [];
  return points.filter(([t]) => t >= end - span);
}

/** Runs of consecutive non-null points: each run is drawn as its own subpath, so gaps stay gaps. */
export function segments(points) {
  const runs = [];
  let run = null;
  for (const p of points || []) {
    if (p[1] == null || !Number.isFinite(p[1])) { run = null; continue; }
    if (!run) runs.push((run = []));
    run.push(p);
  }
  return runs;
}

/** SVG path data, one "M" per run; a run of one point is a zero-length stroke (a round cap shows it). */
export function pathData(points, X, Y) {
  return segments(points).map((run) => {
    const xy = run.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`);
    return `M${xy[0]}${xy.length > 1 ? `L${xy.slice(1).join("L")}` : `L${xy[0]}`}`;
  }).join("");
}

function percentile(sorted, q) {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
/** The past year of a traded series ({p10, p50, p90, last, pct}), as the publisher computes range_1y:
 * the last 365 days, at least 60 values, pct = share of values below the newest one (0-100). */
export function rangeOf(values, window = 365, enough = 60) {
  const series = (values || []).slice(-window).filter(ok);
  const last = [...(values || [])].reverse().find(ok);
  if (series.length < enough || last == null) return null;
  const sorted = [...series].sort((a, b) => a - b);
  return { p10: percentile(sorted, 0.1), p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), last,
    pct: Math.round((1000 * series.filter((v) => v < last).length) / series.length) / 10 };
}

export function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${s}`;
}
/** "1Y: 5th pct": where the newest traded reading sits in its past year (kept between 1st and 99th).
 * A history shorter than a year names its span instead ("8M"), since the rank covers only that. */
export function rankLabel(range, days = 365) {
  if (!range || !Number.isFinite(range.pct)) return null;
  const span = days >= 365 ? "1Y" : `${Math.max(1, Math.round(days / 30.44))}M`;
  return `${span}: ${ordinal(Math.min(99, Math.max(1, Math.round(range.pct))))} pct`;
}

/** Recorded 15-minute snapshots as [[t, v]], with a gap wherever recording paused for over an hour. */
export function snapshotPoints(hist, col, map = (v) => v) {
  const out = [];
  let prev = null;
  for (const h of hist || []) {
    if (prev != null && h[0] - prev > 3600) out.push([prev + 1, null]);
    out.push([h[0], ok(h[col]) ? map(h[col]) : null]);
    prev = h[0];
  }
  return out;
}

const pts = (v) => Math.abs(v * 100).toFixed(1);
export const FORMAT = {
  move: (v) => `±${(v * 100).toFixed(1)}%`,
  skew: (v) => (Math.abs(v) < 0.0005 ? "Even pricing" : `${v < 0 ? "Puts" : "Calls"} richer ${pts(v)} pts`),
  term: (v) => `7d−30d ${v > 0.0005 ? "+" : v < -0.0005 ? "−" : ""}${pts(v)} pts`,
  iv: (v) => `${(v * 100).toFixed(1)}%`,
};

/** The three dashboard strips. With a surface file: the traded history (thin), the recorded daily medians
 * (thick), the newest snapshot (dot), the past-year band and rank. Without one: the recorded 15-minute
 * snapshots alone, once they span two days. A strip whose reading is missing is left out (null). */
export function dashboardStrips(surface, opts) {
  const f = opts?.features || {}, at = opts?.ts;
  const latest = (v) => (ok(v) && ok(at) ? [at, v] : null);
  const out = { move: null, skew: null, term: null };
  const hist = opts?.iv_history || [];
  const span = hist.length ? hist[hist.length - 1][0] - hist[0][0] : 0;
  const fallback = (col, map) => (span >= 2 * DAY ? { traded: [], recorded: snapshotPoints(hist, col, map), latest: null, band: null, rank: null, snapshots: true } : null);
  const s = surface;
  const T = s?.traded || {}, R = s?.recorded || {};
  if (T.atm30) {
    const r = s.range.atm30;
    out.move = { traded: pairs(s.days, T.atm30, movePct), recorded: pairs(s.days, R.atm30, movePct), latest: latest(movePct(f.atm_iv_30d)),
      band: r ? [movePct(r.p10), movePct(r.p90)] : null, rank: rankLabel(r, s.days.length) };
  } else out.move = fallback(2, movePct);
  if (T.rr30) {
    out.skew = { traded: pairs(s.days, T.rr30), recorded: pairs(s.days, R.rr30), latest: latest(f.rr25_30d), band: null, rank: rankLabel(s.range.rr30, s.days.length) };
  } else out.skew = fallback(4);
  if (T.atm7 && T.atm30) {
    const spread = combine(T.atm7, T.atm30, termSpread);
    const r = rangeOf(spread);
    out.term = { traded: pairs(s.days, spread), recorded: pairs(s.days, combine(R.atm7, R.atm30, termSpread)),
      latest: latest(termSpread(f.atm_iv_7d, f.atm_iv_30d)), band: r ? [r.p10, r.p90] : null, rank: rankLabel(r, s.days.length) };
  } else {
    const t = fallback(1);
    out.term = t && { ...t, recorded: hist.length ? snapshotPoints(hist.map((h) => [h[0], termSpread(h[1], h[2])]), 1) : [] };
  }
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v && !segments(v.traded).length && !segments(v.recorded).length) out[k] = null;
  }
  return out;
}

export const TENORS = [["atm7", "7d", "var(--tenor-7)"], ["atm30", "30d", "var(--fg)"], ["atm90", "90d", "var(--tenor-90)"]];
export const SNAPSHOT_KEY = { atm7: "atm_iv_7d", atm30: "atm_iv_30d", atm90: "atm_iv_90d", rr30: "rr25_30d" };

/** Left edge for an in-plot label w px wide between yTop and yBot that no plotted point touches: the left
 * end first, then the right end (left of the dot); null when both are taken (the label is then left out). */
export function freeSpot(points, X, Y, w, yTop, yBot, left, right) {
  const clash = (a, b) => points.some(([t, v]) => v != null && Number.isFinite(v) && X(t) >= a - 3 && X(t) <= b + 3 && Y(v) >= yTop - 2 && Y(v) <= yBot + 2);
  if (!clash(left, left + w)) return left;
  if (!clash(right - w, right)) return right - w;
  return null;
}
