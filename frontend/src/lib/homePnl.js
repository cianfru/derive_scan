// The home card's P&L (owner, 10 October 2026: "show a number ... it can be a percentage ... if no
// position is open, say no positions open"): the open positions Positions counts, valued as its P&L
// valued them (positionView, then the same priced filter), as one percentage of what was paid for them.
import { pricedViews } from "./positionsPnl.js";
import { positionDone, positionView } from "./positionView.js";

/**
 * {open, priced, pl, paid, pct, rows} over this browser's open positions; pct is null while none is valued.
 * rows (owner, 10 October 2026: "I want to see the position that I have right now and the P&L"): each open
 * position, largest paid first, as {key, und, side, k, expiry, pct}, pct null while it has no value now.
 */
export function openPnl(list, boards, now = Date.now() / 1000) {
  const open = (list || []).filter((p) => !positionDone(p, now));
  const views = open.map((p) => positionView(p, { board: boards[p.und], now, scope: null }));
  const priced = pricedViews(views);
  const pl = priced.reduce((s, v) => s + v.f.plNow, 0);
  const paid = priced.reduce((s, v) => s + (v.f.paid || 0), 0);
  const rows = views.map((v) => ({ key: v.p.key, und: v.p.und, side: v.p.side, k: v.q?.k ?? (v.p.lo + v.p.hi) / 2, expiry: v.q?.expiry || null,
    paid: Number(v.p.paid) || 0, pct: priced.includes(v) && v.f.paid > 0 ? v.f.plNow / v.f.paid : null }))
    .sort((a, b) => b.paid - a.paid);
  return { open: open.length, priced: priced.length, pl, paid, pct: priced.length && paid > 0 ? pl / paid : null, rows };
}

/** "+12.4%" / "−3.0%". */
export const pctText = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
