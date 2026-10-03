// Shared labels for options traders.
export const TYPE = { top: "Top", smart: "Smart", profitable: "Profitable", directional: "Directional", income: "Income",
  hedger: "Hedger", occasional: "Occasional" };
export const typeOf = (t) => t?.tier || t?.class;
export const TYPE_INFO = "From every trade on Derive since December 2023. Directional traders in profit on options that have expired are ranked: Top (best fifth), Smart (the best 50, or every Top wallet when Top is larger), Profitable (the rest in profit). Directional: taking a view, not in profit. Income: mostly sells out-of-the-money options. Hedger: offsets its options with perps. Occasional: too few trades to tell. Market makers are left out.";
