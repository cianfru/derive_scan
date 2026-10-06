// The outcome board: every live answer across coins and dates, priced for one budget.
// Rows are built, filtered and ordered from facts about the price only (what it costs over Derive's
// mark, whether it can be bought, its size, its date and level). The three research layers are
// never an input here: they are drawn beside each row as context and cannot change the order.

import { budgetTicket, centsUp, live, money, noPriceReason, priceAge } from "./questions.js";
import { markBenchmark } from "./journal.js";

export { budgetTicket };

export const DEFAULT_BUDGET = 100;
// The default view is by date: one row per coin and settlement date, soonest first, levels from
// low to high (owner, 4 October 2026). The other orders show one flat grid of outcome cards.
export const DEFAULT_SORT = "date";
export const SORTS = [
  ["date", "By date"],
  ["mark", "Lowest cost over mark"],
  ["near", "Closest to today's price"],
  ["soon", "Soonest settlement"],
  ["size", "Largest size"],
];
export const RANGES = [["all", "All dates"], ["2", "Next 2 days"], ["7", "Next 7 days"], ["30", "Next 30 days"]];
export const SIDES = [["all", "Both"], ["yes", "Higher"], ["no", "Lower"]];

const ok = (v) => v != null && Number.isFinite(v);

/** A budget a user typed: a positive amount up to $1,000,000, else the default. */
export function cleanBudget(v) {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : v;
  return ok(n) && n > 0 && n <= 1e6 ? Math.round(n * 100) / 100 : DEFAULT_BUDGET;
}

/** Derive's mark for one side, per $1 of payout. */
export const markOf = (level, side) => (ok(level?.fair) ? (side === "yes" ? level.fair : 1 - level.fair) : null);

const hhmm = (ts) => `${new Date(ts * 1000).toISOString().slice(11, 16)} UTC`;

/**
 * Derive's mark for one side as a benchmark, per $1 of payout, with its time: the journal's mark
 * benchmark (the board's published mark, timed by the read it came from). It is usable only when it
 * is there, is not older than the prices' slot, and that slot is fresh by the price staleness rules
 * (35 minutes); otherwise `per` is null and `reason` says why, in plain words.
 */
export function markFor(level, side, board, now = Date.now() / 1000) {
  const pricesTs = ok(board?.prices_ts) ? board.prices_ts : null;
  // A mark timed on its own (level.fair_ts or board.mark_ts) is used when published; today the mark
  // comes from the same read as the prices, so it carries the prices' slot.
  const markTs = ok(level?.fair_ts) ? level.fair_ts : ok(board?.mark_ts) ? board.mark_ts : pricesTs;
  const b = markBenchmark({ level, side, contracts: 1, pricesTs: markTs });
  if (!b) return { per: null, ts: markTs, reason: "Derive's mark for this answer is missing from the latest read." };
  if (markTs == null) return { per: null, ts: null, reason: "Derive's mark has no time, so it is not compared." };
  if (pricesTs != null && markTs < pricesTs) return { per: null, ts: markTs, reason: `Derive's mark is from ${hhmm(markTs)}, older than the prices of ${hhmm(pricesTs)}, so it is not compared.` };
  if (priceAge(markTs, now).state !== "fresh") return { per: null, ts: markTs, reason: `Derive's mark is from ${hhmm(markTs)}, more than 35 minutes ago, so it is not compared.` };
  return { per: b.per, ts: markTs, reason: null };
}

/**
 * Cost over mark per $1 of maximum payout: what you pay per $1 before fees minus Derive's mark per
 * $1, both on the same answer. Fees are a separate figure (they depend on the amount, not the price).
 */
export const costOverMark = (t, markPer) => (ok(markPer) && t?.payout > 0 ? t.premium / t.payout - markPer : null);

/** Exit cost now per $1: Derive's mark minus the published sell-back price, before exit fees. */
export const exitCost = (level, side, markPer) => {
  const sell = level?.[side]?.sell;
  return ok(markPer) && ok(sell) ? markPer - sell : null;
};

/**
 * Every answer on the board for `budget` dollars, from the published coin files (`boards`, a list
 * of questions/{UND}.json). Returns the rows that can be bought now and, separately, the answers on
 * the board's main ladder that have no price now, each with its reason.
 * A row: what the budget buys (total cost with Derive's fees, most it pays, most you can make), the
 * zone where it pays in part, the size at this price, its settlement, the cost over Derive's mark
 * per $1 of payout (before fees; null with the reason when the mark is missing or stale), the fees
 * apart, and the exit cost now (mark minus the sell-back price per $1).
 */
export function boardRows(boards, budget, { now = Date.now() / 1000, paused = false } = {}) {
  const rows = [];
  const noPrice = [];
  for (const board of boards || []) {
    if (!board?.dates) continue;
    const off = paused || priceAge(board.prices_ts, now, board.paused).state === "paused";
    for (const date of board.dates) {
      if (!date.board) continue;
      for (const level of date.levels || []) {
        if (!level.ladder || level.state === "retired" || level.state === "tail") continue;
        for (const side of ["yes", "no"]) {
          const base = { key: `${level.id}:${side}`, und: board.und, id: level.id, side, level, k: level.k, lo: level.lo, hi: level.hi,
            expiry: date.expiry, label: date.label, settleTs: date.settle_ts, thin: !!board.thin, index: board.index };
          if (!live(level, side, off, now)) {
            if (level.ladder === 7) noPrice.push({ ...base, reason: noPriceReason(level, side, off) });
            continue;
          }
          const t = budgetTicket(level, side, budget, board);
          if (!t) continue;
          if (t.belowMin || !(t.payout > 0)) {
            noPrice.push({ ...base, reason: `Your budget is below the smallest amount here, about ${money(t.minTotal, { cents: true })} with Derive's fees.` });
            continue;
          }
          const mark = markFor(level, side, board, now);
          rows.push({
            ...base, t,
            total: t.mostLose, premium: t.premium, fees: t.fees, payout: t.payout, make: t.payout - t.mostLose,
            buyCents: centsUp(level[side].buy), size: ok(level[side].size) ? level[side].size : null, capped: t.capped,
            markPer: mark.per, markTs: mark.ts, markReason: mark.reason,
            overMark: costOverMark(t, mark.per), feesPer: t.fees / t.payout, exitCost: exitCost(level, side, mark.per),
            distance: ok(board.index) && board.index > 0 ? Math.abs(level.k - board.index) / board.index : null,
          });
        }
      }
    }
  }
  return { rows, noPrice };
}

/** Coin, date range (days from now) and answer filters. */
export function filterRows(rows, { coin = "all", range = "all", side = "all" } = {}, now = Date.now() / 1000) {
  const days = range === "all" ? Infinity : Number(range);
  return rows.filter((r) => (coin === "all" || r.und === coin)
    && (side === "all" || r.side === side)
    && (r.settleTs - now) / 86400 <= days);
}

const missingLast = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : 0);
const byNum = (a, b, dir = 1) => missingLast(a, b) || (a == null ? 0 : dir * (a - b));
const COMPARE = {
  date: (a, b) => byNum(a.settleTs, b.settleTs) || byNum(a.k, b.k),
  mark: (a, b) => byNum(a.overMark, b.overMark),
  near: (a, b) => byNum(a.distance, b.distance),
  soon: (a, b) => byNum(a.settleTs, b.settleTs),
  size: (a, b) => byNum(a.size, b.size, -1),
};
// Ties: sooner date, then the level closer to the price, then the id, so the order is stable.
const tie = (a, b) => byNum(a.settleTs, b.settleTs) || byNum(a.distance, b.distance) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The user's sort, on price facts only (a copy; the input is not changed). Rows with no figure for
 * the sort (cost over mark not available yet, no size) go last. */
export function sortRows(rows, sort = DEFAULT_SORT) {
  const cmp = COMPARE[sort] || COMPARE.mark;
  return [...rows].sort((a, b) => cmp(a, b) || tie(a, b));
}

/** The horizon of the three layers shown as context beside a row. */
export const contextHorizon = (settleTs, now = Date.now() / 1000) => ((settleTs - now) / 86400 <= 10 ? "7d" : "30d");

/** Coins on the same date: Bitcoin, then Ethereum, then the coin bar's order (`coins`), then by name. */
export function coinRank(coins = []) {
  const order = ["BTC", "ETH", ...coins.filter((u) => u !== "BTC" && u !== "ETH")];
  return (u) => {
    const i = order.indexOf(u);
    return i < 0 ? order.length : i;
  };
}

/**
 * The "By date" view: outcomes (anything with und, expiry, settleTs and k; `index` is the coin's
 * index) in one row per coin and settlement date. Rows run soonest first, then by coin (see
 * coinRank); levels inside a row run from low to high. `nowAt` is where the coin's index sits in
 * the row: the number of levels at or below it (0 = below every level), or null without an index.
 */
export function dateRows(items, coins = []) {
  const rank = coinRank(coins);
  const rows = new Map();
  for (const it of items || []) {
    const key = `${it.und}:${it.expiry}`;
    if (!rows.has(key)) rows.set(key, { key, und: it.und, expiry: it.expiry, settleTs: it.settleTs, index: ok(it.index) ? it.index : null, items: [] });
    rows.get(key).items.push(it);
  }
  const out = [...rows.values()];
  for (const r of out) {
    r.items.sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    r.nowAt = r.index == null ? null : r.items.filter((it) => it.k <= r.index).length;
  }
  return out.sort((a, b) => a.settleTs - b.settleTs || rank(a.und) - rank(b.und) || (a.und < b.und ? -1 : a.und > b.und ? 1 : 0));
}
