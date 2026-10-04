// The outcome board: every live answer across coins and dates, priced for one budget.
// Rows are built, filtered and ordered from facts about the price only (what it costs over Derive's
// mark, whether it can be bought, its size, its date and level). The three research layers are
// never an input here: they are drawn beside each row as context and cannot change the order.

import { centsUp, live, money, noPriceReason, ticket } from "./questions.js";

export const DEFAULT_BUDGET = 100;
export const SORTS = [
  ["near", "Closest to today's price"],
  ["mark", "Lowest cost over mark"],
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

/**
 * Every answer on the board for `budget` dollars, from the published coin files (`boards`, a list
 * of questions/{UND}.json). Returns the rows that can be bought now and, separately, the answers on
 * the board's main ladder that have no price now, each with its reason.
 * A row: what the budget buys (total cost with Derive's fees, most it pays, most you can make), the
 * zone where it pays in part, the size at this price, its settlement, and the cost over Derive's
 * mark per $1 of payout (fees included).
 */
export function boardRows(boards, budget, { now = Date.now() / 1000, paused = false } = {}) {
  const rows = [];
  const noPrice = [];
  for (const board of boards || []) {
    if (!board?.dates) continue;
    const off = paused || !!board.paused;
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
            noPrice.push({ ...base, reason: `Your budget is below the smallest amount here, about ${money(t.minCost, { cents: true })}.` });
            continue;
          }
          const mark = markOf(level, side);
          rows.push({
            ...base, t,
            total: t.mostLose, premium: t.premium, fees: t.fees, payout: t.payout, make: t.payout - t.mostLose,
            buyCents: centsUp(level[side].buy), size: ok(level[side].size) ? level[side].size : null, capped: t.capped,
            overMark: mark == null ? null : t.mostLose / t.payout - mark,
            distance: ok(board.index) && board.index > 0 ? Math.abs(level.k - board.index) / board.index : null,
          });
        }
      }
    }
  }
  return { rows, noPrice };
}

/**
 * The ticket whose total, Derive's fees included, fits the budget: fees are a fixed base per option
 * plus an amount per contract, so the premium is what remains after them. Contracts round down to
 * the amount step and stop at the size at this price, as in the guided flow.
 */
export function budgetTicket(level, side, budget, board) {
  const s = level?.[side];
  const spec = board?.spec || {};
  if (!s?.legs || !(budget > 0)) return null;
  const net = s.legs.reduce((a, [, act, p]) => a + (act === "buy" ? p : -p), 0);
  if (!(net > 0)) return null;
  const base = s.legs.length * (spec.base || 0);
  const perFee = s.legs.reduce((a, [, , p]) => a + Math.min((spec.taker || 0) * (board.index || 0), (spec.cap || 0) * p), 0);
  const premium = Math.max(0, budget - base) * net / (net + perFee);
  // A hair under, so floating point never rounds the contracts up past the budget.
  return ticket(level, side, premium * (1 - 1e-9), board);
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
  mark: (a, b) => byNum(a.overMark, b.overMark),
  near: (a, b) => byNum(a.distance, b.distance),
  soon: (a, b) => byNum(a.settleTs, b.settleTs),
  size: (a, b) => byNum(a.size, b.size, -1),
};
// Ties: sooner date, then the level closer to the price, then the id, so the order is stable.
const tie = (a, b) => byNum(a.settleTs, b.settleTs) || byNum(a.distance, b.distance) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The user's sort, on price facts only (a copy; the input is not changed). */
export function sortRows(rows, sort = "near") {
  const cmp = COMPARE[sort] || COMPARE.mark;
  return [...rows].sort((a, b) => cmp(a, b) || tie(a, b));
}

/** The horizon of the three layers shown as context beside a row. */
export const contextHorizon = (settleTs, now = Date.now() / 1000) => ((settleTs - now) / 86400 <= 10 ? "7d" : "30d");
