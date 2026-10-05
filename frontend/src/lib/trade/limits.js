// Saloon stage 2, P6: the kill switch and the caps, checked in the browser before any RFQ and again
// before any fill. Both are guards against mistakes, not controls: the real limit is what the user
// deposits in the Saloon account.
import { TRADE_LIMITS, capCheck } from "./package.js";
import { KEYS, read, write } from "./store.js";

/** The kill switch, from `trading` in the published questions/index.json (set from the Action's
 * QUESTIONS_TRADING). "on" buys and sells; "sell_only" only sells back; "off" neither. A file without
 * the field reads "on" (the testnet default); an unknown value reads "off"; no file yet reads
 * "loading", which allows nothing. */
export const TRADING = ["on", "sell_only", "off"];
export function tradingState(index) {
  if (!index) return "loading";
  const v = index.trading;
  if (v == null || v === "") return "on";
  return TRADING.includes(v) ? v : "off";
}
export function tradingAllows(state, direction) {
  if (state === "on") return true;
  return state === "sell_only" && direction === "sell";
}
export const TRADING_NOTICE = {
  sell_only: "Cowboy has paused new buys. Selling back still works.",
  off: "Cowboy has paused one-tap trading. Your positions on Derive are unaffected, and they settle as usual.",
  loading: "Checking whether one-tap trading is open.",
};

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** What this wallet has bought today (UTC) in this browser, most-you-can-lose terms. */
export function spentToday(wallet, now = Date.now()) {
  const v = wallet ? read(KEYS.day(wallet)) : null;
  return v && v.day === dayOf(now) && Number.isFinite(v.spent) ? v.spent : 0;
}
export function addSpent(wallet, amount, now = Date.now()) {
  if (!wallet || !Number.isFinite(amount) || amount <= 0) return spentToday(wallet, now);
  const spent = spentToday(wallet, now) + amount;
  write(KEYS.day(wallet), { day: dayOf(now), spent: Math.round(spent * 100) / 100 });
  return spent;
}

/** The caps for one buy: $250 most-you-can-lose per answer, $1,000 a day per wallet. */
export function capGate(mostLose, wallet, now = Date.now()) {
  if (!Number.isFinite(mostLose)) return { ok: true };
  return capCheck(mostLose, { boughtToday: spentToday(wallet, now), testnet: true });
}

const usd = (x) => `$${Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export function capMessage(c) {
  if (!c?.warn) return null;
  if (c.warn === "per_answer") return `Large trade: you can lose up to $${Number(c.mostLose).toFixed(2)} on this answer. Check the amount before you tap.`;
  if (c.warn === "per_day") return `With this trade you have put $${Number(c.today).toFixed(2)} into answers today (UTC), over ${usd(TRADE_LIMITS.perDay)}.`;
  return null;
}
