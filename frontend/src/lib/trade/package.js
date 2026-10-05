// Saloon stage 2, P1: the package maths. Pure functions only: nothing here touches the network.
// A Saloon answer becomes one Derive RFQ package of option legs, always a debit package (the user
// pays once and Derive holds nothing more). Prices are per $1 of payout; dollars are USDC.

export const TRADE_LIMITS = {
  perAnswer: 250, // a warning above this "Most you can lose" per answer (never a block)
  perAnswerTestnet: 250, // the same warning on testnet
  perDay: 1000, // a warning past this total bought per wallet per day, in this browser
  maxPerDollar: 0.99, // the ceiling never goes above 99c per $1
  minPerDollar: 0.01, // the sell-back floor never goes below 1c per $1
  tolerance: { major: 0.02, thin: 0.03 }, // T: board price + 2c (BTC, ETH), + 3c thin coins
  betweenTolerance: 0.05, // Inside and Outside: clipped mark + 5c
  feeCeiling: { mult: 1.5, plus: 0.5 }, // Derive's suggested max fee may be at most estimate x 1.5 + $0.50
  marginSlack: 0.01, // margin before and after must match to the cent
};

const ok = (v) => v != null && Number.isFinite(v);
const round = (x, d = 8) => Math.round(x * 10 ** d) / 10 ** d;

/** Derive writes fractional strikes with "_" (1_35 is 1.35); everywhere else uses ".". */
export function strikeText(k) {
  const s = String(Number(round(k, 8)));
  return s.replace(".", "_");
}
export function instrumentName(und, expiry, strike, type) {
  return `${und}-${expiry}-${strikeText(strike)}-${type}`;
}
export function parseInstrument(name) {
  const m = /^([A-Z0-9]+)-(\d{8})-([\d_]+)-([CP])$/.exec(name || "");
  if (!m) return null;
  return { und: m[1], expiry: m[2], strike: Number(m[3].replace("_", ".")), type: m[4] };
}

/** Contract amounts as Derive takes them: a plain decimal, no exponent, no trailing zeros. */
export function amountText(n) {
  if (!ok(n) || n <= 0) throw new Error("amount must be positive");
  const s = n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}
/** Dollar figures for RFQ limits: two decimals are Derive's cent. */
export const usdText = (x) => (Math.round(x * 100) / 100).toFixed(2);

const floorTo = (x, step) => round(Math.floor(x / step + 1e-9) * step, 8);

/** The answer kinds stage 2 builds. Up and Down are Yes and No at the headline level. */
export const KINDS = ["yes", "no", "up", "down", "inside", "outside"];

/**
 * The legs of one answer, the taker's side when buying, sorted by instrument name.
 * Yes: buy call lo, sell call hi. No: buy put hi, sell put lo. Inside (L..H, one strike step s): a call
 * condor (buy L-s, sell L, sell H, buy H+s), or a butterfly (buy K-s, sell 2 x K, buy K+s) when L = H.
 * Outside: buy put L, sell put L-s, buy call H, sell call H+s. Each leg holds `mult` x contracts.
 */
export function packageLegs({ und, expiry, kind, lo, hi, step }) {
  const name = (k, t) => instrumentName(und, expiry, k, t);
  let legs;
  if (kind === "yes" || kind === "up") legs = [[name(lo, "C"), "buy", 1], [name(hi, "C"), "sell", 1]];
  else if (kind === "no" || kind === "down") legs = [[name(hi, "P"), "buy", 1], [name(lo, "P"), "sell", 1]];
  else if (kind === "inside") {
    if (!ok(step) || step <= 0) throw new Error("inside needs the strike step");
    legs = lo === hi
      ? [[name(lo - step, "C"), "buy", 1], [name(lo, "C"), "sell", 2], [name(lo + step, "C"), "buy", 1]]
      : [[name(lo - step, "C"), "buy", 1], [name(lo, "C"), "sell", 1], [name(hi, "C"), "sell", 1], [name(hi + step, "C"), "buy", 1]];
  } else if (kind === "outside") {
    if (!ok(step) || step <= 0) throw new Error("outside needs the strike step");
    legs = [[name(lo, "P"), "buy", 1], [name(lo - step, "P"), "sell", 1], [name(hi, "C"), "buy", 1], [name(hi + step, "C"), "sell", 1]];
  } else throw new Error(`unknown answer kind ${kind}`);
  if (!(hi >= lo) || lo <= 0) throw new Error("bad levels");
  return legs.map(([instrument_name, direction, mult]) => ({ instrument_name, direction, mult }))
    .sort((a, b) => (a.instrument_name < b.instrument_name ? -1 : a.instrument_name > b.instrument_name ? 1 : 0));
}

/** The width that pays $1 per contract: the zone for above/below, the strike step for between. */
export const payWidth = ({ kind, lo, hi, step }) => (kind === "inside" || kind === "outside" ? step : hi - lo);

/** Every package must be one currency, one expiry, unique instruments and positive amounts. */
export function validateLegs(legs) {
  const parsed = legs.map((l) => parseInstrument(l.instrument_name));
  if (parsed.some((p) => !p)) throw new Error("bad instrument name");
  if (new Set(parsed.map((p) => p.und)).size !== 1) throw new Error("legs mix currencies");
  if (new Set(parsed.map((p) => p.expiry)).size !== 1) throw new Error("legs mix expiries");
  if (new Set(legs.map((l) => l.instrument_name)).size !== legs.length) throw new Error("legs repeat an instrument");
  const names = legs.map((l) => l.instrument_name);
  if (names.join() !== [...names].sort().join()) throw new Error("legs out of order");
  return true;
}

/** The legs Derive takes: amounts in contracts as decimal strings (a butterfly body is 2 x). */
export function wireLegs(legs, contracts) {
  validateLegs(legs);
  return legs.map((l) => ({ instrument_name: l.instrument_name, direction: l.direction, amount: amountText(round(contracts * (l.mult || 1), 12)) }));
}

/** What the package pays at settlement S, in dollars, for the given contracts. */
export function payoffAt(legs, S, contracts = 1) {
  return legs.reduce((a, l) => {
    const p = parseInstrument(l.instrument_name);
    const intrinsic = p.type === "C" ? Math.max(0, S - p.strike) : Math.max(0, p.strike - S);
    return a + (l.direction === "buy" ? 1 : -1) * (l.mult || 1) * intrinsic * contracts;
  }, 0);
}

/** Contracts for a dollar amount at a price per $1, floored to Derive's amount step. */
export function contractsFor(dollars, perDollar, width, step) {
  if (!ok(dollars) || !ok(perDollar) || perDollar <= 0 || !(width > 0)) return 0;
  return floorTo(Math.max(0, dollars) / (perDollar * width), step || 0.00001);
}

/** Tolerance T for a coin: 2c for BTC and ETH, 3c for thin books. */
export const toleranceFor = (thin) => (thin ? TRADE_LIMITS.tolerance.thin : TRADE_LIMITS.tolerance.major);

/** The hard ceiling a buy RFQ carries: payout x min(board buy + T, 99c). */
export function maxTotalCost(payout, boardBuy, T) {
  if (!ok(payout) || !ok(boardBuy)) return null;
  return Math.floor(round(payout * Math.min(boardBuy + T, TRADE_LIMITS.maxPerDollar) * 100, 6)) / 100; // down to the cent
}
/** The floor a sell RFQ carries: payout x max(board sell-back - T, 1c). */
export function minTotalCost(payout, boardSell, T) {
  if (!ok(payout) || !ok(boardSell)) return null;
  return Math.ceil(round(payout * Math.max(boardSell - T, TRADE_LIMITS.minPerDollar) * 100, 6)) / 100; // up to the cent
}

/**
 * Derive's RFQ fee estimate: the taker pays one $0.50 base fee per package plus, per leg,
 * min(taker rate x index, cap x leg price) x amount. Legs group into long calls, long puts, short
 * calls and short puts; the most expensive group pays in full, the cheapest pays nothing, and the
 * second and third cheapest pay half. A single group pays in full.
 */
export function rfqFee(legs, contracts, { index, taker = 0.0003, cap = 0.125, base = 0.5 }, prices = {}) {
  const groups = {};
  for (const l of legs) {
    const p = parseInstrument(l.instrument_name);
    const g = `${l.direction}-${p.type}`;
    const price = prices[l.instrument_name];
    const per = ok(price) ? Math.min(taker * index, cap * price) : taker * index;
    groups[g] = (groups[g] || 0) + per * contracts * (l.mult || 1);
  }
  const fees = Object.values(groups).sort((a, b) => b - a); // most expensive first
  const n = fees.length;
  const weight = (i) => (n === 1 || i === 0 ? 1 : i === n - 1 ? 0 : 0.5);
  return base + fees.reduce((a, f, i) => a + f * weight(i), 0);
}

/** The most Cowboy lets Derive charge: the schedule estimate x 1.5 plus $0.50. */
export const feeCeiling = (estimate) => estimate * TRADE_LIMITS.feeCeiling.mult + TRADE_LIMITS.feeCeiling.plus;

/** A package's cost from a quote's legs: the legs keep the RFQ's sides, so the sum is what buying
 * the package costs and what selling it back brings in. */
export function packageCost(quoteLegs) {
  return round(quoteLegs.reduce((a, l) => a + (l.direction === "buy" ? 1 : -1) * Number(l.price) * Number(l.amount), 0), 8);
}

/**
 * The checks a firm quote passes before it is shown with a Buy (or Sell) button (design 2.4):
 * within the ceiling (buy) or above the floor (sell), margin unchanged, Derive's fee within the
 * ceiling, and Derive's own validity. Returns { ok, reason, ... } with the figures the ticket shows.
 */
export function checkQuote(best, { direction, payout, limit, feeEstimate }) {
  if (!best) return { ok: false, reason: "no_quote" };
  if (best.is_valid === false) return { ok: false, reason: "invalid", detail: best.invalid_reason || "" };
  const total = Number(best.estimated_total_cost);
  const fee = Number(best.estimated_fee);
  const maxFee = Number(best.suggested_max_fee);
  const perDollar = payout ? Math.abs(total) / payout : null;
  const figures = { total: Math.abs(total), fee, maxFee, perDollar };
  if (!ok(total) || !ok(fee)) return { ok: false, reason: "invalid", ...figures };
  if (direction === "buy" && ok(limit) && Math.abs(total) > limit + 1e-9) return { ok: false, reason: "beyond", ...figures };
  if (direction === "sell" && ok(limit) && Math.abs(total) < limit - 1e-9) return { ok: false, reason: "beyond", ...figures };
  const pre = Number(best.pre_initial_margin), post = Number(best.post_initial_margin);
  if (!ok(pre) || !ok(post) || Math.abs(post - pre) > TRADE_LIMITS.marginSlack) return { ok: false, reason: "margin", ...figures };
  if (ok(feeEstimate) && maxFee > feeCeiling(feeEstimate) + 1e-9) return { ok: false, reason: "fee", ...figures };
  return { ok: true, reason: null, ...figures, mostLose: direction === "buy" ? Math.abs(total) + fee : null, net: direction === "sell" ? Math.abs(total) - fee : null };
}

/** Large-trade warnings (owner, 5 October 2026: warn, never block): over $250 most-you-can-lose on
 * one answer, or past $1,000 bought today in this browser. The trade always stays allowed. */
export function capCheck(mostLose, { boughtToday = 0, testnet = true } = {}) {
  const per = testnet ? TRADE_LIMITS.perAnswerTestnet : TRADE_LIMITS.perAnswer;
  if (mostLose > per + 1e-9) return { ok: true, warn: "per_answer", cap: per, mostLose };
  if (boughtToday + mostLose > TRADE_LIMITS.perDay + 1e-9) return { ok: true, warn: "per_day", cap: TRADE_LIMITS.perDay, today: boughtToday + mostLose };
  return { ok: true, warn: null };
}
