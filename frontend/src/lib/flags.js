/** Questions stay off unless the build sets VITE_QUESTIONS=1: no route, no nav entry, no link. */
export const QUESTIONS_ON = import.meta.env.VITE_QUESTIONS === "1";

/** Saloon stage 2 (one-tap answers through Derive RFQ). Off unless the build sets VITE_SALOON_TRADE,
 * and only inside a build with the Saloon on. Stage 2 is built up to the dry run: "1", "dryrun" and
 * "testnet" all give the dry run on Derive's V3 testnet (nothing fills). Any other value, including
 * "mainnet", leaves it off. Written as plain comparisons so a build with it off drops the trading
 * code entirely. */
export const TRADE_ON = QUESTIONS_ON && (import.meta.env.VITE_SALOON_TRADE === "1"
  || import.meta.env.VITE_SALOON_TRADE === "dryrun" || import.meta.env.VITE_SALOON_TRADE === "testnet");

/** The same rule as a function, for tests and labels. */
export function tradeMode(raw, questionsOn = QUESTIONS_ON) {
  return questionsOn && ["1", "dryrun", "testnet"].includes(String(raw ?? "")) ? "dryrun" : "off";
}
