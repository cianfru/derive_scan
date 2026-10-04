// Questions: plain price outcomes built from Derive option spreads (stage 1), answered Higher or Lower.
// Everything here works on the published files (questions/*.json); nothing is fetched per user.
// Prices are cents per $1 of payout; nothing here is ever a chance.

export { QUESTIONS_ON } from "./flags.js";

// Derive's options screen. A referral code from Derive's API Broker programme (a public code, not a
// secret) is added to the link when configured; empty by default.
export const DERIVE_OPTIONS_URL = import.meta.env.VITE_DERIVE_OPTIONS_URL || "https://app.derive.xyz/trade/options";
export const DERIVE_REFERRAL = import.meta.env.VITE_DERIVE_REFERRAL || "";
export const DERIVE_REFERRAL_PARAM = import.meta.env.VITE_DERIVE_REFERRAL_PARAM || "ref";

export const STALE_SEC = 35 * 60;
export const PAUSED_SEC = 90 * 60;
export const DASH = "—";

export function deriveLink(code = DERIVE_REFERRAL, base = DERIVE_OPTIONS_URL, param = DERIVE_REFERRAL_PARAM) {
  if (!code) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${encodeURIComponent(param)}=${encodeURIComponent(code)}`;
}

const ok = (v) => v != null && Number.isFinite(v);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Buy prices round up and sell-back prices round down, to whole cents: the screen never shows a
 * better price than the book. */
export const centsUp = (x) => (ok(x) ? Math.min(99, Math.max(1, Math.ceil(Math.round(x * 1e6) / 1e4))) : null);
export const centsDown = (x) => (ok(x) ? Math.min(99, Math.max(0, Math.floor(Math.round(x * 1e6) / 1e4))) : null);
export const cents = (c) => (c == null ? DASH : `${c}c`);

// Settling starts 30 minutes before the 08:00 UTC expiry (questions.py settling_sec), by the
// clock now, never by the time of the last quote: a 07:15 file is not offered at 07:45.
export const SETTLING_SEC = 1800;
// A side above 99c per $1 is not offered (questions.py SIDE_MAX_BUY): it is never shown as 99c.
export const MAX_BUY = 0.99;
/** The 08:00 UTC settlement of a question id's date, in seconds, or null. */
export function settleOf(level) {
  const e = parseId(level?.id)?.expiry;
  return e ? Date.UTC(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8), 8) / 1000 : null;
}
/** True from 07:30 UTC on the level's date, by the clock now. */
export function settlingNow(level, now = Date.now() / 1000) {
  const s = settleOf(level);
  return level?.state === "settling" || (s != null && now >= s - SETTLING_SEC);
}

/** A side can be bought when its level and the side are open, the prices are not paused, the
 * date is not settling by the clock now and the price is at most 99c. Only debit packages are
 * offered (owner, 4 October 2026); a credit side left in an older file is not. */
export function live(level, side, paused = false, now = Date.now() / 1000) {
  const s = level?.[side];
  return !paused && level?.state === "open" && s?.state === "open" && ok(s?.buy) && s.buy <= MAX_BUY
    && s?.form !== "credit" && !settlingNow(level, now);
}

/** Why a side has no price now, in plain words for the (i) beside "No price now". */
export function noPriceReason(level, side, paused = false) {
  const s = level?.[side];
  if (paused) return "Prices are paused: Cowboy has had no fresh read of Derive's screen for over 90 minutes.";
  if (settlingNow(level)) return "This date is settling: Derive averages the index from 07:30 to 08:00 UTC.";
  if (level?.state === "tail") return "This level is far from the price now, so Cowboy does not offer it.";
  if (level?.state === "retired") return "This level is off the board; it stays only for those who hold it.";
  if (s?.form === "credit") return "Cowboy offers each answer only as two options bought and sold for a net payment, and Derive's screen has no such price here right now.";
  if (s?.state === "tail" || (s?.state === "open" && ok(s?.buy) && s.buy > MAX_BUY)) return "This answer would cost more than 99c per $1 of payout, so Cowboy does not offer it.";
  if (s?.state === "screen_wide") return "Derive's screen is too wide here: buying now costs more over Derive's mark than Cowboy's check allows.";
  return "Derive's screen has no price on both options with enough size right now.";
}
export const buyCents = (level, side, paused = false, now = Date.now() / 1000) => (live(level, side, paused, now) ? centsUp(level[side].buy) : null);

/** The gap: shown buy minus shown sell-back, per $1. */
export function gap(side) {
  if (!side || !ok(side.buy) || !ok(side.sell)) return null;
  return centsUp(side.buy) - centsDown(side.sell);
}

/** Price age from the slot start: fresh, stale (35 min) or paused (90 min). */
export function priceAge(pricesTs, now = Date.now() / 1000, pausedFlag = false) {
  const age = ok(pricesTs) ? now - pricesTs : Infinity;
  const state = pausedFlag || age > PAUSED_SEC ? "paused" : age > STALE_SEC ? "stale" : "fresh";
  return { state, minutes: Math.max(0, Math.round(age / 60)) };
}

/** Coin amounts and levels: whole dollars from $100, otherwise up to 4 significant decimals. */
export function money(v, { cents: withCents = false } = {}) {
  if (!ok(v)) return DASH;
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (withCents) return `${s}$${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const d = a >= 100 || Number.isInteger(a) ? 0 : a >= 1 ? 2 : 4;
  const t = a.toLocaleString("en-US", { minimumFractionDigits: d === 2 ? 2 : 0, maximumFractionDigits: d });
  return `${s}$${t}`;
}

/** "Fri 9 Oct" from YYYYMMDD. */
export function dayLabel(yyyymmdd) {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function parseId(id) {
  const m = /^([A-Z0-9]+)-(\d{8})-A-([\d_]+)-([\d_]+)$/.exec(id || "");
  if (!m) return null;
  const n = (s) => Number(s.replace("_", "."));
  return { und: m[1], expiry: m[2], lo: n(m[3]), hi: n(m[4]), k: (n(m[3]) + n(m[4])) / 2 };
}

/** The question in one line, settling on the date at 08:00 UTC (never "by" a date). */
export function questionText(und, level, expiry) {
  return `${und} higher or lower than ${money(level.k)} on ${dayLabel(expiry)}, 08:00 UTC?`;
}
/** Higher pays from the top of the zone, Lower at or below its bottom; both pay part inside it. */
export const answerNames = () => ({ yes: "Higher", no: "Lower" });
export const ANSWER = { yes: "Higher", no: "Lower" };
/** Where an answer pays in full: always shown beside the answer, since the payout ramps. */
export const fullPay = (level, side) => (side === "yes" ? `full $1 from ${money(level.hi)}` : `full $1 at or below ${money(level.lo)}`);

/** Where Yes pays: nothing below lo, $1 from hi, in part between (No is the mirror). */
export function payAt(settle, lo, hi, side = "yes") {
  const y = Math.min(1, Math.max(0, (settle - lo) / (hi - lo)));
  return side === "yes" ? y : 1 - y;
}

/** What a ticket pays and makes if the coin settles at `settle`: the payout (total back) and the
 * profit or loss after everything paid (premium and fees). */
export function outcome(t, level, side, settle) {
  const payout = payAt(settle, level.lo, level.hi, side) * t.payout;
  return { settle, payout, pl: payout - t.mostLose };
}

/** The settlement price where the payout equals what was paid, or null when it never does. */
export function breakeven(t, level, side) {
  if (!t?.payout) return null;
  const f = t.mostLose / t.payout;
  if (!(f > 0) || f >= 1) return null;
  const w = level.hi - level.lo;
  return side === "yes" ? level.lo + f * w : level.hi - f * w;
}

/** A slider step for a zone width: about 1/60 of the zone, on a 1-2-5 scale. */
export function sliderStep(w) {
  const raw = w / 60;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return Number(((m >= 5 ? 5 : m >= 2 ? 2 : 1) * p).toPrecision(6));
}

/** "+$21.19" / "-$101.75" / "$0.00": profit or loss in dollars. */
export const signed = (v) => (ok(v) ? `${v > 0.004 ? "+" : v < -0.004 ? "-" : ""}${money(Math.abs(v), { cents: true })}` : DASH);

export function countdown(settleTs, now = Date.now() / 1000) {
  const s = settleTs - now;
  if (s <= 0) return null;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `in ${d}d ${h}h` : `in ${h}h ${m}m`;
}

const floorTo = (x, step) => Math.round(Math.floor(x / step + 1e-9) * step * 1e8) / 1e8;

/** Derive's order-book fee for one leg: base + min(taker x index, cap x premium) x contracts. */
export function legFee(index, price, contracts, spec) {
  return spec.base + Math.min(spec.taker * index, spec.cap * price) * contracts;
}

/** Everything the amount panel and the ticket show for a dollar amount on one side of a level.
 * Contracts floor to the amount step and are capped at the size at this price. */
export function ticket(level, sideKey, dollars, board) {
  const side = level?.[sideKey];
  const spec = board?.spec || {};
  if (!side || !ok(side.buy) || !side.legs) return null;
  const w = level.hi - level.lo;
  const step = spec.step || 0.00001;
  const minimum = spec.min || step;
  const net = side.legs.reduce((a, [, s, p]) => a + (s === "buy" ? p : -p), 0); // per contract, debit > 0
  // Cash at risk per contract, from the legs' own prices: the net paid, or for a credit spread the
  // width Derive holds minus the credit received.
  const perContract = side.form === "credit" ? w + net : net;
  const cap = ok(side.size) ? floorTo(side.size / w, step) : Infinity;
  let contracts = floorTo(Math.max(0, dollars) / perContract, step);
  const capped = contracts > cap;
  if (capped) contracts = cap;
  const belowMin = contracts < minimum - 1e-12;
  const premium = perContract * contracts;
  const fees = side.legs.reduce((a, [, , p]) => a + legFee(board.index, p, contracts, spec), 0);
  const payout = contracts * w;
  const pay = (s) => payAt(s, level.lo, level.hi, sideKey) * payout;
  return {
    contracts, net, premium, fees, payout, capped, belowMin, cap, capPayout: cap * w,
    minPayout: minimum * w, minCost: minimum * perContract,
    mostLose: premium + fees, atK: pay(level.k),
    credit: side.form === "credit" ? -net * contracts : null, held: side.form === "credit" ? w * contracts : null,
    perDollar: payout ? (premium + fees) / payout : null,
  };
}

/** Placing by hand, the two orders fill separately: the cash line 1 needs on its own, what it can
 * lose if line 2 never fills (its price and fee), and the completed spread's most you can lose. */
export function handRisk(t, level, sideKey, board) {
  const leg = level?.[sideKey]?.legs?.[0];
  if (!t || !leg) return null;
  const upfront = leg[2] * t.contracts;
  const fee = legFee(board.index, leg[2], t.contracts, board.spec || {});
  return { upfront, firstLose: upfront + fee, both: t.mostLose };
}

/** Contract amounts as Derive takes them (no trailing zeros). */
export const amountText = (n) => (ok(n) ? String(Number(n.toFixed(8))) : DASH);
/** A per-contract limit on the instrument's tick. */
export function limitText(p, tick) {
  if (!ok(p)) return DASH;
  // On the instrument's tick when known; otherwise the price as published (up to 4 decimals).
  const d = tick ? (tick < 1 ? Math.max(0, Math.round(-Math.log10(tick))) : 0) : Math.abs(p) >= 1000 ? 0 : 4;
  if (!tick) return String(Number(p.toFixed(d)));
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
}

/** The legs in the order to place them: the bought leg first when opening; when selling back,
 * the short leg is bought back first, so the account never holds a lone short. */
export function orderedLegs(side, closing = false) {
  const legs = closing ? side?.close : side?.legs;
  return (legs || []).map(([name, act, limit]) => ({ name, act, limit }));
}

/** The text "Copy both" puts on the clipboard. */
export function copyText({ question, answer, legs, contracts, tick, settleTs }) {
  const lines = [`${question} ${answer}`];
  for (const l of legs) lines.push(`${l.act.toUpperCase().padEnd(4)} ${l.name}  ${amountText(contracts)}  limit ${limitText(l.limit, tick)}`);
  const d = new Date(settleTs * 1000).toISOString().slice(0, 10);
  lines.push(`Place line 2 only after line 1 has filled. Settles ${d} 08:00 UTC, 30-minute average.`);
  return lines.join("\n");
}

/** The levels of a date for the ladder: the 7 (or 15) around the price now, highest first. */
export function ladder(date, more = false) {
  const rows = (date?.levels || []).filter((lv) => lv.ladder && (more ? lv.ladder <= 15 : lv.ladder === 7) && lv.state !== "retired");
  return rows.sort((a, b) => b.k - a.k);
}

export function findLevel(board, id) {
  for (const d of board?.dates || []) {
    const lv = d.levels.find((x) => x.id === id);
    if (lv) return { date: d, level: lv };
  }
  for (const d of board?.settled || []) {
    const lv = d.levels.find((x) => x.id === id);
    if (lv) return { date: d, level: lv, settled: true };
  }
  return null;
}

/** The word check for Questions copy: stems, not only words ("between" passes). */
export const BANNED = /\b(will|expect\w*|likely|predict\w*|target\w*|probab\w*|odds|chance\w*|forecast\w*|bet(s|ting)?|edges?|wager\w*|gambl\w*|guarantee\w*|risk-free)\b/i;

/** Selling back a held position: the legs reversed at the current prices, for its contracts. */
export function closeTicket(level, sideKey, contracts, board, held = null) {
  const side = level?.[sideKey];
  const spec = board?.spec || {};
  if (!side?.close || !ok(side.sell)) return null;
  // Only the instruments actually held can be sold back: when the board now builds this answer
  // from other options (an older position), there is no sell-back price here.
  if (held && !sameLegs(held, side.legs)) return null;
  const w = level.hi - level.lo;
  const net = side.close.reduce((a, [, s, p]) => a + (s === "sell" ? p : -p), 0); // received per contract
  const fees = side.close.reduce((a, [, , p]) => a + legFee(board.index, p, contracts, spec), 0);
  const premium = side.sell * w * contracts;
  return { contracts, net, premium, fees, proceeds: premium - fees, payout: contracts * w, capped: false };
}

/** True when a saved position's instruments are the ones the board prices now. */
export function sameLegs(held, legs) {
  const now = (legs || []).map(([n]) => n);
  return Array.isArray(held) && held.length === now.length && held.every((n) => now.includes(n));
}
