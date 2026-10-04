/** Questions stay off unless the build sets VITE_QUESTIONS=1: no route, no nav entry, no link. */
export const QUESTIONS_ON = import.meta.env.VITE_QUESTIONS === "1";

/** Saloon stage 2 (one-tap answers through Derive RFQ). Off unless the build sets VITE_SALOON_TRADE,
 * and only inside a build with the Saloon on. "1" and "dryrun" give the dry run on Derive's V3 testnet
 * (the execution is signed and checked by public/execute_quote_debug; nothing fills). "testnet" gives
 * real fills on Derive's V3 testnet with test USDC (owner's P6 approval, 4 October 2026). Any other
 * value, including "mainnet", leaves it off. Written as plain comparisons so a build with it off drops
 * the trading code entirely. */
export const TRADE_ON = QUESTIONS_ON && (import.meta.env.VITE_SALOON_TRADE === "1"
  || import.meta.env.VITE_SALOON_TRADE === "dryrun" || import.meta.env.VITE_SALOON_TRADE === "testnet");

/** Testnet fills: the header and every trade screen carry a "Testnet" badge, and Positions reads the
 * Saloon account on Derive's testnet. */
export const TESTNET_FILLS = QUESTIONS_ON && import.meta.env.VITE_SALOON_TRADE === "testnet";

/** The same rule as a function, for tests and labels: "testnet", "dryrun" or "off". */
export function tradeMode(raw, questionsOn = QUESTIONS_ON) {
  const v = String(raw ?? "");
  if (!questionsOn) return "off";
  if (v === "testnet") return "testnet";
  return v === "1" || v === "dryrun" ? "dryrun" : "off";
}
