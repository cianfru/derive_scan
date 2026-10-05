// Real-money one tap: the published mainnet switch as this page last read it, and who it lets trade.
// `trading_mainnet` in questions/index.json (from the repository variable QUESTIONS_TRADING_MAINNET):
// "on" buys and sells, "sell_only" only sells back, "off" neither; a file without it, or any other
// value, reads "off". Nothing opens until the page has read the file and found it on.
import { isPilot } from "../pilot.js";

const STATES = ["on", "sell_only", "off"];
let current = null;
export const TRADING_LEASE_SEC = 900;

/** The mainnet switch in a published index; no index yet reads "loading" (allows nothing). */
export function mainnetSwitch(index, now = Date.now() / 1000) {
  if (!index) return "loading";
  const v = index.trading_mainnet;
  const issued = index.trading_issued_at, until = index.trading_valid_until;
  if (!Number.isFinite(issued) || !Number.isFinite(until) || issued > now || until <= now
    || until <= issued || until - issued > TRADING_LEASE_SEC) return "off";
  return STATES.includes(v) ? v : "off";
}

/** Keeps the switch this page last read (from the index the page reads, and a fresh read before each fill). */
export function setMainnetSwitch(index) {
  current = index && typeof index === "object" ? { ...index } : null;
  return current ? mainnetSwitch(current) : "off";
}
export const mainnetSwitchState = () => current ? mainnetSwitch(current) : "off";

/** May this wallet trade in this direction on mainnet now? A pilot wallet, and the switch allows it. */
export function mainnetOpen(wallet, direction, list) {
  if (!(list ? isPilot(wallet, list) : isPilot(wallet))) return false;
  const state = mainnetSwitchState();
  if (state === "on") return direction === "buy" || direction === "sell";
  return state === "sell_only" && direction === "sell";
}
