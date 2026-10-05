// Saloon stage 2, P6: a one-tap fill as a journal record. Everything about the fill comes from Derive
// (its trade history, or execute_quote's answer): fill time, legs, prices, fees and trade ids, kept as
// exact. Nothing is entered by the user. The board's estimate, Derive's mark from the board and the
// three readings are kept beside it as in the manual journal (lib/journal.js), never as the fill.
// Testnet records live under the testnet journal key, apart from mainnet; a mainnet build's one-tap
// records live under the mainnet key, beside the trades placed by hand.
import { captureContext, markBenchmark, settleBreakeven } from "../journal.js";
import { fullPay, parseId, questionText, ANSWER } from "../questions.js";
import { reconcileExits } from "../positions.js";
import { packageLegs } from "./package.js";
import { packageComplete } from "./fills.js";
import { NETWORK } from "./config.js";

const round = (v, d = 6) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const settleOf = (expiry) => Date.UTC(+expiry.slice(0, 4), +expiry.slice(4, 6) - 1, +expiry.slice(6, 8), 8) / 1000;

/** The Saloon answer an RFQ label names ("{question id}:{yes|no}", ":close" for a sell back). */
export function parseLabel(label) {
  const m = /^(.+-A-[\d_]+-[\d_]+):(yes|no)(:close)?$/.exec(label || "");
  if (!m || !parseId(m[1])) return null;
  return { id: m[1], side: m[2], close: !!m[3] };
}
export const buyLabel = (id, side) => `${id}:${side}`;
export const closeLabel = (id, side) => `${id}:${side}:close`;

/** The journal block of a one-tap buy, exact from Derive. */
export function exactJournal({ fill, id, side, network, settleTs, contracts, requested, board = null, level = null, markets = null, pricesTs = null, estimate = null, savedTs }) {
  const q = parseId(id);
  const lo = level?.lo ?? q.lo, hi = level?.hi ?? q.hi;
  const fees = Number.isFinite(fill.fees) ? fill.fees : null;
  const total = fees == null ? null : fill.premium + fees;
  const be = fill.complete === false || total == null ? null : settleBreakeven({ side, lo, hi, contracts, cost: total });
  return {
    schema: 1, source: "derive", venue: "Derive", network, entered_by_you: [], saved_ts: savedTs,
    package: {
      network, venue: "Derive", id, und: q.und, side, direction: ANSWER[side], expiry: q.expiry, settle_ts: settleTs,
      lo, hi, zone: fullPay({ lo, hi }, side), contracts: requested ?? contracts,
      legs: fill.legs.map((l) => ({ name: l.name, act: l.act, signed_qty: (l.act === "buy" ? 1 : -1) * (requested ?? contracts) })),
    },
    fill: {
      ts: fill.ts, mode: "legs", complete: fill.complete !== false, currency: "USDC", source: fill.source,
      legs: fill.legs.map((l) => ({ name: l.name, act: l.act, planned: l.planned ?? requested ?? contracts, qty: l.qty, signed_qty: l.signed_qty,
        price: l.price, fee: l.fee, trade_ids: l.trade_ids || [] })),
      premium: round(fill.premium), fees: fees == null ? null : round(fees), fees_known: fees != null, limitation: null,
      rfq_id: fill.rfq_id, quote_id: fill.quote_id, trade_ids: fill.trade_ids || [],
      filled_pct: fill.pct ?? 1, requested: requested ?? contracts,
    },
    cost: {
      premium: round(fill.premium), fees: fees == null ? null : round(fees), fees_basis: fees == null ? "unknown" : "exact",
      total: total == null ? null : round(total), breakeven: be == null ? null : round(be, 2),
      breakeven_basis: be == null ? "unavailable" : fees == null ? "before_fees" : "exact",
    },
    board_estimate: estimate,
    mark: level && board ? markBenchmark({ level, side, contracts, pricesTs, fillTs: fill.ts }) : null,
    context: markets ? captureContext({ markets, und: q.und, settleTs, fillTs: fill.ts, savedTs }) : null,
  };
}

/** A one-tap record's key: from its RFQ and the instruments it traded, so the same fill read twice
 * (a re-sync, another device, an import) is the same record, and two fills saved in the same instant
 * never share one. */
export function oneTapKey(fill) {
  const names = [...new Set((fill?.legs || []).map((l) => l.name))].sort();
  return fill?.rfq_id && names.length ? `rfq:${fill.rfq_id}:${names.join("+")}` : null;
}

/** A position record for addPosition from a one-tap buy (exec "rfq"). `requested` is the contracts
 * asked for; a part fill records what filled. `wallet` and `subaccountId` name the wallet and the
 * Derive account it was traded from: sync matches a record only against that account. */
export function buyRecord({ fill, id, side, network = NETWORK.name, requested = null, level = null, board = null, markets = null, pricesTs = null, estimate = null, question = null, savedTs, wallet = null, subaccountId = null }) {
  const q = parseId(id);
  if (!q || !fill?.legs?.length) return null;
  fill = { ...fill, complete: fill.complete !== false && matchesPackage(fill, id, side) };
  const contracts = fill.legs[0].qty;
  const settleTs = settleOf(q.expiry);
  const journal = exactJournal({ fill, id, side, network, settleTs, contracts, requested, board, level, markets, pricesTs, estimate, savedTs });
  return {
    id, und: q.und, side, lo: journal.package.lo, hi: journal.package.hi, contracts,
    paid: journal.cost.total, estimate: estimate?.total ?? null, exec: "rfq",
    legs: fill.legs.map((l) => l.name), question: question || questionText(q.und, q, q.expiry), answer: ANSWER[side],
    settle_ts: settleTs, v: 2, network, journal,
    ...(oneTapKey(fill) ? { key: oneTapKey(fill) } : {}),
    ...(wallet ? { wallet } : {}), ...(Number.isSafeInteger(subaccountId) ? { subaccount_id: subaccountId } : {}),
  };
}

const near = (a, b, tol = 1e-6) => (a == null && b == null) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol);

/** True when a saved fill (a journal's `fill`, or an exit) disagrees with Derive's: other legs, amounts,
 * prices, fees, premium or total fees. */
export function fillDiffers(saved, derive) {
  if (!near(saved?.ts ?? null, derive?.ts ?? null)) return true;
  const a = [...(saved?.legs || [])].sort((x, y) => (x.name < y.name ? -1 : 1));
  const b = [...(derive?.legs || [])].sort((x, y) => (x.name < y.name ? -1 : 1));
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].name !== b[i].name || a[i].act !== b[i].act || !near(a[i].qty, b[i].qty, 1e-9) || !near(a[i].price, b[i].price) || !near(a[i].fee ?? null, b[i].fee ?? null)) return true;
  }
  if ("premium" in (saved || {}) && !near(saved.premium, derive.premium)) return true;
  if ("gross" in (saved || {}) && !near(saved.gross, -derive.premium)) return true;
  return !near(saved?.fees ?? null, Number.isFinite(derive?.fees) ? derive.fees : null);
}

/**
 * A one-tap buy rebuilt from Derive's complete fill, keeping what was saved at entry: its key, time,
 * exits, Derive's mark and the readings. The fill, its legs and its cost come from Derive.
 */
export function repairBuy(record, fill, { now }) {
  const j = record.journal || {};
  const fresh = buyRecord({ fill: { ...fill, pct: j.fill?.filled_pct ?? 1, complete: true }, id: record.id, side: record.side, network: record.network || NETWORK.name,
    requested: j.fill?.requested ?? null, savedTs: j.saved_ts ?? record.at ?? now, wallet: record.wallet || null, subaccountId: record.subaccount_id ?? null });
  if (!fresh) return null;
  const mark = j.mark && record.contracts > 0 && fresh.contracts !== record.contracts
    ? { ...j.mark, value: Number.isFinite(j.mark.value) ? j.mark.value * fresh.contracts / record.contracts : j.mark.value } : j.mark;
  return reconcileExits({
    ...record, contracts: fresh.contracts, paid: fresh.paid, legs: fresh.legs, updated_at: Math.floor(now),
    journal: { ...j, package: fresh.journal.package, fill: { ...fresh.journal.fill, repaired_ts: Math.floor(now) }, cost: fresh.journal.cost, ...(mark ? { mark } : {}) },
  }, now);
}

/** A receipt must describe the answer's actual debit instruments and sides, not just two equal sizes. */
export function matchesPackage(fill, id, side, closing = false) {
  const q = parseId(id);
  if (!q || !packageComplete(fill)) return false;
  const expected = packageLegs({ und: q.und, expiry: q.expiry, kind: side, lo: q.lo, hi: q.hi });
  return expected.every((l) => fill.legs.some((f) => f.name === l.instrument_name
    && f.act === (closing ? (l.direction === "buy" ? "sell" : "buy") : l.direction)));
}

/** A one-tap sell back as an exact J2 exit: proceeds before fees, Derive's exit fees, the time, the
 * trade ids, and Derive's mark from the board (when the board had one) as the benchmark. */
export function exitFromFill(fill, { mark = null, savedTs, qty = fill.legs[0].qty, offset = 0 } = {}) {
  const fullQty = fill.legs[0].qty;
  // Cumulative differences leave the last lot with every rounding remainder.
  const part = (v) => Number.isFinite(v)
    ? round(round(v * (offset + qty) / fullQty, 12) - round(v * offset / fullQty, 12), 12) : null;
  const gross = part(-fill.premium); // a sell back receives
  const fees = part(fill.fees);
  return {
    kind: "close", qty, ts: fill.ts, saved_ts: savedTs, via: "rfq",
    complete: fill.complete !== false && packageComplete(fill), rfq_qty: fullQty, allocation_offset: offset,
    gross, gross_basis: "exact", fees, fees_basis: fees == null ? "unknown" : "exact",
    net: fees == null ? null : round(gross - fees, 12),
    mark: mark && Number.isFinite(mark.value) ? { value: mark.value, ts: mark.ts ?? null, source: mark.source || "Derive mark, Cowboy board" } : null,
    rfq_id: fill.rfq_id, quote_id: fill.quote_id, trade_ids: fill.trade_ids || [], source: fill.source,
    legs: fill.legs.map((l) => ({ name: l.name, act: l.act, qty: part(l.qty), price: l.price, fee: part(l.fee) })),
  };
}

/** Every RFQ id already in the journal (buys and exits), so a fill is never recorded twice. */
export function knownRfqs(list) {
  const ids = new Set();
  for (const p of list || []) {
    if (p.journal?.fill?.rfq_id) ids.add(p.journal.fill.rfq_id);
    for (const e of p.exits || []) if (e.rfq_id) ids.add(e.rfq_id);
  }
  return ids;
}
