// Large trades as stories (owner, 10 October 2026: the Flow page is "kind of hard to read"): the legs one
// wallet sends together are one trade, named in plain words ("sold a BTC strangle") and valued by the money
// that changed hands, not by notional. Pure, so the Flow page and the home card tell the same stories.
import { optionLabel, strike } from "./format.js";

/** Legs from one wallet on one coin within this many milliseconds are one trade (one RFQ fills its legs together). */
export const SAME_TRADE_MS = 5000;

/** How each wallet kind reads in a sentence; market makers never reach the published sample. */
export const WALLET_WORD = { top: "Smart wallet", smart: "Smart wallet", profitable: "Profitable trader", directional: "Directional trader",
  income: "Income seller", hedger: "Hedger", occasional: "Occasional trader" };

// "an ETH call spread", "a BTC strangle": the coins read letter by letter that start with a vowel sound.
const AN = new Set(["ETH", "XRP", "ADA", "XAUT"]);
export const article = (und) => (AN.has(und) ? "an" : "a");
const nb = (t) => t.replace(/ /g, "\u00a0");

const legOf = (t) => {
  const o = optionLabel(t.instrument);
  // A date in another year carries it ("Sep 24 2027"); this year's dates read as Derive writes them.
  const label = o.expiry && o.expiry.slice(0, 4) !== String(new Date().getUTCFullYear()) ? `${o.expiryLabel} ${o.expiry.slice(0, 4)}` : o.expiryLabel;
  return { ...t, underlying: t.underlying || o.und, type: o.type, k: o.strike, expiry: o.expiry, expiryLabel: label, buy: t.direction === "buy",
    premium: Number(t.premium_usd) || 0 };
};

/** Groups option legs into trades: same wallet and coin, each leg within SAME_TRADE_MS of the one before. */
export function groupTrades(large) {
  const legs = (large || []).filter((t) => t.kind === "option" && optionLabel(t.instrument).type).map(legOf)
    .sort((a, b) => (a.wallet === b.wallet ? (a.underlying === b.underlying ? a.ts - b.ts : a.underlying < b.underlying ? -1 : 1) : a.wallet < b.wallet ? -1 : 1));
  const out = [];
  for (const l of legs) {
    const g = out[out.length - 1];
    if (g && g.wallet === l.wallet && g.und === l.underlying && l.ts - g.legs[g.legs.length - 1].ts <= SAME_TRADE_MS) g.legs.push(l);
    else out.push({ wallet: l.wallet, und: l.underlying, legs: [l] });
  }
  return out.map(story);
}

/**
 * One trade: what it is ("call spread", "strangle", "calls"), whether the wallet paid or collected, the net
 * money, the legs as plain text, and the facts kept for the (i) (notional, block trade).
 */
export function story(g) {
  const legs = [...g.legs].sort((a, b) => a.k - b.k || (a.type < b.type ? -1 : 1));
  const paid = legs.filter((l) => l.buy).reduce((s, l) => s + l.premium, 0);
  const got = legs.filter((l) => !l.buy).reduce((s, l) => s + l.premium, 0);
  const net = paid - got;
  const first = legs[0];
  const types = new Set(legs.map((l) => l.type)), dirs = new Set(legs.map((l) => l.buy)), expiries = new Set(legs.map((l) => l.expiry));
  // Spreads, straddles, strangles and rolls hold equal amounts on each leg; anything else is named by its legs.
  const even = legs.every((l) => Math.abs((Number(l.amount) || 0) - (Number(first.amount) || 0)) <= 1e-9 * Math.max(1, Number(first.amount) || 0));
  const near = legs.reduce((a, b) => (b.expiry < a.expiry ? b : a)), far = legs.reduce((a, b) => (b.expiry > a.expiry ? b : a));
  const nearDays = near.expiry ? (Date.parse(`${near.expiry}T08:00:00Z`) - Math.min(...legs.map((l) => l.ts))) / 864e5 : Infinity;
  let what, plural = false;
  if (legs.length === 1) { what = `${first.type}s`; plural = true; }
  else if (legs.length === 2 && even && expiries.size === 1 && types.size === 1 && dirs.size === 2) what = `${first.type} spread`;
  else if (legs.length === 2 && even && expiries.size === 2 && types.size === 1 && dirs.size === 2 && legs[0].k === legs[1].k)
    // The same option closed on a date about to settle and opened on a later one: the position moved. Otherwise two dates.
    what = nearDays <= 2 ? "roll" : "two dates";
  else if (legs.length === 2 && even && expiries.size === 1 && types.size === 2 && dirs.size === 1) what = legs[0].k === legs[1].k ? "straddle" : "strangle";
  else if (dirs.size === 1 && types.size === 1) { what = `${first.type}s`; plural = true; }
  else what = "together";
  // A package's verb follows its money; a single side's, its direction.
  const bought = dirs.size === 1 ? first.buy : net >= 0;
  const verb = bought ? "bought" : "sold";
  const text = what === "roll" ? `rolled ${g.und} ${first.type}s to ${far.expiryLabel}`
    : what === "two dates" ? `traded ${g.und} ${first.type}s on two dates`
      : what === "together" ? `traded ${legs.length} ${g.und} options together`
        : `${verb} ${plural ? "" : `${article(g.und)} `}${g.und} ${what}`;
  const kind = first.class;
  return {
    key: `${g.wallet}-${first.ts}-${g.und}`, wallet: g.wallet, und: g.und, kind, who: WALLET_WORD[kind] || null, ranked: legs.some((l) => l.ranked),
    ts: Math.min(...legs.map((l) => l.ts)) / 1000, legs,
    // The trade's form: coin, each leg's side, strike, type and date, and its size against the first leg.
    text, shape: `${g.und}:${legs.map((l) => `${l.buy ? "+" : "-"}${l.k}${l.type}${l.expiry}x${((Number(l.amount) || 0) / (Number(first.amount) || 1)).toFixed(3)}`).join(",")}`,
    verb, paid: bought, money: Math.abs(net), gross: paid + got,
    // Each leg and the date stay whole on a line (no-break spaces); lines break only at the dots.
    detail: (expiries.size > 1
      ? legs.map((l) => `${l.buy ? "buy" : "sell"} ${strike(l.k, "")} ${l.type} ${l.expiryLabel}`)
      : [...legs.map((l) => `${legs.length > 1 ? (l.buy ? "buy " : "sell ") : ""}${strike(l.k, "")} ${l.type}`), first.expiryLabel]).map(nb).join(" · "),
    notional: legs.reduce((s, l) => s + (Number(l.notional_usd) || 0), 0), block: legs.some((l) => l.rfq),
  };
}

/** Repeats within this many seconds (the same wallet sending the same trade again) read as one line, "×3". */
export const REPEAT_SEC = 1800;

/** One line per repeated trade: the same wallet and form (coin, legs, sizes in proportion) on the same side of
 * the money within REPEAT_SEC of the previous one; money, notional and count summed, the last time kept. */
export function mergeRepeats(list) {
  const out = [];
  for (const s of [...list].sort((a, b) => a.ts - b.ts)) {
    const prev = out.find((o) => o.wallet === s.wallet && o.shape === s.shape && o.paid === s.paid && s.ts - o.lastTs <= REPEAT_SEC);
    if (!prev) { out.push({ ...s, times: 1, lastTs: s.ts, single: s.money }); continue; }
    prev.times += 1; prev.lastTs = s.ts; prev.gross += s.gross; prev.notional += s.notional; prev.block = prev.block || s.block;
    prev.money += s.money; prev.single = Math.max(prev.single, s.money);
  }
  return out;
}

/** The trades, most money paid or collected first, or the latest first (by their last repeat). */
export function stories(large, order = "money") {
  const all = mergeRepeats(groupTrades(large));
  return order === "latest" ? all.sort((a, b) => b.lastTs - a.lastTs) : all.sort((a, b) => b.money - a.money || b.lastTs - a.lastTs);
}

/** The largest single trade (repeats not added up), for the home card's "Largest trade". */
export function largestTrade(large) {
  return groupTrades(large).sort((a, b) => b.money - a.money || b.ts - a.ts)[0] || null;
}

/** "Sold ETH puts": a story as the start of a sentence. */
export const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);
