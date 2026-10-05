import { STALE_SEC } from "./questions.js";

// Journal J2 (issue #33): realized P/L and where it came from. Exits and settlement are kept as
// events on the position (`exits`), each with its own contracts, amounts, times and how each amount
// is known: entered by the user, estimated, or exact. A partial close leaves the rest open.
//
// Lot matching: each position is one entry lot. A realized portion of q contracts takes q/contracts
// of the entry premium, the entry fees and the entry mark (pro rata), so every term of a portion
// uses the same quantity; what is left stays open and unrealized. Fees are counted once: the entry
// fees as recorded apart from the premium, the exit fees as recorded apart from the proceeds.
//
// For a portion with entry premium E (before fees), exit proceeds X (before fees), Derive's package
// mark at entry Me and at exit Mx, and all fees F:
//   Realized P/L = X - E - F = (Mx - Me) - (E - Me) - (Mx - X) - F
// At settlement the gross payout S replaces X and Mx, and the exit cost drops out:
//   Realized P/L = (S - Me) - (E - Me) - F
// The net is accounting; the split against Derive's mark is a benchmark, never a cause. When a mark
// or a fee is missing or too far from the trade, the known net shows with what is missing instead.

const ok = Number.isFinite;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const r2 = (v) => Math.round(v * 100) / 100;

export const incompleteEntryReceipt = (p) => {
  if (p.exec !== "rfq") return false;
  const fill = p.journal?.fill;
  const legs = fill?.legs;
  if (fill?.complete === false || !Array.isArray(legs) || legs.length !== 2) return true;
  const [a, b] = legs;
  return legs.some((l) => !(l.qty > 0) || !ok(l.signed_qty))
    || a.signed_qty * b.signed_qty >= 0
    || Math.abs(a.qty - b.qty) > 1e-9 + 1e-6 * a.qty;
};

/** A one-tap entry or close whose full receipt is still being read. */
export const incompleteReceipt = (p) => incompleteEntryReceipt(p)
  || (p.exec === "rfq" && (p.exits || []).some((e) => e.via === "rfq" && e.complete === false));

/** Contracts still open after the recorded exits. */
export function remainingQty(p) {
  const out = sum((p.exits || []).map((e) => (ok(e.qty) ? e.qty : 0)));
  return Math.max(0, Number(((p.contracts || 0) - out).toFixed(8)));
}

/** A mark is a fair benchmark for a trade only when taken within the price slot's staleness window
 * (35 minutes) of a known trade time. */
export function markSuits(mark, tradeTs) {
  return !!mark && ok(mark.value) && ok(mark.ts) && ok(tradeTs) && Math.abs(mark.ts - tradeTs) <= STALE_SEC;
}

/** The exit event for a sell-back entered by the user. `gross` is what the options brought before
 * Derive's fees; `fees` the exit fees, entered (`feesKnown`) or estimated from Derive's schedule.
 * `mark` is the package mark at the time from the board (value for these contracts, its time). */
export function closeEvent({ qty, ts = null, savedTs, gross, fees, feesKnown, mark = null }) {
  const fee = ok(fees) ? fees : null;
  return {
    kind: "close", qty, ts: ok(ts) ? ts : null, saved_ts: savedTs,
    gross: ok(gross) ? gross : null, gross_basis: ok(gross) ? "entered" : "unknown",
    fees: fee, fees_basis: fee == null ? "unknown" : feesKnown ? "entered" : "estimated",
    net: ok(gross) && fee != null ? gross - fee : null,
    mark: mark && ok(mark.value) ? { value: mark.value, ts: mark.ts ?? null, source: mark.source || "Derive mark, Cowboy board" } : null,
  };
}

/** The settlement event: the gross payout of the contracts still open at Derive's settlement price
 * (`payout`, computed from the instruments held), with no exit fee (Derive's fee schedule lists none). */
export function settleEvent({ qty, settleTs, savedTs, settlePrice, payout }) {
  return {
    kind: "settle", qty, ts: settleTs ?? null, saved_ts: savedTs, settle_price: settlePrice,
    settle_source: "Derive settlement price", gross: payout, gross_basis: "exact",
    fees: 0, fees_basis: "none", net: payout, mark: null,
  };
}

/** A sell-back saved before J2 kept only what came back after fees: one exit of every contract,
 * its split unknown. */
export function legacyExit(p) {
  return { kind: "close", qty: p.contracts, ts: null, saved_ts: p.closed_at ?? null, gross: null, gross_basis: "unknown",
    fees: null, fees_basis: "unknown", net: ok(p.proceeds) ? p.proceeds : null, mark: null, migrated: true };
}

/** One realized portion's figures and its breakdown, or what is missing for one. */
export function realizedPortion(p, e) {
  const j = p.journal;
  const entryPending = incompleteEntryReceipt(p);
  const exitPending = e.complete === false || (incompleteReceipt(p) && e.kind === "settle");
  const f = p.contracts > 0 ? e.qty / p.contracts : 0;
  const c = j?.cost || null;
  const entryFill = j?.fill?.ts ?? null;
  // Entry: premium and fees apart (journal), or one total with fees inside (older records).
  const E = !entryPending && c && ok(c.premium) ? c.premium * f : null;
  const Fe = !entryPending && c && ok(c.fees) ? c.fees * f : null;
  const entryTotal = entryPending ? null : c ? (E != null && Fe != null ? E + Fe : null) : ok(p.paid) ? p.paid * f : null;
  const Fx = !exitPending && ok(e.fees) ? e.fees : null;
  const X = !exitPending && ok(e.gross) ? e.gross : null;
  const exitNet = exitPending ? null : ok(e.net) ? e.net : X != null && Fx != null ? X - Fx : null;
  const net = exitNet != null && entryTotal != null ? exitNet - entryTotal : null;
  // A package mark is for the whole answer: it does not value a lone option from a partial fill.
  const whole = p.exec !== "hand_partial" && !entryPending;
  const Me = whole && j?.mark && markSuits(j.mark, entryFill) ? j.mark.value * f : null;
  const settled = e.kind === "settle";
  const Mx = settled ? X : whole && !exitPending && markSuits(e.mark, e.ts) ? e.mark.value : null;
  const missing = [];
  if (E == null) missing.push(c ? "premium" : "split");
  if (c && Fe == null) missing.push("entry_fees");
  if (Me == null) missing.push(!whole ? "mark_partial" : !j?.mark ? "entry_mark" : "entry_mark_far");
  if (X == null) missing.push("exit_split");
  else if (!settled && Fx == null) missing.push("exit_fees");
  if (!settled && Mx == null) missing.push(e.mark ? "exit_mark_far" : "exit_mark");
  const basis = {
    premium: c ? "entered" : null,
    entry_fees: c ? c.fees_basis : null,
    exit: settled ? "exact" : e.gross_basis,
    exit_fees: e.fees_basis,
  };
  const estimated = basis.entry_fees === "estimated" || basis.exit_fees === "estimated";
  let parts = null;
  if (net != null && E != null && Me != null && X != null && Mx != null && Fe != null && Fx != null) {
    const F = Fe + Fx;
    parts = settled
      ? { value_change: X - Me, entry_vs_mark: E - Me, exit_vs_mark: null, fees: F }
      : { value_change: Mx - Me, entry_vs_mark: E - Me, exit_vs_mark: Mx - X, fees: F };
  }
  return { kind: e.kind, qty: e.qty, ts: e.ts, saved_ts: e.saved_ts, settle_price: e.settle_price ?? null,
    entry: { premium: E, fees: Fe, total: entryTotal, mark: Me }, exit: { gross: X, fees: Fx, net: exitNet, mark: Mx },
    net, parts, missing: entryPending || exitPending ? ["fill_pending"] : parts ? [] : missing, basis, estimated, migrated: !!e.migrated };
}

/** Every realized portion of a position and their total (null when any portion's net is unknown). */
export function realized(p) {
  const portions = (p.exits || []).map((e) => realizedPortion(p, e));
  const nets = portions.map((x) => x.net);
  return { portions, net: portions.length && nets.every(ok) ? sum(nets) : null, open: remainingQty(p) };
}

/**
 * The breakdown as shown, in cents, reconciled to the net: each part's contribution to the result
 * (value change counts for, costs and fees against), plus a rounding line when the rounded parts do
 * not add up to the rounded net.
 */
export function breakdownRows(x) {
  if (!x.parts) return null;
  const rows = [["value_change", r2(x.parts.value_change)], ["entry_vs_mark", r2(-x.parts.entry_vs_mark)]];
  if (x.parts.exit_vs_mark != null) rows.push(["exit_vs_mark", r2(-x.parts.exit_vs_mark)]);
  rows.push(["fees", r2(-x.parts.fees)]);
  const diff = r2(r2(x.net) - sum(rows.map(([, v]) => v)));
  if (Math.abs(diff) >= 0.005) rows.push(["rounding", diff]);
  return rows;
}

/** The Positions summary: total realized over every record, with counts. Portions with an unknown
 * net are counted apart and left out of the total. */
export function realizedSummary(list) {
  let total = 0, closes = 0, settles = 0, unknown = 0, estimated = 0, partialCloses = 0, wins = 0, losses = 0;
  for (const p of list || []) {
    const { portions, open } = realized(p);
    for (const x of portions) {
      if (x.kind === "settle") settles += 1; else closes += 1;
      if (x.kind === "close" && open > 0) partialCloses += 1;
      if (x.net == null) { unknown += 1; continue; }
      total += x.net;
      if (x.estimated) estimated += 1;
      if (x.net > 0.004) wins += 1; else if (x.net < -0.004) losses += 1;
    }
  }
  return { total, count: closes + settles, closes, settles, unknown, estimated, partialCloses, wins, losses };
}
