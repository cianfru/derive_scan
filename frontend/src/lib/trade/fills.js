// Saloon stage 2, P6: what filled, from Derive's own records. A fill is read from
// private/get_trade_history (one row per leg: price, amount, fee, trade id, time) and, only when the
// history has not caught up, from private/execute_quote's own answer. Nothing here is entered by the
// user or estimated. Derive's times are milliseconds; Cowboy keeps seconds.

const num = (v) => (v == null || v === "" ? null : Number(v));
const ok = Number.isFinite;
const round = (x, d = 8) => Math.round(x * 10 ** d) / 10 ** d;
const secs = (t) => (t > 1e12 ? Math.floor(t / 1000) : Math.floor(t));

/**
 * One fill from the taker's trade rows of one RFQ. `planned` maps each instrument to the contracts
 * asked for (for "Filled X of Y"). Legs are sorted by instrument name. `premium` is signed from the
 * user's side: positive is paid (a buy), negative is received (a sell back).
 */
export function fillFromTrades(rows, { rfqId = null, planned = {}, source = "trade_history" } = {}) {
  const mine = (rows || []).filter((t) => t.liquidity_role !== "maker" && (!rfqId || t.rfq_id === rfqId));
  if (!mine.length) return null;
  const by = new Map();
  for (const t of mine) {
    const name = t.instrument_name;
    const amount = num(t.trade_amount), price = num(t.trade_price), fee = num(t.trade_fee);
    if (!name || !ok(amount) || !ok(price)) return null;
    const leg = by.get(name) || { name, act: t.direction, qty: 0, cost: 0, fee: 0, trade_ids: [] };
    if (leg.act !== t.direction) return null; // one RFQ never trades both sides of an instrument
    leg.qty += amount;
    leg.cost += amount * price;
    leg.fee += ok(fee) ? fee : 0;
    if (t.trade_id && !leg.trade_ids.includes(t.trade_id)) leg.trade_ids.push(t.trade_id);
    by.set(name, leg);
  }
  const legs = [...by.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map((l) => ({
    name: l.name, act: l.act, planned: planned[l.name] ?? null, qty: round(l.qty), signed_qty: round((l.act === "buy" ? 1 : -1) * l.qty),
    price: round(l.cost / l.qty, 8), fee: round(l.fee, 8), trade_ids: l.trade_ids,
  }));
  const premium = round(legs.reduce((a, l) => a + (l.act === "buy" ? 1 : -1) * l.qty * l.price, 0), 8);
  const fees = round(legs.reduce((a, l) => a + l.fee, 0), 8);
  return {
    source, rfq_id: rfqId ?? mine[0].rfq_id ?? null, quote_id: mine[0].quote_id ?? null, label: mine[0].label || null,
    ts: Math.max(...mine.map((t) => secs(num(t.timestamp) || 0))), legs, premium, fees,
    trade_ids: legs.flatMap((l) => l.trade_ids),
  };
}

/** The same fill from execute_quote's answer, when the trade history has not caught up: the quote's
 * legs at their prices times the share filled, and Derive's fee for the whole execution. No trade ids.
 * `userLegs` are the RFQ legs as the user trades them (the taker's sides). */
export function fillFromExecute(res, userLegs, { planned = {} } = {}) {
  if (!res || !Array.isArray(res.legs)) return null;
  const pct = num(res.fill_pct) ?? num(res.rfq_filled_pct) ?? 1;
  const price = Object.fromEntries(res.legs.map((l) => [l.instrument_name, num(l.price)]));
  const amount = Object.fromEntries(res.legs.map((l) => [l.instrument_name, num(l.amount)]));
  const legs = [...userLegs].sort((a, b) => (a.instrument_name < b.instrument_name ? -1 : 1)).map((l) => {
    const qty = round((amount[l.instrument_name] ?? num(l.amount)) * pct);
    return { name: l.instrument_name, act: l.direction, planned: planned[l.instrument_name] ?? null, qty,
      signed_qty: round((l.direction === "buy" ? 1 : -1) * qty), price: price[l.instrument_name], fee: null, trade_ids: [] };
  });
  if (legs.some((l) => !ok(l.price) || !(l.qty > 0))) return null;
  return {
    source: "execute_quote", rfq_id: res.rfq_id ?? null, quote_id: res.quote_id ?? null, label: res.label || null,
    ts: secs(num(res.last_update_timestamp) || num(res.creation_timestamp) || 0), legs,
    premium: round(legs.reduce((a, l) => a + (l.act === "buy" ? 1 : -1) * l.qty * l.price, 0), 8),
    fees: ok(num(res.fee)) ? num(res.fee) : null, trade_ids: [],
  };
}

/** The legs Cowboy trades for a direction: a buy takes the package legs as they are; a sell back
 * takes every leg the other way. */
export const userSide = (legs, direction) => legs.map((l) => ({ ...l, direction: direction === "buy" ? l.direction : l.direction === "buy" ? "sell" : "buy" }));

/** Contracts of the package in a fill (every leg of a Saloon package holds the same contracts x mult). */
export function fillContracts(fill, mults = {}) {
  const l = fill?.legs?.[0];
  return l ? round(l.qty / (mults[l.name] || 1)) : 0;
}

/**
 * True when a fill holds the whole package: every planned leg, each with its planned contracts times
 * the share filled (`pct`), and nothing else. Derive's history can catch up one leg at a time; a fill
 * read half way is not the package.
 */
export function fillComplete(fill, planned = {}, pct = 1) {
  const names = Object.keys(planned);
  if (!fill?.legs?.length || !names.length || fill.legs.length !== names.length) return false;
  const share = Number.isFinite(pct) && pct > 0 ? Math.min(1, pct) : 1;
  return names.every((n) => {
    const l = fill.legs.find((x) => x.name === n);
    const want = Number(planned[n]) * share;
    return !!l && Math.abs(l.qty - want) <= 1e-9 + 1e-6 * Math.abs(want);
  });
}

/**
 * A Saloon package read without its plan (sync, from the RFQ label): two legs, one bought and one
 * sold, the same contracts on each.
 */
export function packageComplete(fill) {
  const [a, b] = fill?.legs || [];
  return (fill?.legs || []).length === 2 && a.act !== b.act && a.qty > 0 && Math.abs(a.qty - b.qty) <= 1e-9 + 1e-6 * a.qty;
}

/** Every trade of the Saloon account since `sinceSec`, newest pages first, at most `maxPages` pages. */
export async function tradesSince(client, subaccountId, { sinceSec = 0, pageSize = 100, maxPages = 5 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const r = await client.call("private/get_trade_history", { subaccount_id: subaccountId, from_timestamp: Math.max(0, sinceSec) * 1000, page, page_size: pageSize });
    out.push(...(r?.trades || []));
    if (!r?.pagination || page >= (r.pagination.num_pages || 1)) break;
  }
  return out;
}

/** The trade rows of one execution: by the taker's quote id (execute_quote's answer), else by RFQ. */
export async function tradesOf(client, subaccountId, { rfqId, quoteId, sinceSec }) {
  if (quoteId) {
    const r = await client.call("private/get_trade_history", { subaccount_id: subaccountId, quote_id: quoteId });
    const rows = (r?.trades || []).filter((t) => !rfqId || t.rfq_id === rfqId);
    if (rows.length) return rows;
  }
  return (await tradesSince(client, subaccountId, { sinceSec: Math.max(0, (sinceSec || 0) - 60), maxPages: 2 })).filter((t) => t.rfq_id === rfqId);
}
