// Real-money one tap: the published mainnet switch as this page last read it, and who it lets trade.
// `trading_mainnet` in questions/index.json (from the repository variable QUESTIONS_TRADING_MAINNET):
// "on" buys and sells, "sell_only" only sells back, "off" neither; a file without it, or any other
// value, reads "off". Nothing opens until the page has read the file and found it on.
import { isPilot } from "../pilot.js";

const STATES = ["on", "sell_only", "off"];
let current = "off";

/** The mainnet switch in a published index; no index yet reads "loading" (allows nothing). */
export function mainnetSwitch(index) {
  if (!index) return "loading";
  const v = index.trading_mainnet;
  return STATES.includes(v) ? v : "off";
}

/** Keeps the switch this page last read (from the index the page reads, and a fresh read before each fill). */
export function setMainnetSwitch(state) { current = STATES.includes(state) ? state : "off"; return current; }
export const mainnetSwitchState = () => current;

/** May this wallet trade in this direction on mainnet now? A pilot wallet, and the switch allows it. */
export function mainnetOpen(wallet, direction, list) {
  if (!(list ? isPilot(wallet, list) : isPilot(wallet))) return false;
  if (current === "on") return direction === "buy" || direction === "sell";
  return current === "sell_only" && direction === "sell";
}
