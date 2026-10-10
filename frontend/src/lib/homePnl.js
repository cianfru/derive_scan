// The home card's P&L (owner, 10 October 2026: "show a number ... it can be a percentage ... if no
// position is open, say no positions open"): the open positions Positions counts, valued as its P&L
// valued them (positionView, then the same priced filter), as one percentage of what was paid for them.
import { pricedViews } from "./positionsPnl.js";
import { positionDone, positionView } from "./positionView.js";

/** {open, priced, pl, paid, pct} over this browser's open positions; pct is null while none is valued. */
export function openPnl(list, boards, now = Date.now() / 1000) {
  const open = (list || []).filter((p) => !positionDone(p, now));
  const priced = pricedViews(open.map((p) => positionView(p, { board: boards[p.und], now, scope: null })));
  const pl = priced.reduce((s, v) => s + v.f.plNow, 0);
  const paid = priced.reduce((s, v) => s + (v.f.paid || 0), 0);
  return { open: open.length, priced: priced.length, pl, paid, pct: priced.length && paid > 0 ? pl / paid : null };
}

/** "+12.4%" / "−3.0%". */
export const pctText = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
