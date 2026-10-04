// Saloon stage 2, P6: Positions from Derive. On a testnet build the Saloon account's open positions
// and trades are read over the user's own authenticated WebSocket and matched to Saloon answers by
// their legs. Derive is the record: one-tap fills missing from this browser are added from Derive's
// trade history (by the RFQ label), one-tap sell backs become exact exits, and each record says
// whether Derive's positions hold its legs. Settlement uses the testnet's own settlement price.
import { parseInstrument } from "./package.js";
import { fillFromTrades, tradesSince } from "./fills.js";
import { buyRecord, exitFromFill, knownRfqs, parseLabel } from "./record.js";
import { remainingQty } from "../realized.js";

const EPS = 1e-9;
const round = (x, d = 8) => Math.round(x * 10 ** d) / 10 ** d;

/** Option positions held, by instrument: signed contracts (long positive). */
export function heldByInstrument(positions) {
  const m = new Map();
  for (const p of positions || []) {
    if (p.instrument_type && p.instrument_type !== "option") continue;
    const a = Number(p.amount);
    if (p.instrument_name && Number.isFinite(a) && Math.abs(a) > EPS) m.set(p.instrument_name, round((m.get(p.instrument_name) || 0) + a));
  }
  return m;
}

/** What the open records say should be held, by instrument (their legs for the contracts still open). */
export function expectedByInstrument(records, now) {
  const m = new Map();
  for (const r of records || []) {
    const left = remainingQty(r);
    if (!(left > 0) || (r.settle_ts && now >= r.settle_ts)) continue;
    const f = left / r.contracts;
    for (const l of r.journal?.fill?.legs || []) {
      if (!(l.qty > 0)) continue;
      m.set(l.name, round((m.get(l.name) || 0) + l.signed_qty * f));
    }
  }
  return m;
}

/**
 * Saloon answers read from bare positions: a long call at lo with an equal short call at hi (Higher),
 * or a long put at hi with an equal short put at lo (Lower), same coin and expiry. Whatever does not
 * pair stays in `rest`.
 */
export function pairAnswers(held) {
  const legs = [...held.entries()].map(([name, amount]) => ({ name, amount, ...parseInstrument(name) })).filter((l) => l.und);
  const used = new Map(legs.map((l) => [l.name, 0]));
  const left = (l) => Math.abs(l.amount) - used.get(l.name);
  const answers = [];
  const byKey = (l) => `${l.und}|${l.expiry}|${l.type}`;
  const groups = new Map();
  for (const l of legs) { if (!groups.has(byKey(l))) groups.set(byKey(l), []); groups.get(byKey(l)).push(l); }
  for (const g of groups.values()) {
    const longs = g.filter((l) => l.amount > 0).sort((a, b) => a.strike - b.strike);
    const shorts = g.filter((l) => l.amount < 0).sort((a, b) => a.strike - b.strike);
    // Equal amounts pair first (a Saloon package holds the same contracts on both legs), then the rest
    // pairs nearest strike first.
    for (const exact of [true, false]) {
      for (const L of longs) {
        const near = [...shorts].sort((a, b) => Math.abs(a.strike - L.strike) - Math.abs(b.strike - L.strike));
        for (const S of near) {
          if (left(L) <= EPS) break;
          if (left(S) <= EPS) continue;
          if (exact && Math.abs(left(L) - left(S)) > EPS) continue;
          const yes = L.type === "C" && S.strike > L.strike;
          const no = L.type === "P" && S.strike < L.strike;
          if (!yes && !no) continue;
          const qty = round(Math.min(left(L), left(S)));
          used.set(L.name, used.get(L.name) + qty);
          used.set(S.name, used.get(S.name) + qty);
          const lo = yes ? L.strike : S.strike, hi = yes ? S.strike : L.strike;
          answers.push({ und: L.und, expiry: L.expiry, side: yes ? "yes" : "no", lo, hi, contracts: qty, legs: [L.name, S.name].sort() });
        }
      }
    }
    answers.sort((a, b) => a.und.localeCompare(b.und) || a.expiry.localeCompare(b.expiry) || a.lo - b.lo);
  }
  const rest = legs.filter((l) => left(l) > EPS).map((l) => ({ name: l.name, amount: round(Math.sign(l.amount) * left(l)) }));
  return { answers, rest };
}

/** Each record's standing against Derive: "matches" when Derive holds every leg the open records
 * need, "differs" when it holds less or more, "settled"/"closed" when nothing should be open. */
export function legStatus(records, held, now) {
  const expected = expectedByInstrument(records, now);
  const out = {};
  for (const r of records || []) {
    if (r.closed_at || !(remainingQty(r) > 0)) { out[r.key] = { state: "closed" }; continue; }
    if (r.settle_ts && now >= r.settle_ts) { out[r.key] = { state: "settled" }; continue; }
    const names = (r.journal?.fill?.legs || []).filter((l) => l.qty > 0).map((l) => l.name);
    if (!names.length) { out[r.key] = { state: "unknown" }; continue; }
    const diff = names.map((n) => ({ name: n, expected: expected.get(n) || 0, held: held.get(n) || 0 }))
      .filter((d) => Math.abs(d.expected - d.held) > 1e-7);
    out[r.key] = diff.length ? { state: "differs", diff } : { state: "matches" };
  }
  return out;
}

/** Positions on Derive no record explains (after the records' own legs are taken out). */
export function unexplained(records, held, now) {
  const expected = expectedByInstrument(records, now);
  const rest = new Map();
  for (const [name, amount] of held) {
    const extra = round(amount - (expected.get(name) || 0));
    if (Math.abs(extra) > 1e-7) rest.set(name, extra);
  }
  return pairAnswers(rest);
}

/** Group the account's taker trades into one fill per RFQ, keeping the label. */
export function fillsByRfq(trades) {
  const by = new Map();
  for (const t of trades || []) {
    if (!t.rfq_id || t.liquidity_role === "maker") continue;
    if (!by.has(t.rfq_id)) by.set(t.rfq_id, []);
    by.get(t.rfq_id).push(t);
  }
  return [...by.entries()].map(([rfqId, rows]) => fillFromTrades(rows, { rfqId })).filter(Boolean).sort((a, b) => a.ts - b.ts);
}

/**
 * Bring the testnet journal in line with Derive's trade history: a one-tap buy whose RFQ is not in the
 * journal becomes a record (exact, from Derive), and a one-tap sell back becomes an exact exit on the
 * oldest open record of that answer. Returns { added, exits } for the caller to save; after saving the
 * added records, call it again so their sell backs land too.
 */
export function recoverFills(records, fills, now = Date.now() / 1000) {
  const seen = knownRfqs(records);
  const added = [], exits = [];
  for (const f of fills) {
    if (seen.has(f.rfq_id)) continue;
    const lab = parseLabel(f.label);
    if (!lab) continue;
    if (!lab.close) {
      const r = buyRecord({ fill: { ...f, pct: 1 }, id: lab.id, side: lab.side, network: "testnet", savedTs: Math.floor(now) });
      if (r) { added.push({ ...r, recovered: true }); seen.add(f.rfq_id); }
      continue;
    }
    // Only saved records (with their keys) take exits; a record added in this pass gets its exit on the next.
    const open = records.filter((r) => r.id === lab.id && r.side === lab.side && !r.closed_at && remainingQty(r) > 0)
      .sort((a, b) => (a.journal?.fill?.ts ?? a.at ?? 0) - (b.journal?.fill?.ts ?? b.at ?? 0));
    if (open.length) { exits.push({ key: open[0].key, exit: exitFromFill(f, { savedTs: Math.floor(now) }) }); seen.add(f.rfq_id); }
  }
  return { added, exits };
}

/** One read of the Saloon account: open option positions and the trades since `sinceSec`. */
export async function readSaloon(client, subaccountId, { sinceSec = 0 } = {}) {
  const [pos, trades] = await Promise.all([
    client.call("private/get_positions", { subaccount_id: subaccountId }),
    tradesSince(client, subaccountId, { sinceSec }),
  ]);
  return { positions: pos?.positions || [], trades, held: heldByInstrument(pos?.positions || []) };
}

/** The testnet's settlement price for a coin's expiry (public; only settled expiries are listed). */
export async function settlementPrice(client, und, expiry) {
  const r = await client.call("public/get_option_settlement_prices", { currency: und });
  const row = (r?.expiries || []).find((x) => x.expiry_date === expiry);
  const p = row ? Number(row.price) : NaN;
  return Number.isFinite(p) ? p : null;
}
