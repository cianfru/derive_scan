import { REGIME_LINE, SIGNAL_LINE, regimeTerm, signalTerm } from "./regime.js";

// One copy for every screen (coin header, Markets, Radar, engine pair): written in lib/regime.js.
export const SIGNAL_HELP = Object.fromEntries(
  Object.entries(SIGNAL_LINE).map(([k, v]) => [k, `${v} Signals describe the engine's rules at this close.${signalTerm(k)}`]),
);
export const REGIME_HELP = Object.fromEntries(Object.entries(REGIME_LINE).map(([k, v]) => [k, `${v}${regimeTerm(k)}`]));
export const READING_HELP = {
  engine:
    "The daily engine has two outputs: a signal (such as Leaning up, No clear setup or Turning) and a regime (such as Trending up or Washed out). Both use the last completed UTC day. Changing the options window never changes this engine.",
  options:
    "Options tone averages 25-delta call-minus-put implied volatility and covered taker premium balance. Positive: calls priced richer and/or calls bought plus puts sold. Negative: puts priced richer and/or puts bought plus calls sold. Values at or above +0.25 are Upward tone; at or below −0.25 are Defensive tone. Both components must be available. It describes option prices and taker trades, not our view or a measure of trader intent.",
  wallets:
    "Smart is the cohort of profitable directional options wallets ranked by gross results on expired options: the best 50, or every Top wallet (the best fifth) when Top is larger. The selected days describe time until expiry, not performance history or a 30-day ranking. Long/short delta uses net divided by gross option delta, with ±25% thresholds. Current history, fresh quoted deltas, at least three wallet-instrument positions and $10K gross delta are required. Hedges and perps are not included in this options-only reading.",
};
export const COHORT_HELP =
  "Net dollar delta measures approximate option-book sensitivity to a small price move. Positive (long delta) gains from a rise; negative (short delta) gains from a fall, before volatility and time effects. Gross delta sums absolute exposure before wallets offset each other. Direction is the net/gross ratio with ±25% thresholds. These are reconstructed options positions, not traders' stated beliefs or full portfolios.";
export function openMarketRow(event, navigate, und) {
  if (event.target.closest("a,button,input,select,summary")) return;
  if (event.type === "keydown") {
    if (
      !["Enter", " "].includes(event.key) ||
      event.target !== event.currentTarget
    )
      return;
    event.preventDefault();
  }
  navigate(`/coin/${und}`);
}
