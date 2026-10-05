import { payAt, sameLegs } from "./questions.js";
import { incompleteReceipt, legacyExit, remainingQty, settleEvent } from "./realized.js";
export { incompleteReceipt } from "./realized.js";
import { payoutAt, positionExposure } from "./exposure.js";
import { TESTNET_FILLS } from "./flags.js";

// Positions and the trade journal: what the user says they placed on Derive, kept in this browser
// only. Nothing is sent anywhere. Storage can be blocked or cleared, so every read and write falls
// back to memory, and `persistent()` says when nothing survives a reload.
//
// Layout (journal version 3): mainnet records under the original key "cowboy-questions" (an array,
// as version 1 kept them), testnet records apart under "cowboy-questions:testnet". A record saved
// with the journal carries `v: 2`, its `network` and a `journal` block (lib/journal.js); older
// records have neither and stay visible with those fields unknown. Version 3 (J2) adds `exits`: each
// sell-back or settlement as an event with its own contracts and amounts (lib/realized.js); a record
// sold back before it gains one exit of every contract with only what came back after fees.

export const JOURNAL_VERSION = 3;
export const NETWORKS = ["mainnet", "testnet"];
const KEYS = { mainnet: "cowboy-questions", testnet: "cowboy-questions:testnet" };
let memory = { mainnet: [], testnet: [] };
let lastWriteOk = true;

function storage() {
  try {
    const s = globalThis.localStorage;
    const probe = "__cowboy_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** False when this browser keeps nothing past the visit (storage blocked or the last save failed). */
export function persistent() {
  return !!storage() && lastWriteOk;
}

const netOf = (network) => (NETWORKS.includes(network) ? network : "mainnet");

/** A record as this version keeps it: older ones gain only their network (stage 1 was mainnet). */
export function migrateRecord(r, network = "mainnet") {
  if (!r || typeof r !== "object") return r;
  let m = r.network ? r : { ...r, network: netOf(network) };
  if (!Array.isArray(m.exits)) m = { ...m, exits: m.closed_at ? [legacyExit(m)] : [] };
  return m;
}

export function loadPositions(network = "mainnet") {
  const net = netOf(network);
  const s = storage();
  if (!s) return [...memory[net]];
  try {
    const raw = s.getItem(KEYS[net]);
    if (raw == null) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(valid).map((r) => migrateRecord(r, net)) : [];
  } catch {
    return [...memory[net]];
  }
}

const changed = new Set();
/** Called after every save (the header's Positions link listens). Returns an unsubscribe. */
export function onPositionsChange(fn) {
  changed.add(fn);
  return () => changed.delete(fn);
}

export function savePositions(list, network = "mainnet") {
  const net = netOf(network);
  memory[net] = [...list];
  queueMicrotask(() => changed.forEach((fn) => fn()));
  const s = storage();
  if (!s) { lastWriteOk = false; return false; }
  try {
    s.setItem(KEYS[net], JSON.stringify(list));
    lastWriteOk = true;
    return true;
  } catch {
    lastWriteOk = false;
    return false;
  }
}

function valid(p) {
  return p && typeof p.id === "string" && (p.side === "yes" || p.side === "no") && Number.isFinite(p.contracts) && p.contracts > 0;
}

const rfqOf = (r) => r.exec === "rfq" ? r.journal?.fill?.rfq_id : null;

/** One-tap fills (exec "rfq", Saloon stage 2 on testnet) are saved by lib/trade/record.js with the
 * same shape, their journal block exact from Derive.
 *
 * Saved from "I placed it": the question, the side, contracts, what the user says they paid (fees
 * included), how it was placed (`exec`: "hand_both", or "hand_partial" when the package did not fully
 * fill; older entries have none and count as both), the exact instruments held (`legs`) and, from
 * version 2, the journal block with the fills, costs, mark and readings at entry. */
export function addPosition(p, now = Date.now()) {
  const net = netOf(p.network);
  const list = loadPositions(net);
  // A one-tap record brings its own key (its RFQ and legs): the same fill is never added twice.
  const key = typeof p.key === "string" && p.key ? p.key : `${p.id}:${p.side}:${now}`;
  if (list.some((r) => r.key === key || (rfqOf(p) && rfqOf(r) === rfqOf(p)))) return list;
  const row = { ...p, key, at: Math.floor(now / 1000), network: net };
  if (!valid(row)) return list;
  list.push(row);
  savePositions(list, net);
  return list;
}

/** Sold back by hand: an exit event (lib/realized.js closeEvent), or, as before J2, a number for what
 * came back after fees for every contract still open. A partial close leaves the rest open; the
 * position closes when nothing is left. */
export function closePosition(key, exit, now = Date.now() / 1000, network = "mainnet") {
  const t = Math.floor(now);
  const list = loadPositions(network).map((p) => {
    if (p.key !== key) return p;
    if (exit?.rfq_id && (p.exits || []).some((e) => e.rfq_id === exit.rfq_id)) return p;
    const historical = typeof exit === "object" && Number.isFinite(exit.ts) && Number.isFinite(p.settle_ts) && exit.ts < p.settle_ts;
    const left = remainingQty(historical ? { ...p, exits: (p.exits || []).filter((e) => e.kind !== "settle") } : p);
    const e = typeof exit === "number"
      ? { kind: "close", qty: left, ts: null, saved_ts: t, gross: null, gross_basis: "unknown", fees: null, fees_basis: "unknown", net: exit, mark: null }
      : exit.complete === false
        ? { ...exit, receipt_qty: exit.qty, qty: 0, saved_ts: exit.saved_ts ?? t }
        : { ...portionExit(exit, Math.min(left, exit.qty ?? left)), saved_ts: exit.saved_ts ?? t };
    if (!(e.qty > 0) && e.complete !== false) return p;
    const exits = [...(p.exits || []), e];
    return reconcileExits({ ...p, exits, updated_at: t }, t);
  });
  savePositions(list, network);
  return list;
}

/** Settled: the contracts still open paid at Derive's settlement price, from the instruments held
 * (only the legs that filled). Recorded once per position. */
export function settlePosition(key, settlePrice, now = Date.now() / 1000, network = "mainnet") {
  const t = Math.floor(now);
  let changed = false;
  const list = loadPositions(network).map((p) => {
    if (p.key !== key || incompleteReceipt(p) || !Number.isFinite(settlePrice) || (p.exits || []).some((e) => e.kind === "settle")) return p;
    const x = positionExposure(p);
    if (!x) return p;
    changed = true;
    const e = settleEvent({ qty: remainingQty(p), settleTs: p.settle_ts ?? null, savedTs: t, settlePrice, payout: payoutAt(x.legs, settlePrice) });
    return { ...p, exits: [...(p.exits || []), e], settled_at: t, updated_at: t };
  });
  if (changed) savePositions(list, network);
  return list;
}

/** The part still open, as a position of its own: contracts left and their share of what was paid. */
export function openPart(p) {
  const left = remainingQty(p);
  if (!(p.contracts > 0) || left === p.contracts) return p;
  return { ...p, contracts: left, paid: Number.isFinite(p.paid) ? p.paid * (left / p.contracts) : p.paid };
}

/** Unbalanced manual fills and incomplete RFQ receipts have no full-answer valuation. */
export const partial = (p) => p.exec === "hand_partial" || incompleteReceipt(p);

/** A smaller exit keeps only its share of the money and instrument quantities. */
export function portionExit(exit, qty) {
  if (!(exit.qty > 0) || qty === exit.qty) return { ...exit, qty };
  const share = qty / exit.qty;
  const amount = (v) => Number.isFinite(v) ? v * share : v;
  return {
    ...exit, qty, gross: amount(exit.gross), fees: amount(exit.fees), net: amount(exit.net),
    ...(exit.rfq_id ? { rfq_qty: exit.rfq_qty ?? exit.qty, allocation_offset: exit.allocation_offset ?? 0 } : {}),
    ...(exit.mark ? { mark: { ...exit.mark, value: amount(exit.mark.value) } } : {}),
    ...(exit.legs ? { legs: exit.legs.map((l) => ({ ...l, qty: amount(l.qty), fee: amount(l.fee) })) } : {}),
  };
}

/** Recompute a synthesized settlement when receipts or historical closes change its remaining legs. */
export function reconcileExits(record, now = Date.now() / 1000) {
  let q = { ...record };
  if (q.exec === "rfq" && q.journal?.cost && (!Number.isFinite(q.journal.cost.total) || !Number.isFinite(q.journal.cost.fees))) {
    q.paid = null;
    q.journal = { ...q.journal, cost: { ...q.journal.cost, total: null, breakeven: null, breakeven_basis: "unavailable" } };
  }
  const settled = (q.exits || []).find((e) => e.kind === "settle" && Number.isFinite(e.settle_price));
  if (settled && !incompleteReceipt(q)) {
    q.exits = (q.exits || []).filter((e) => e.kind !== "settle");
    const x = positionExposure(q);
    if (x) {
      q.exits.push({ ...settled, ...settleEvent({ qty: remainingQty(q), settleTs: q.settle_ts ?? settled.ts,
        savedTs: settled.saved_ts ?? Math.floor(now), settlePrice: settled.settle_price,
        payout: payoutAt(x.legs, settled.settle_price) }) });
    } else delete q.settled_at;
  }
  const closes = (q.exits || []).filter((e) => e.kind === "close" && e.complete !== false);
  const closedQty = closes.reduce((a, e) => a + (Number.isFinite(e.qty) ? e.qty : 0), 0);
  if (!incompleteReceipt(q) && closedQty >= q.contracts - 1e-9) {
    const nets = closes.map((e) => e.net);
    q.closed_at = q.closed_at ?? Math.floor(now);
    q.proceeds = nets.every(Number.isFinite) ? nets.reduce((a, b) => a + b, 0) : null;
  } else {
    delete q.closed_at;
    delete q.proceeds;
  }
  return q;
}

/** Merges `patch` into one record (sync attaches the wallet and Derive account to an older record). */
export function patchPosition(key, patch, network = "mainnet") {
  const list = loadPositions(network).map((p) => (p.key === key ? { ...p, ...patch } : p));
  savePositions(list, network);
  return list;
}

/** Replaces one record, keeping its key (sync repairs a fill from Derive's trades). */
export function replacePosition(key, record, network = "mainnet") {
  const list = loadPositions(network).map((p) => (p.key === key && valid(record) ? { ...record, key } : p));
  savePositions(list, network);
  return list;
}

/** The records Positions shows with `wallet` connected: its own, and every record that names no
 * wallet (placed by hand, or older one-tap records not yet matched on Derive). Other wallets'
 * one-tap records stay saved (and in Export) but out of view. No wallet: everything. */
export function forWallet(list, wallet) {
  if (!wallet) return list;
  const w = String(wallet).toLowerCase();
  return list.filter((p) => !p.wallet || String(p.wallet).toLowerCase() === w);
}

export function removePosition(key, network = "mainnet") {
  const list = loadPositions(network).filter((p) => p.key !== key);
  savePositions(list, network);
  return list;
}

/** Positions settled more than 90 days ago leave the list, except journal entries: those stay. */
export function prune(list, now = Date.now() / 1000) {
  return list.filter((p) => p.journal || !p.settle_ts || now - p.settle_ts < 90 * 86400);
}

export function exportPositions() {
  const networks = Object.fromEntries(NETWORKS.map((n) => [n, loadPositions(n)]));
  return JSON.stringify({ kind: "cowboy-journal", version: JOURNAL_VERSION, networks }, null, 1);
}

/** The rows of an export, by network, from any version: a bare array or {positions} (version 1,
 * mainnet), or {networks} (versions 2 and 3). A newer version than this one is refused. */
export function importRows(doc) {
  if (Array.isArray(doc)) return { mainnet: doc, testnet: [] };
  if (!doc || typeof doc !== "object") throw new Error("Not a Positions file");
  if (Number(doc.version) > JOURNAL_VERSION) throw new Error("Saved by a newer Cowboy");
  if (doc.networks) return { mainnet: doc.networks.mainnet || [], testnet: doc.networks.testnet || [] };
  if (Array.isArray(doc.positions)) return { mainnet: doc.positions, testnet: [] };
  throw new Error("Not a Positions file");
}

// The more complete of two copies of one record: more exits, then closed beats open, then the later update.
const nExits = (r) => (r.exits || []).length;
const better = (a, b) => (nExits(a) !== nExits(b) ? (nExits(b) > nExits(a) ? b : a)
  : (!!b.closed_at !== !!a.closed_at) ? (b.closed_at ? b : a) : ((b.updated_at || 0) > (a.updated_at || 0) ? b : a));

/** An imported complete RFQ receipt can enrich an older lot without discarding its historical exits. */
function mergeRfqCopies(a, b) {
  const chosen = better(a, b);
  if (!rfqOf(a) || rfqOf(a) !== rfqOf(b)) return chosen;
  const complete = [a, b].find((r) => !incompleteReceipt({ ...r, exits: [] }));
  if (!complete || !incompleteReceipt({ ...chosen, exits: [] })) return chosen;
  const j = chosen.journal || {};
  const mark = j.mark && chosen.contracts > 0 && complete.contracts !== chosen.contracts
    ? { ...j.mark, value: Number.isFinite(j.mark.value) ? j.mark.value * complete.contracts / chosen.contracts : j.mark.value } : j.mark;
  return reconcileExits({
    ...chosen, contracts: complete.contracts, paid: complete.paid, legs: complete.legs,
    journal: { ...complete.journal, ...j, package: complete.journal.package, fill: complete.journal.fill, cost: complete.journal.cost,
      ...(mark ? { mark } : {}) },
  });
}

/** Adds an export's records to this browser. A record is matched by its key, so importing the same
 * file twice adds nothing; a record placed under the wrong network goes to its own. Returns the
 * mainnet list (what Positions shows). */
export function importPositions(text) {
  const rows = importRows(JSON.parse(text));
  const incoming = { mainnet: [], testnet: [] };
  for (const net of NETWORKS) {
    for (const r of rows[net] || []) {
      if (!valid(r) || typeof r.key !== "string") continue;
      const m = migrateRecord(r, net);
      incoming[netOf(m.network)].push(m);
    }
  }
  for (const net of NETWORKS) {
    if (!incoming[net].length) continue;
    const list = loadPositions(net);
    const at = new Map(list.map((p, i) => [p.key, i]));
    const rfqs = new Map(list.map((p, i) => [rfqOf(p), i]).filter(([id]) => id));
    for (const r of incoming[net]) {
      const index = at.has(r.key) ? at.get(r.key) : rfqOf(r) ? rfqs.get(rfqOf(r)) : undefined;
      if (index != null) list[index] = { ...mergeRfqCopies(list[index], r), key: list[index].key };
      else {
        at.set(r.key, list.length);
        if (rfqOf(r)) rfqs.set(rfqOf(r), list.length);
        list.push(r);
      }
    }
    savePositions(list, net);
  }
  return loadPositions("mainnet");
}

/** What a position is worth now at the published sell-back price after Derive's exit fees, what it
 * paid at settlement, or what the user got selling back. A position with only its first option
 * filled has no value here: Cowboy prices the full answer only. */
export function valuePosition(p, found, settlePrice = null, exitFees = null) {
  const w = p.hi - p.lo;
  if (partial(p)) return { settled: settlePrice != null, partial: true, now: null };
  if (p.closed_at) return { settled: true, closed: true, got: p.proceeds };
  if (settlePrice != null) {
    const y = Math.min(1, Math.max(0, (settlePrice - p.lo) / w));
    const per = p.side === "yes" ? y : 1 - y;
    return { settled: true, per, got: per * w * p.contracts };
  }
  const side = found?.level?.[p.side];
  if (!side || side.sell == null || found?.level?.state === "settling") return { settled: false, now: null };
  if (p.legs && !sameLegs(p.legs, side.legs)) return { settled: false, now: null, otherLegs: true };
  const gross = side.sell * w * p.contracts;
  return { settled: false, gross, fees: exitFees, now: exitFees == null ? null : gross - exitFees, mark: found.level.fair == null ? null
    : (p.side === "yes" ? found.level.fair : 1 - found.level.fair) * w * p.contracts };
}

/** How a position was placed and where it stands, in plain words for its status line. */
export function positionStatus(p, { settled = false, settling = false } = {}) {
  // One-tap wording exists only in testnet builds (production shows no hint of one tap).
  const oneTap = TESTNET_FILLS && p.exec === "rfq";
  if (oneTap && incompleteReceipt(p)) return { key: "checking", warn: true, text: "Bought in one tap · Derive's records still being checked" };
  if (p.closed_at) return { key: "closed", text: TESTNET_FILLS && (p.exits || []).some((e) => e.via === "rfq") ? "Closed · sold back in one tap" : "Closed · sold back by hand" };
  if (settled && !partial(p)) return { key: "settled", text: "Settled" };
  if (partial(p)) return { key: "partial", warn: true, text: p.journal?.fill?.legs?.[1]?.qty > 0
    ? "Placed by hand · not fully filled" : "Placed by hand · only the first filled" };
  if (settling) return { key: "settling", text: "Settling · average from 07:30 to 08:00 UTC" };
  if (oneTap) return { key: "both", text: (p.journal?.fill?.filled_pct ?? 1) < 1 ? "Bought in one tap · part filled" : "Bought in one tap" };
  return { key: "both", text: "Placed by hand · both filled" };
}

/**
 * Every figure a Positions card shows, from the saved position, its question on the board (or
 * null), the settlement price once known, a sell-back ticket (`closeTicket`, or null) and the
 * coin's price now. Cash amounts are dollars; P/L is always after what was paid, fees included.
 *   paid, maxPayout             what went in, and the most the answer pays at settlement
 *   valueNow, plNow             Derive's sell-back price now, after its exit fees, and P/L if sold
 *   expiryNow, plExpiryNow      what it pays at 08:00 UTC if the coin settles at today's price
 *   got, pl                     settled or sold back: what came back and the result
 * A partial fill (only the first option) carries no value for the answer: every figure but paid is null.
 */
export function positionFigures(p, { found = null, settlePrice = null, close = null, index = null } = {}) {
  const w = p.hi - p.lo;
  const maxPayout = w * p.contracts;
  const paid = p.exec === "rfq" && (!Number.isFinite(p.journal?.cost?.total) || !Number.isFinite(p.journal?.cost?.fees)) ? null : p.paid;
  const result = (v) => Number.isFinite(v) && Number.isFinite(paid) ? v - paid : null;
  const base = { paid, maxPayout, valueNow: null, plNow: null, expiryNow: null, plExpiryNow: null, got: null, pl: null };
  if (partial(p)) return { ...base, maxPayout: null, partial: true };
  if (p.closed_at) return { ...base, closed: true, got: p.proceeds, pl: result(p.proceeds) };
  if (settlePrice != null) {
    const per = payAt(settlePrice, p.lo, p.hi, p.side);
    const got = per * maxPayout;
    return { ...base, settled: true, per, got, pl: result(got) };
  }
  const v = valuePosition(p, found, null, close ? close.fees : null);
  const expiryNow = Number.isFinite(index) ? payAt(index, p.lo, p.hi, p.side) * maxPayout : null;
  return {
    ...base, otherLegs: !!v.otherLegs, mark: v.mark ?? null, fees: v.fees ?? null,
    valueNow: v.now ?? null, plNow: result(v.now),
    expiryNow, plExpiryNow: result(expiryNow),
  };
}

/** Closing now: what Derive's sell-back price brings after its fees, and the result against what was
 * paid, beside holding to 08:00 UTC at today's price. */
export function closeSummary(t, paid, holdPayout = null) {
  if (!t) return null;
  const proceeds = Number.isFinite(t.premium) && Number.isFinite(t.fees) ? t.premium - t.fees : null;
  return { gross: t.premium, fees: t.fees, proceeds, pl: Number.isFinite(proceeds) && Number.isFinite(paid) ? proceeds - paid : null,
    holdPayout, holdPl: Number.isFinite(holdPayout) && Number.isFinite(paid) ? holdPayout - paid : null };
}

export function _resetMemory() {
  memory = { mainnet: [], testnet: [] };
  lastWriteOk = true;
}
