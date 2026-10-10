// Options flow as bubbles (owner, 10 October 2026: "is so much cool"): one bubble per coin, sized by the option
// money of the last 24 hours, placed left to right by how much of it went into trades that gain if the price
// rises (the Options layer's measure, `riseFall`). Pure, so the home card and the Flow page draw the same map.
import { usd } from "./format.js";
import { riseFall } from "./takeaway.js";
import { separate } from "./homeLayout.js";

/** Within this many points of an even split a coin reads as even (grey ring) rather than leaning one way. */
export const EVEN_BAND = 0.05;
export const leanOf = (share) => (share >= 0.5 + EVEN_BAND ? "up" : share <= 0.5 - EVEN_BAND ? "down" : "even");

/** Per coin with option money: {und, rise, fall, total, share, lean, split}, most money first. */
export function flowCoins(byCoin) {
  return Object.entries(byCoin || {}).map(([und, c]) => {
    const { rise, fall, total } = riseFall(c);
    const share = total > 0 ? rise / total : 0.5;
    return { und, rise, fall, total, share, lean: leanOf(share),
      split: { callsBought: c?.call?.buy_premium_usd || 0, putsSold: c?.put?.sell_premium_usd || 0,
        putsBought: c?.put?.buy_premium_usd || 0, callsSold: c?.call?.sell_premium_usd || 0 } };
  }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total || (a.und < b.und ? -1 : 1));
}

/** Which way a coin's option money points: {pct, word} ("63", "rise"), or null when about even. */
export function leanParts(c) {
  if (c.lean === "even") return null;
  const up = c.lean === "up";
  return { pct: Math.round((up ? c.share : 1 - c.share) * 100), word: up ? "rise" : "fall" };
}
/** "63% on a rise", "84% on a fall" or "about even". */
export function leanWords(c) {
  const p = leanParts(c);
  return p ? `${p.pct}% on a ${p.word}` : "about even";
}

export const BUBBLES = { axis: 20, gap: 2, lineH: 16 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The bubbles in pixels for a band {w, h}: the field above the axis words' row, x exact from the share (0 all on a
 * fall, 1 all on a rise), radius by the square root of the money, and each bubble moved up or down from the middle
 * line, largest first, to the nearest place where it touches none placed before; where that fails, all are pushed
 * apart up and down together, and else every bubble shrinks a step and they are placed again (never under 7px).
 * Money labels go to the right of a bubble, else its left, only where they cover no bubble and no other label,
 * for the `labels` largest coins. Returns {ph, mid, evenX, marks: [{...coin, x, y, r, label}]}, largest first.
 */
export function bubbleLayout(coins, { w, h, rMin = 10, rMax = 30, axis = BUBBLES.axis, labels = 4, label = (c) => usd(c.total), charW = 7.4 }) {
  const ph = Math.max(0, h - axis), mid = ph / 2;
  const list = [...coins].sort((a, b) => b.total - a.total);
  const max = list[0]?.total || 1;
  // The largest bubble fits the field's height and, in a narrow band, a seventh of its width.
  const R0 = Math.max(rMin, Math.min(rMax, mid - 2, w / 7));
  const clash = (ms) => ms.some((a, i) => ms.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + 1));
  let marks = [], pad = 0, X = () => 0;
  for (let scale = 1; scale >= 0.3; scale -= 0.075) {
    const lo = Math.max(7, rMin * scale), R = Math.max(lo, R0 * scale);
    pad = R0 + 3;
    X = (s) => pad + clamp(s, 0, 1) * Math.max(0, w - 2 * pad);
    marks = [];
    let forced = false;
    for (const c of list) {
      const r = lo + (R - lo) * Math.sqrt(Math.max(0, c.total) / max);
      const x = X(c.share);
      let at = null, least = Infinity, leastY = mid;
      for (let k = 0; k <= 2 * Math.ceil(mid) + 2; k++) {
        const y = mid + (k % 2 ? 1 : -1) * Math.ceil(k / 2);
        if (y - r < 0 || y + r > ph) continue;
        const over = marks.reduce((t, m) => t + Math.max(0, m.r + r + BUBBLES.gap - Math.hypot(m.x - x, m.y - y)), 0);
        if (over === 0) { at = y; break; }
        if (over < least) { least = over; leastY = y; }
      }
      if (at == null) forced = true;
      marks.push({ ...c, x, y: at ?? leastY, r });
    }
    if (!forced) break;
    // Placed one by one, the largest pins the middle; moved up and down together they may still all fit.
    const pts = marks.map((m) => ({ px: m.x, py: m.y, s: 2 * m.r + BUBBLES.gap, half: 0, y: m.share, m }));
    separate(pts, { top: 0, bottom: ph, mid, rounds: 200 });
    for (const p of pts) p.m.y = p.py;
    if (!clash(marks)) break;
  }
  const boxes = [];
  const touches = (b, m) => Math.hypot(clamp(m.x, b.l, b.r) - m.x, clamp(m.y, b.t, b.b) - m.y) < m.r + 1;
  marks.forEach((m, i) => {
    m.label = null;
    if (i >= labels) return;
    const text = label(m), lw = text.length * charW;
    for (const side of [1, -1]) {
      const l = side > 0 ? m.x + m.r + 5 : m.x - m.r - 5 - lw;
      const b = { l, r: l + lw, t: m.y - BUBBLES.lineH / 2, b: m.y + BUBBLES.lineH / 2 };
      if (b.l < 0 || b.r > w || b.t < 0 || b.b > ph) continue;
      if (marks.some((o) => touches(b, o)) || boxes.some((o) => !(b.r <= o.l || b.l >= o.r || b.b <= o.t || b.t >= o.b))) continue;
      boxes.push(b);
      m.label = { text, x: b.l, y: b.t, w: lw };
      break;
    }
  });
  return { ph, mid, evenX: X(0.5), marks };
}

/**
 * One coin's large trades through the day: x by time over the window, rise above the line and fall below
 * (by the money each trade put on either side), size by the money paid or collected. `trades` are stories
 * (lib/flowStories.js `groupTrades`) with `ts` in seconds; returns marks {..., px, py, s, half}.
 */
export function dayLayout(trades, { w, h, from, to, sMin = 10, sMax = 40 }) {
  const mid = h / 2, span = Math.max(1, to - from);
  const max = Math.max(1, ...trades.map((t) => t.money));
  const room = Math.max(sMin, Math.min(sMax, mid - 4));
  const pad = room / 2 + 2;
  return trades.map((t) => {
    const s = sMin + (room - sMin) * Math.sqrt(t.money / max);
    const half = t.side === "rise" ? 1 : -1;
    return { ...t, s, half, px: pad + clamp((t.ts - from) / span, 0, 1) * Math.max(0, w - 2 * pad), py: mid - half * (s / 2 + 3), y: t.money };
  });
}
