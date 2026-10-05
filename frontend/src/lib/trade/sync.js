// Saloon stage 2, P6: Positions from Derive. On a testnet build the Saloon account's open positions
// and trades are read over the user's own authenticated WebSocket and matched to Saloon answers by
// their legs. Derive is the record: one-tap fills missing from this browser are added from Derive's
// trade history (by the RFQ label), one-tap sell backs become exact exits, and each record says
// whether Derive's positions hold its legs. Settlement uses the testnet's own settlement price.
import { parseInstrument } from "./package.js";
import { fillFromTrades, packageComplete, tradesSince } from "./fills.js";
import { buyRecord, exitFromFill, fillDiffers, knownRfqs, matchesPackage, parseLabel, repairBuy } from "./record.js";
import { incompleteEntryReceipt, remainingQty } from "../realized.js";
import { reconcileExits } from "../positions.js";

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

const sameWallet = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
const rfqsOf = (r) => [r.journal?.fill?.rfq_id, ...(r.exits || []).map((e) => e.rfq_id)].filter(Boolean);

/**
 * Which records belong to the Derive account in use (`wallet`, `subaccountId`): those saved with
 * both, and older one-tap records with neither whose RFQs this account's trades contain (they are
 * claimed: `claims` lists them for the caller to save). Without a scope every record counts (tests,
 * older callers).
 */
export function accountRecords(records, fills, { wallet = null, subaccountId = null } = {}) {
  const list = records || [];
  if (!wallet || subaccountId == null) return { mine: list, claims: [] };
  const here = new Set((fills || []).map((f) => f.rfq_id));
  const mine = [], claims = [];
  for (const r of list) {
    if ((r.wallet && !sameWallet(r.wallet, wallet)) || (r.subaccount_id != null && r.subaccount_id !== subaccountId)) continue;
    if (r.subaccount_id != null && r.wallet) {
      mine.push(r);
      continue;
    }
    if (r.exec === "rfq" && rfqsOf(r).some((id) => here.has(id))) {
      mine.push({ ...r, wallet, subaccount_id: subaccountId });
      claims.push({ key: r.key, wallet, subaccount_id: subaccountId });
    }
  }
  return { mine, claims };
}

const stableRecord = (r) => JSON.stringify({ ...r, updated_at: undefined });
const stableExit = (e) => JSON.stringify({ ...e, repaired_ts: undefined });

/**
 * Bring the testnet journal in line with Derive's trade history for the account in use (`scope`:
 * { wallet, subaccountId }); records of other accounts are never matched.
 *   added    a one-tap buy whose RFQ is in no record, as a new record (exact, from Derive; its key
 *            comes from its RFQ and legs)
 *   exits    a one-tap sell back allocated across the oldest eligible entry lots, with proportional
 *            proceeds and fees; every allocation consumes its contracts before the next RFQ. A sell
 *            back already saved stays on its lot (the card the user closed) while that lot holds the
 *            contracts; only the rest moves to the oldest eligible lots
 *   repairs  a known RFQ whose saved fill is flagged incomplete or disagrees with Derive's complete
 *            trades (legs, premium, fees): the record rebuilt from Derive, its key and entry kept
 *   claims   older records without wallet or account that this account's trades name
 * A close beyond the available recorded inventory returns its unassigned quantity and cash in
 * `unmatched`, rather than silently charging the whole execution to a smaller lot. The caller saves
 * records, then calls again so newly added buys can take their historical closes.
 */
export function recoverFills(records, fills, now = Date.now() / 1000, scope = {}) {
  const all = records || [];
  const seen = knownRfqs(all);
  const { mine, claims } = accountRecords(all, fills, scope);
  const added = [], exits = [], repairs = [];
  const original = new Map(mine.map((r) => [r.key, r]));
  const working = new Map(original);
  for (const f of fills) {
    const lab = parseLabel(f.label);
    if (seen.has(f.rfq_id)) {
      for (const r of mine) {
        const cur = working.get(r.key);
        if (cur.journal?.fill?.rfq_id === f.rfq_id && matchesPackage(f, cur.id, cur.side)) {
          const fixed = cur.journal.fill.complete === false || fillDiffers(cur.journal.fill, f)
            ? repairBuy(cur, f, { now }) : reconcileExits(cur, now);
          if (fixed) working.set(r.key, fixed);
        }
      }
      continue;
    }
    if (!lab) continue;
    if (!lab.close) {
      const r = buyRecord({ fill: { ...f, pct: 1, complete: packageComplete(f) }, id: lab.id, side: lab.side, network: "testnet", savedTs: Math.floor(now),
        wallet: scope.wallet || null, subaccountId: scope.subaccountId ?? null });
      if (r) { added.push({ ...r, recovered: true }); seen.add(f.rfq_id); }
      continue;
    }
  }

  // Replay authoritative close receipts, including ones previously clamped or saved one leg short.
  const closes = (fills || []).map((fill) => {
    const oldRecord = mine.find((r) => (r.exits || []).some((e) => e.via === "rfq" && e.rfq_id === fill.rfq_id));
    const lab = parseLabel(fill.label) || (oldRecord ? { id: oldRecord.id, side: oldRecord.side, close: true } : null);
    return { fill, lab };
  }).filter(({ fill, lab }) => lab?.close && matchesPackage(fill, lab.id, lab.side, true))
    .sort((a, b) => a.fill.ts - b.fill.ts);
  const closeIds = new Set(closes.map(({ fill }) => fill.rfq_id));
  const oldExits = new Map();
  for (const r of working.values()) for (const e of r.exits || []) {
    if (!closeIds.has(e.rfq_id) || e.via !== "rfq") continue;
    if (!oldExits.has(e.rfq_id)) oldExits.set(e.rfq_id, []);
    oldExits.get(e.rfq_id).push({ key: r.key, exit: e });
  }
  const base = new Map([...working].map(([key, r]) => [key, { ...r,
    exits: (r.exits || []).filter((e) => e.via !== "rfq" || !closeIds.has(e.rfq_id)) }]));
  const left = new Map([...base].map(([key, r]) => [key, Math.max(0, r.contracts
    - (r.exits || []).filter((e) => e.kind === "close" && e.complete !== false).reduce((a, e) => a + (e.qty || 0), 0))]));
  const knownAllocations = new Map();
  const unmatched = [];
  for (const { fill: f, lab } of closes) {
    const qty = f.legs[0].qty;
    const eligible = (r) => !!r && r.exec === "rfq" && r.id === lab.id && r.side === lab.side
      && !incompleteEntryReceipt(r) && (left.get(r.key) || 0) > EPS
      && (!Number.isFinite(r.journal?.fill?.ts) || !Number.isFinite(f.ts) || r.journal.fill.ts <= f.ts);
    const refs = oldExits.get(f.rfq_id) || [];
    // Contracts of this sell back per entry lot, in the order they were placed.
    const shares = new Map();
    let placed = 0;
    const place = (key, want) => {
      const take = round(Math.min(want, qty - placed, left.get(key)));
      if (!(take > EPS)) return;
      shares.set(key, round((shares.get(key) || 0) + take));
      left.set(key, round(left.get(key) - take));
      placed = round(placed + take);
    };
    // A sell back stays on the lot it was saved on (the card the user closed) while that lot still has
    // the contracts; only what no saved lot can hold goes to the oldest eligible lots.
    const kept = [...refs].sort((a, b) => ((a.exit.allocation_offset ?? 0) - (b.exit.allocation_offset ?? 0)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const { key, exit: old } of kept) {
      if (qty - placed <= EPS) break;
      if (eligible(base.get(key))) place(key, [old.qty, old.receipt_qty].find((v) => v > 0) ?? qty);
    }
    if (qty - placed > EPS) {
      const open = [...base.values()].filter(eligible)
        .sort((a, b) => (a.journal?.fill?.ts ?? a.at ?? 0) - (b.journal?.fill?.ts ?? b.at ?? 0));
      for (const r of open) {
        if (qty - placed <= EPS) break;
        place(r.key, qty);
      }
    }
    let offset = 0;
    for (const [key, take] of shares) {
      const r = base.get(key);
      const old = (refs.find((x) => x.key === r.key) || refs[0])?.exit;
      const markQty = old ? Math.max(old.qty || 0, ...(old.legs || []).map((l) => l.qty || 0)) : 0;
      const mark = old?.mark && markQty > 0 ? { ...old.mark, value: old.mark.value * take / markQty } : null;
      let e = exitFromFill({ ...f, complete: true }, { savedTs: old?.saved_ts ?? Math.floor(now), mark, qty: take, offset });
      if (old?.repaired_ts) e.repaired_ts = old.repaired_ts;
      if (seen.has(f.rfq_id)) {
        if (old && stableExit(old) !== stableExit(e)) e.repaired_ts = Math.floor(now);
        if (!knownAllocations.has(r.key)) knownAllocations.set(r.key, []);
        knownAllocations.get(r.key).push(e);
      } else exits.push({ key: r.key, exit: e });
      offset = round(offset + take);
    }
    if (qty - offset > EPS) unmatched.push({ rfq_id: f.rfq_id, reason: "missing_entries",
      exit: exitFromFill({ ...f, complete: true }, { savedTs: Math.floor(now), qty: round(qty - offset), offset }) });
  }
  for (const [key, r] of base) {
    const record = reconcileExits({ ...r, exits: [...r.exits, ...(knownAllocations.get(key) || [])] }, now);
    if (stableRecord(record) !== stableRecord(original.get(key))) repairs.push({ key, record: { ...record, updated_at: Math.floor(now) } });
  }
  return { added, exits, repairs, claims, ...(unmatched.length ? { unmatched } : {}) };
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
