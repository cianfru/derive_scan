export const SIGNAL_HELP = {
  STRONG_LONG:
    "The engine's strongest long setup: the required trend, structure and entry checks passed on the daily close. Inspect the evidence for this market; a signal is not a forecast.",
  LIGHT_LONG:
    "A long setup with fewer confirmations than Strong long. The engine has passed its entry gates on the daily close. The category describes confirmations on that close.",
  ACCUMULATE:
    "A base-building setup in accumulation or re-accumulation. The engine checks structure, heat and confidence, with separate paths for fearful sentiment or absorption. Open the condition evidence to see which path fired.",
  REVIVAL_SEED:
    "An early recovery setup inside Capitulation: z-score below −1, high volatility, sufficient regime confidence, Fear & Greed at 40 or below, and no risk-off market consensus. The floor is not yet confirmed.",
  REVIVAL_SEED_CONFIRMED:
    "The Revival seed conditions passed and the exhaustion engine also confirmed its floor condition. This describes the current setup; it does not guarantee a bottom.",
  WAIT: "No eligible entry or exit setup passed the engine's checks on this close. Wait does not mean missing data; missing readings are labelled separately.",
  TRIM: "The engine detected conditions for reducing long exposure, such as extension or weakening structure. Inspect its condition evidence for the actual trigger.",
  TRIM_HARD:
    "A stronger reduction signal from the engine's risk rules. This is a signal category, separate from the market's regime.",
  RISK_OFF:
    "The engine's defensive risk gates are active. New long entries are blocked by the current evidence.",
  NO_LONG:
    "The current engine checks do not permit a long entry. This is not automatically a short setup.",
  LIGHT_SHORT:
    "A short setup passed the engine's relevant structure and risk checks on this close. The evidence panel explains the trigger.",
};
export const REGIME_HELP = {
  MARKUP:
    "An advancing price regime relative to the engine's trend baseline. It describes market structure, separately from whether a new entry passes the signal checks.",
  REACC:
    "Re-accumulation: a pullback or consolidation within the engine's constructive regime family. It is not itself an instruction to buy.",
  BLOWOFF:
    "An extended, high-volatility price regime. Read it alongside heat and exhaustion to understand the current extension.",
  MARKDOWN:
    "A declining price regime. The regime describes structure; the signal applies the entry and risk rules.",
  CAP: "Capitulation: downside extension with elevated volatility. A Revival signal still needs additional confirmation and sentiment checks.",
  ACCUM:
    "Accumulation: a low-volatility base-building price regime. An Accumulate signal requires additional checks; these two labels are not interchangeable.",
  FLAT: "No directional regime is established. A short or incomplete history can also prevent a reliable regime; check data quality before interpreting this label.",
};
export const READING_HELP = {
  engine:
    "The daily engine has two outputs: a signal (such as Long, Wait or Revival) and a regime (such as Markup or Capitulation). Both use the last completed UTC day. Changing the options window never changes this engine.",
  options:
    "Options tone averages 25-delta call-minus-put implied volatility and covered taker premium balance. Positive: calls priced richer and/or calls bought plus puts sold. Negative: puts priced richer and/or puts bought plus calls sold. Values at or above +0.25 are Upward tone; at or below −0.25 are Defensive tone. Both components must be available. This is not a forecast or a measure of trader intent.",
  wallets:
    "Smart is the existing cohort of the best 50 profitable directional options wallets, ranked by gross results on expired options. The selected days describe time until expiry, not performance history or a 30-day ranking. Long/short delta uses net divided by gross option delta, with ±25% thresholds. Current history, fresh quoted deltas, at least three wallet-instrument positions and $10K gross delta are required. Hedges and perps are not included in this options-only reading.",
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
