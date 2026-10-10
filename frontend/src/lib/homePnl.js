// The home card's P&L (owner, 10 October 2026: "show a number ... it can be a percentage ... if no
// position is open, say no positions open"): open positions valued as Positions values them, at
// Derive's published sell-back price after fees, as one percentage of what was paid for them.
import { closeTicket, findLevel, priceAge } from "./questions.js";
import { openPart, partial, positionFigures } from "./positions.js";

/** {open, priced, pl, paid, pct} over this browser's open positions; pct is null while none is valued. */
export function openPnl(list, boards, now = Date.now() / 1000) {
  const open = (list || []).filter((p) => !p.closed_at && !(p.settle_ts > 0 && now >= p.settle_ts));
  let pl = 0, paid = 0, priced = 0;
  for (const p of open) {
    const board = boards[p.und];
    if (!board || partial(p) || priceAge(board.prices_ts, now, board.paused).state === "paused") continue;
    const found = findLevel(board, p.id);
    if (!found || found.settled) continue;
    const op = openPart(p);
    const t = closeTicket(found.level, p.side, op.contracts, board, p.legs);
    const f = positionFigures(op, { found, close: t, index: board.index });
    if (!Number.isFinite(f.plNow) || !(f.paid > 0)) continue;
    pl += f.plNow; paid += f.paid; priced += 1;
  }
  return { open: open.length, priced, pl, paid, pct: priced ? pl / paid : null };
}

/** "+12.4%" / "−3.0%". */
export const pctText = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
