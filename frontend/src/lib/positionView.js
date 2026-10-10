// One position as Positions shows it (pages/MyQuestions.jsx), shared with the home card's P&L
// (lib/homePnl.js), so both value the same records the same way.
import { ANSWER, closeTicket, findLevel, noPriceReason, parseId, priceAge, questionText } from "./questions.js";
import { incompleteReceipt, openPart, partial, positionFigures, positionStatus } from "./positions.js";
import { incompleteEntryReceipt, realized } from "./realized.js";
import { ONE_TAP_FILLS } from "./flags.js";

/** Positions' rule for a record that is no longer open: sold back, or past its saved settlement time
 * (a record with no settlement time counts as done, as on Positions). */
export const positionDone = (p, now = Date.now() / 1000) => !!p.closed_at || now >= (p.settle_ts || 0);

/**
 * Everything a position shows, from the board and the time: its figures, status, whether it can be
 * closed now and the sell-back ticket. Pure, so a group card can value all its positions from one
 * read of the board. `settle` is Derive's settlement price once published (null before).
 */
export function positionView(p, { board, now, scope, settle = null }) {
  const q = parseId(p.id);
  const found = board ? findLevel(board, p.id) : null;
  const settleTs = p.settle_ts || (q ? Date.UTC(+q.expiry.slice(0, 4), +q.expiry.slice(4, 6) - 1, +q.expiry.slice(6, 8), 8) / 1000 : 0);
  const after = now >= settleTs;
  const paused = board ? priceAge(board.prices_ts, now, board.paused).state === "paused" : true;
  const settling = (!after && now >= settleTs - 1800) || (after && settle == null);
  const half = partial(p);
  const oneTap = ONE_TAP_FILLS && p.exec === "rfq";
  const pendingReceipt = oneTap && incompleteReceipt(p);
  const pendingEntry = oneTap && incompleteEntryReceipt(p);
  const entryFeesUnknown = oneTap && !Number.isFinite(p.journal?.cost?.fees);
  const ownAccount = !!p.wallet && p.subaccount_id != null && p.subaccount_id === scope?.subaccountId
    && String(p.wallet).toLowerCase() === String(scope?.wallet || "").toLowerCase();
  // With no wallet connected, Close opens the panel's connect step (the panel itself refuses another
  // wallet's or account's position); once connected, only this wallet's account sells back.
  const canSell = oneTap && !half && (ownAccount || !scope?.wallet);
  const op = after || p.closed_at ? p : openPart(p);
  const t = found && !found.settled && !paused && !settling && !half && !p.closed_at
    ? closeTicket(found.level, p.side, op.contracts, board, p.legs) : null;
  const f = positionFigures(op, { found: paused ? null : found, settlePrice: settle, close: t, index: board?.index });
  const real = realized(p);
  const settleExit = pendingReceipt ? null : real.portions.find((x) => x.kind === "settle");
  const status = positionStatus(p, { settled: f.settled, settling });
  const reason = !found || paused ? "Prices are paused or this question is no longer on the board, so Derive's sell-back price is not shown."
    : f.otherLegs ? "Cowboy now builds this answer from other options than the ones you hold, so it has no sell-back price for yours. Sell back on Derive at its screen price."
      : settling ? "This date is settling: Derive averages the index from 07:30 to 08:00 UTC, and selling back has stopped."
        : noPriceReason(found.level, p.side, false);
  const partWhy = pendingReceipt
    ? "Derive's trade records are still being checked. Values and settlement need a complete fill."
    : "Cowboy prices the full answer only. With one option filled you hold that option alone; check it on Derive.";
  const showClose = oneTap ? canSell && !after && !settling && !p.closed_at && real.open > 0 : !!t;
  return {
    p, q, board, found, now, settleTs, after, settle, paused, settling, half, oneTap, pendingReceipt, pendingEntry, entryFeesUnknown,
    canSell, op, t, f, real, settleExit, status, reason, partWhy, showClose,
    name: ANSWER[p.side], question: q ? questionText(q.und, q, q.expiry) : p.question,
  };
}
