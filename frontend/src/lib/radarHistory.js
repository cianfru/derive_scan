// Radar history: the daily closes of radar.json, then the live reading as the last step.
// Per coin and step: z (the engine's daily stretch), w (the Smart wallets' delta balance) and the
// engine's saved reading. A map frame needs both z and w; a missing close is null and is never bridged.
import { viewReading } from "./presentation.js";

export const TRAIL = 7;    // closes drawn behind each circle
export const REPLAY = 30;  // closes the player spans
export const FLAG_ROLL = 1;      // bit 0: expiries left or entered the window at that close
export const FLAG_MODELLED = 2;  // bit 1: delta modelled from trade prices, not recorded quotes
const ENGINE = { u: "up", d: "defensive", n: "neutral" };
const EPS = 1e-6;

export function decodeFlags(flags) {
  const f = Number.isInteger(flags) ? flags : 0;
  return { roll: (f & FLAG_ROLL) !== 0, modelled: (f & FLAG_MODELLED) !== 0 };
}

/** The engine's saved reading at close k of a radar.json coin: up, defensive, neutral, or null. */
export function engineAt(coin, k) {
  return ENGINE[coin?.e?.[k]] || null;
}

const num = (v) => (Number.isFinite(v) ? v : null);
const wallet = (v) => (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? { y: v[0], gross: v[1], ...decodeFlags(v[2]) } : null);

/**
 * steps: the last REPLAY close times, then `now`. frames: und -> one map frame per step
 * ({x, y, gross, roll, modelled, engine} or null), the live radarPoint last. series: und -> {z, w,
 * engine} per step for the rail history and the strip. Null without a usable radar.json.
 * coins (optional): markets.json coins, for the live stretch of coins that are not on the map.
 * now: the reading clock, as for radarPoint.
 */
export function radarFrames(hist, livePoints = [], horizon = "30d", now = Date.now() / 1000, coins = []) {
  if (!hist || hist.version !== 1 || !Array.isArray(hist.closes) || !hist.closes.length) return null;
  const n = Math.min(REPLAY, hist.closes.length);
  const from = hist.closes.length - n;
  const lastClose = hist.closes[hist.closes.length - 1];
  const steps = [...hist.closes.slice(from), Math.max(now, lastClose)];
  // radar.json behind by more than a close: the live step is not joined to the closes before it.
  const brk = now - lastClose > 2 * 86400;
  const live = new Map(livePoints.map((p) => [p.coin.und, p]));
  const byUnd = new Map(coins.map((c) => [c.und, c]));
  for (const p of livePoints) if (!byUnd.has(p.coin.und)) byUnd.set(p.coin.und, p.coin);
  const frames = new Map(), series = new Map();
  for (const und of new Set([...Object.keys(hist.coins || {}), ...byUnd.keys()])) {
    const c = hist.coins?.[und] || {};
    const ws = c.w?.[horizon] || [];
    const z = [], w = [], e = [], row = [];
    for (let k = from; k < hist.closes.length; k++) {
      const zk = num(c.z?.[k]), wk = wallet(ws[k]), engine = engineAt(c, k);
      z.push(zk); w.push(wk); e.push(engine);
      row.push(zk != null && wk ? { x: zk, y: wk.y, gross: wk.gross, roll: wk.roll, modelled: wk.modelled, engine } : null);
    }
    const coin = byUnd.get(und), p = live.get(und);
    const engineNow = coin ? viewReading(coin.align, "30d", "engine", now).state || null : null;
    const wNow = p ? { y: p.y, gross: p.gross } : null;
    z.push(p ? p.x : engineNow && Number.isFinite(coin?.z_1d) ? coin.z_1d : null);
    e.push(engineNow);
    w.push(wNow ? { y: wNow.y, gross: wNow.gross, roll: false, modelled: false, live: true, brk } : null);
    row.push(p ? { x: p.x, y: p.y, gross: p.gross, positions: p.positions, roll: false, modelled: false, engine: engineNow, live: true, brk } : null);
    series.set(und, { z, w, engine: e });
    if (row.some(Boolean)) frames.set(und, row);
  }
  return { steps, last: steps.length - 1, frames, series, brk };
}

const linked = (a, b) => Boolean(a && b && !b.brk);

/**
 * The frame at fractional step t: interpolated between two linked closes; otherwise the nearer
 * close's own frame, or null where that close is missing. A frame on a whole close carries `at`.
 */
export function frameAt(row, t) {
  if (!row?.length) return null;
  const tt = Math.max(0, Math.min(row.length - 1, t));
  const k = Math.min(row.length - 1, Math.floor(tt + EPS)), f = tt - k;
  const a = row[k], b = row[k + 1];
  if (f < EPS || !b) return f < 0.5 + EPS && a ? { ...a, at: k } : null;
  if (!linked(a, b)) {
    const near = f < 0.5 ? k : k + 1;
    return row[near] ? { ...row[near], at: near } : null;
  }
  return {
    x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, gross: a.gross + (b.gross - a.gross) * f,
    roll: b.roll, modelled: a.modelled || b.modelled, engine: f < 0.5 ? a.engine : b.engine,
  };
}

/**
 * The trail behind step t: the head, then up to `len` whole closes behind it, oldest first, each
 * with its step index i. It stops at the first missing or unlinked close: gaps are never bridged.
 */
export function trailAt(row, t, len = TRAIL) {
  const head = frameAt(row, t);
  if (!head) return [];
  const onClose = head.at != null;
  let i = onClose ? head.at - 1 : Math.floor(t + EPS);
  const lo = Math.max(0, i - len + 1);
  let after = onClose ? row[head.at] : head;
  const pts = [{ ...head, i: onClose ? head.at : t, head: true }];
  for (; i >= lo; i--) {
    if (!linked(row[i], after)) break;
    pts.unshift({ ...row[i], i });
    after = row[i];
  }
  return pts;
}

/** The value of a per-step series at the nearest close (the player's readout date). */
export function nearest(values, t) {
  return values?.[Math.max(0, Math.min((values?.length || 1) - 1, Math.round(t)))] ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A close's date, UTC: the day its bar covered ("2 Oct" for the close at 3 Oct 00:00). */
export function closeLabel(ts) {
  const d = new Date((ts - 1) * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
