/** Questions stay off unless the build sets VITE_QUESTIONS=1: no route, no nav entry, no link. */
export const QUESTIONS_ON = import.meta.env.VITE_QUESTIONS === "1";

/** Saloon stage 2 (one-tap answers through Derive RFQ). Off unless the build sets VITE_SALOON_TRADE,
 * and only inside a build with the Saloon on. "1" and "dryrun" give the dry run on Derive's V3 testnet
 * (the execution is signed and checked by public/execute_quote_debug; nothing fills). "testnet" gives
 * real fills on Derive's V3 testnet with test USDC (owner's P6 approval, 4 October 2026). "mainnet"
 * gives real-money fills on Derive's V3 mainnet (P8, built 5 October 2026), closed until the owner
 * opens it: the published `trading_mainnet` switch (unset means off) and the pilot wallet list
 * (VITE_SALOON_PILOT, empty means nobody). Any other value leaves it off. Written as plain comparisons
 * so a build with it off drops the trading code entirely. */
export const TRADE_ON = QUESTIONS_ON && (import.meta.env.VITE_SALOON_TRADE === "1"
  || import.meta.env.VITE_SALOON_TRADE === "dryrun" || import.meta.env.VITE_SALOON_TRADE === "testnet"
  || import.meta.env.VITE_SALOON_TRADE === "mainnet");

/** Testnet fills: the header and every trade screen carry a "Testnet" badge, and Positions reads the
 * Saloon account on Derive's testnet. */
export const TESTNET_FILLS = QUESTIONS_ON && import.meta.env.VITE_SALOON_TRADE === "testnet";

/** Real-money fills on Derive's V3 mainnet: every trade screen says "Real money"; one tap only for
 * pilot wallets while the published mainnet switch is on. */
export const MAINNET_FILLS = QUESTIONS_ON && import.meta.env.VITE_SALOON_TRADE === "mainnet";

/** A build where one-tap trades fill (testnet or mainnet): Positions reads the Derive account and
 * one-tap wording shows. Written out in full so the minifier folds it in every build. */
export const ONE_TAP_FILLS = QUESTIONS_ON && (import.meta.env.VITE_SALOON_TRADE === "testnet"
  || import.meta.env.VITE_SALOON_TRADE === "mainnet");

/** Optional EVM funding routes. Off builds discard their provider and execution code. */
export const FUND_ANYCHAIN = TRADE_ON && import.meta.env.VITE_FUND_ANYCHAIN === "1";

/** Fixed Rysk illustrations only; never prices, wallet calls or execution. */
export const RYSK_MOCK = QUESTIONS_ON && import.meta.env.VITE_RYSK_MOCK === "1";

/** The same rule as a function, for tests and labels: "testnet", "mainnet", "dryrun" or "off". */
export function tradeMode(raw, questionsOn = QUESTIONS_ON) {
  const v = String(raw ?? "");
  if (!questionsOn) return "off";
  if (v === "testnet") return "testnet";
  if (v === "mainnet") return "mainnet";
  return v === "1" || v === "dryrun" ? "dryrun" : "off";
}
