// Saloon stage 2, P6: a one-tap fill as a journal record. Everything about the fill comes from Derive
// (its trade history, or execute_quote's answer): fill time, legs, prices, fees and trade ids, kept as
// exact. Nothing is entered by the user. The board's estimate, Derive's mark from the board and the
// three readings are kept beside it as in the manual journal (lib/journal.js), never as the fill.
// Testnet records live under the testnet journal key, apart from mainnet.
import { captureContext, markBenchmark, settleBreakeven } from "../journal.js";
import { fullPay, parseId, questionText, ANSWER } from "../questions.js";

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
  const be = settleBreakeven({ side, lo, hi, contracts, cost: total ?? fill.premium });
  return {
    schema: 1, source: "derive", venue: "Derive", network, entered_by_you: [], saved_ts: savedTs,
    package: {
      network, venue: "Derive", id, und: q.und, side, direction: ANSWER[side], expiry: q.expiry, settle_ts: settleTs,
      lo, hi, zone: fullPay({ lo, hi }, side), contracts: requested ?? contracts,
      legs: fill.legs.map((l) => ({ name: l.name, act: l.act, signed_qty: (l.act === "buy" ? 1 : -1) * (requested ?? contracts) })),
    },
    fill: {
      ts: fill.ts, mode: "legs", complete: true, currency: "USDC", source: fill.source,
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

/** A position record for addPosition from a one-tap buy (exec "rfq"). `requested` is the contracts
 * asked for; a part fill records what filled. */
export function buyRecord({ fill, id, side, network = "testnet", requested = null, level = null, board = null, markets = null, pricesTs = null, estimate = null, question = null, savedTs }) {
  const q = parseId(id);
  if (!q || !fill?.legs?.length) return null;
  const contracts = fill.legs[0].qty;
  const settleTs = settleOf(q.expiry);
  const journal = exactJournal({ fill, id, side, network, settleTs, contracts, requested, board, level, markets, pricesTs, estimate, savedTs });
  return {
    id, und: q.und, side, lo: journal.package.lo, hi: journal.package.hi, contracts,
    paid: journal.cost.total ?? journal.cost.premium, estimate: estimate?.total ?? null, exec: "rfq",
    legs: fill.legs.map((l) => l.name), question: question || questionText(q.und, q, q.expiry), answer: ANSWER[side],
    settle_ts: settleTs, v: 2, network, journal,
  };
}

/** A one-tap sell back as an exact J2 exit: proceeds before fees, Derive's exit fees, the time, the
 * trade ids, and Derive's mark from the board (when the board had one) as the benchmark. */
export function exitFromFill(fill, { mark = null, savedTs } = {}) {
  const qty = fill.legs[0].qty;
  const gross = round(-fill.premium); // a sell back receives
  const fees = Number.isFinite(fill.fees) ? round(fill.fees) : null;
  return {
    kind: "close", qty, ts: fill.ts, saved_ts: savedTs, via: "rfq",
    gross, gross_basis: "exact", fees, fees_basis: fees == null ? "unknown" : "exact",
    net: fees == null ? null : round(gross - fees),
    mark: mark && Number.isFinite(mark.value) ? { value: mark.value, ts: mark.ts ?? null, source: mark.source || "Derive mark, Cowboy board" } : null,
    rfq_id: fill.rfq_id, quote_id: fill.quote_id, trade_ids: fill.trade_ids || [], source: fill.source,
    legs: fill.legs.map((l) => ({ name: l.name, act: l.act, qty: l.qty, price: l.price, fee: l.fee })),
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
