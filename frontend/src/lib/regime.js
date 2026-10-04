// Plain-language reading of the daily engine, written from the vendored engine code
// (regime, heat and ribbon engines and the signal synthesizer under backend/reflex).
// Describes what is at the last close, never what comes next. Built only from published
// fields: the synthesizer's own desc and reason strings are never shown.
import { DASH, REGIME, REGIME_TERM, SIGNAL_LABEL, SIGNAL_TERM, CONSENSUS, CONSENSUS_TERM, engineTerm, title } from "./format.js";

export const REGIME_COLORS = { MARKUP: "var(--up)", REACC: "var(--regime-reacc)", ACCUM: "var(--regime-accum)", MARKDOWN: "var(--down)",
  CAP: "var(--regime-cap)", BLOWOFF: "var(--regime-blowoff)", FLAT: "var(--faint)" };

/** Visible under the regime name: a few words. */
export const REGIME_SHORT = {
  MARKUP: "Above its trend",
  REACC: "Pulled back from its trend",
  ACCUM: "Quiet, close to its trend",
  MARKDOWN: "Below its trend, falling, volatile",
  BLOWOFF: "Far above its trend",
  CAP: "Far below its trend",
  FLAT: "Not enough history",
};

/** One line per regime, for the (i). Plain words first; the numbers stay for those who want them. */
export const REGIME_LINE = {
  MARKUP: "Price is above its long-term trend line by more than usual.",
  REACC: "Price has pulled back below its usual distance from its long-term trend line.",
  ACCUM: "Price sits near its usual distance from its long-term trend line (z-score about −0.5 to +0.5), usually in quiet trading.",
  MARKDOWN: "Price is below its usual distance from its long-term trend line, lower than 30 bars ago, with large swings.",
  BLOWOFF: "Price is far above its long-term trend line; this reading starts at a z-score of 2.5, scaled for volatility.",
  CAP: "Price is far below its long-term trend line after heavy selling; this reading starts at a z-score of −1, scaled for volatility.",
  FLAT: "Fewer than 200 bars of price history, so no regime is named yet.",
};

/** "… Engine term: Re-accumulation." for a regime's (i). */
export const regimeTerm = (k) => engineTerm(REGIME_TERM, REGIME, k);
/** "… Engine term: Strong long." for a signal's (i). */
export const signalTerm = (k) => engineTerm(SIGNAL_TERM, SIGNAL_LABEL, k);
/** "… Engine term: Risk-on." for the market consensus (i). */
export const consensusTerm = (k) => engineTerm(CONSENSUS_TERM, CONSENSUS, k);

export const REGIME_INFO =
  "The regime places price against its own long-term trend line. The engine scores six regimes from the z-score, " +
  "volatility and the 30-bar price change, and changes the label only after a new leader has led for several bars (usually 5).";

/** One line per signal, for the (i). Cowboy's inputs: no taker-flow or wallet inputs enter this engine. */
export const SIGNAL_LINE = {
  STRONG_LONG: "The engine's strongest up-setup: at least 8 of 9 checks pass (weighted), the coin is Building a base, Washed out, or Trending up with a z-score between 0 and 1, and none of its limits is hit (heat, crowded funding, BTC trending down, 3+ regime changes in 7 days, missing data).",
  LIGHT_LONG: "An up-setup with fewer checks: Trending up with at least 4 of 9 checks and a z-score up to 2 (scaled for volatility), or a Strong up-setup held back by one of its limits.",
  ACCUMULATE: "A base is forming. Cooling off: z-score below 0.5, heat below 80, at least 4 of 9 checks, and most coins trending up or a mixed market. Building a base: z-score below 0, low volatility, heat below 70, Fear & Greed 40 or below.",
  REVIVAL_SEED: "Washed out with a z-score below −1, large swings and Fear & Greed at 40 or below, while most coins are not trending down.",
  REVIVAL_SEED_CONFIRMED: "Turning, plus a floor that held: three or more bars absorbed selling within 10 bars, the latest on lower volume than the first.",
  WAIT: "No entry or exit rule passed at this close, or an entry was held back (price below its weekly band, a climax bar, missing data).",
  TRIM: "Price is stretched: heat at 95 or more (very far from its weekly band, either side), or Overheated with a z-score above 3, scaled for volatility.",
  TRIM_HARD: "Price is very stretched: Overheated with a z-score above 3.5, scaled for volatility.",
  RISK_OFF: "Trending down while more than 55% of Derive perps are trending down, with price above its weekly band.",
  NO_LONG: "Up-setups are ruled out: Trending up or Cooling off while BTC is trending down and the regime reading is weak, or most perps overheated with a stretched z-score.",
  LIGHT_SHORT: "A down-setup: price below its weekly band, z-score 0.3 to 1.2, heat 20 or more and no higher than the previous close, funding not crowded short.",
};

export const Z_INFO =
  "How far price sits from its long-term trend line compared with the last 200 bars, in standard deviations. " +
  "The trend line is a straight-line fit through the last 300 daily closes. 0 is the usual distance; +1 is one standard deviation above it. " +
  "Shaded: the entry check's range, −0.5 to +2.5. Thin line: its range over the last 90 days.";
export const HEAT_INFO =
  "Distance between the daily close and the weekly band, counted in average weekly ranges: 12.5 points per range, 100 at most. " +
  "It reads the same above or below the band. A Strong up-setup needs heat below 85, Base forming below 70 (80 when Cooling off); at 95 or more the exit rule applies. " +
  "Thin line: its range over the last 90 days.";
export const BAND_INFO =
  "The weekly band is the average of the 21-week exponential and 20-week simple averages of weekly closes. " +
  "Up-setups need the daily close above it; below it the engine checks only down-setups.";
export const RIBBON_INFO =
  "Four moving averages of the daily close: 32, 35, 50 and 58 days. Gold: stacked upward, shortest on top. Blue: stacked downward. " +
  "Grey: mixed. On the chart, the 32- and 58-day lines take each day's colour. Shown for reference; the signal does not use it.";
export const CHECKS_INFO =
  "The engine's nine entry checks at the last daily close. A missing input counts as not passed. " +
  "The signal also follows regime rules and limits, so the count alone does not set it.";

/** Heat phase in plain words, for the heat (i). */
export const HEAT_PHASE = {
  Neutral: "Phase: neutral (heat 20 or less).",
  Extension: "Phase: extension (heat above 20).",
  Fading: "Phase: fading (heat falling from above 40). When Trending up this removes one check point.",
  Entry: "Phase: entry (heat just crossed above 80 above the band).",
  Exhaustion: "Phase: exhaustion (heat peaked above 80 and turned down). When Trending up this removes one check point.",
};

/** Ribbon trail characters published per daily candle (g gold, b blue, n grey, - warm-up). */
export const RIBBON_STATE = { g: "gold", b: "blue", n: "grey" };

const num = (v) => typeof v === "number" && Number.isFinite(v);
export const fmtZ = (v) => (num(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}` : DASH);
const fmtPct = (v, d = 1) => (num(v) ? `${Math.abs(v).toFixed(d)}%` : DASH);
const warming = (row) => !!row?.data_status && row.data_status !== "ready";

/** The nine checks, in the engine's order, with the app's names, the measured value and the rule. */
export function checks(row, ctx, tf = "1d") {
  const detail = Object.fromEntries((row?.conditions_detail || []).map((c) => [c.name, c]));
  const cons = ctx?.consensus?.[tf];
  const btc = ctx?.btc_regime?.[tf];
  const fund = row?.positioning?.funding_rate;
  const early = warming(row);
  // Only the digits of the limit are read from the check; its text is never shown.
  const heatLimit = (detail.heat_ok?.desc || "< 85").replace(/[^0-9]/g, "") || "85";
  const climax = detail.no_climax?.status === "unknown" ? (row?.volume_status === "thin" ? "Thin volume" : DASH) : row?.is_climax ? "Climax bar" : "None";
  const defs = [
    ["bullish_regime", "Regime", early ? DASH : REGIME[row?.regime] || title(row?.regime), "Passes when Trending up or Building a base."],
    ["consensus", "Market", cons?.status === "ready" || (cons && !cons.status) ? CONSENSUS[cons.consensus] || DASH : DASH,
      "Passes when more than 55% of Derive perps with a current reading are trending up, or are building a base, cooling off or washed out (most coins basing)."],
    ["z_range", "Z-score", early ? DASH : fmtZ(row?.zscore), "Passes from −0.5 to +2.5."],
    ["no_bear_div", "BTC", row?.underlying === "BTC" ? DASH : REGIME[btc] || DASH, "Fails when this coin is Trending up or Cooling off while BTC is Trending down."],
    ["heat_ok", "Heat", num(row?.heat) ? String(row.heat) : DASH, `Passes below ${heatLimit} (85 in most regimes, 75 when Overheated, 100 when Washed out or Building a base).`],
    ["no_climax", "Climax", climax,
      "Fails on a climax bar: a close below the weekly band on a bar wider than 1.5 average ranges, with a long lower wick, after a burst of selling. Unavailable when fewer than 90 of the last 100 bars traded on the Derive perp."],
    ["funding_ok", "Funding", num(fund) ? `${fund >= 0 ? "+" : "−"}${Math.abs(fund * 24 * 365 * 100).toFixed(1)}%` : DASH,
      "Passes unless the Derive perp's funding is above 0.01% an hour (about 88% a year)."],
    ["not_greedy", "Fear & Greed", num(ctx?.fear_greed) ? String(ctx.fear_greed) : DASH, "Passes below 70."],
    ["liquidity_ok", "Stablecoins", num(ctx?.stablecoin_7d_pct) ? `${ctx.stablecoin_7d_pct >= 0 ? "+" : "−"}${fmtPct(ctx.stablecoin_7d_pct, 2)} 7d` : DASH,
      "Passes unless USDT and USDC supply fell more than 1% in 7 days."],
  ];
  return defs.map(([name, label, value, rule]) => {
    const c = detail[name];
    const status = c ? (["pass", "fail", "unknown"].includes(c.status) ? c.status : c.available === false ? "unknown" : c.met ? "pass" : "fail") : "unknown";
    return { name, label, value, rule, status };
  });
}

/** The gate outside the nine checks: up-setups need price above the weekly band. */
export function bandGate(row) {
  if (!row) return null;
  if (!row.bmsb_mid) return { status: "unknown", value: "No band yet" };
  const above = row.heat_direction >= 0;
  return { status: above ? "pass" : "fail", value: `${fmtPct(row.deviation_pct)} ${above ? "above" : "below"}` };
}

/** Plain words for each check that does not pass, and for the band gate. */
const HISTORY_CHECKS = ["bullish_regime", "z_range", "no_bear_div", "heat_ok", "no_climax"];
export function against(row, list, gate) {
  const out = [];
  let rest = list || [];
  if (warming(row)) {
    // One line for every check that waits on price history (the engine marks them unknown together).
    out.push(`Price history ${row.history_bars ?? DASH} of 499 bars: regime, z-score, BTC, heat and climax checks wait for it`);
    rest = rest.filter((c) => !(HISTORY_CHECKS.includes(c.name) && c.status === "unknown"));
  }
  if (gate?.status === "fail") out.push(`Price ${gate.value} its weekly band: up-setups are off`);
  if (gate?.status === "unknown") out.push("No weekly band yet: up-setups are off");
  for (const c of rest) {
    if (c.status === "pass") continue;
    if (c.status === "unknown") { out.push(c.name === "no_climax" ? "Climax check unavailable: Derive perp volume too thin" : `${c.label}: data unavailable`); continue; }
    out.push({
      bullish_regime: `Regime is ${c.value}: the check needs Trending up or Building a base`,
      consensus: `Market: ${c.value}. The check needs most coins trending up or basing`,
      z_range: `Z-score ${c.value}: outside −0.5 to +2.5`,
      no_bear_div: "BTC is trending down while this coin is not",
      heat_ok: `Heat ${c.value}: at or above the limit`,
      no_climax: "Climax bar at this close",
      funding_ok: "Funding crowded long",
      not_greedy: `Fear & Greed ${c.value}: 70 or above`,
      liquidity_ok: `Stablecoin supply ${c.value}`,
    }[c.name] || `${c.label}: not passed`);
  }
  return out;
}

/** Why this signal, in one line, from published fields only. Falls back to the signal's meaning. */
export function whyLine(row, list) {
  if (!row) return "";
  const s = row.signal, z = row.zscore, dev = fmtPct(row.deviation_pct), side = row.heat_direction >= 0 ? "above" : "below";
  if (warming(row)) return `Price history ${row.history_bars ?? DASH} of 499 bars: no signal yet.`;
  if (row.signal_status === "unavailable") return "Engine reading unavailable at this close.";
  if (s === "TRIM" && row.heat >= (row.regime === "BLOWOFF" ? 85 : 95)) return `Heat ${row.heat}: ${dev} ${side} the weekly band, past the exit level.`;
  if (!row.bmsb_mid && s === "WAIT") return "No weekly band yet: up-setups are off.";
  if (row.heat_direction < 0 && s === "WAIT") return `${dev} below its weekly band: up-setups are off.`;
  if (s === "LIGHT_SHORT") return `${dev} below its weekly band with a stalling rally: a down-setup.`;
  if (row.is_climax && s === "WAIT") return "Climax bar below the weekly band: entries held.";
  const unknown = (list || []).filter((c) => c.status === "unknown");
  if (unknown.length && row.entry_blocked && s === "WAIT")
    return unknown.length === 1 && unknown[0].name === "no_climax"
      ? "Derive perp volume too thin for the climax check: entries held."
      : `${unknown.map((c) => c.label).join(", ")} unavailable: entries held.`;
  if (s === "LIGHT_LONG" && row.regime === "MARKUP" && num(z) && !(z > 0 && z < 1)) return `Leaning up, not a Strong up-setup: z-score ${fmtZ(z)} is outside 0 to 1.`;
  if (s === "ACCUMULATE" && row.regime === "REACC") return `Base forming in a pullback: ${row.conditions_met} of 9 checks, heat ${row.heat}.`;
  if (s === "WAIT" && row.regime === "MARKDOWN") return "Trending down: no up-setups.";
  if (s === "WAIT" && num(row.conditions_met) && row.conditions_met < 4) return `${row.conditions_met} of 9 checks: too few for an entry.`;
  return SIGNAL_LINE[s] || "";
}

/** The run of the current value at the end of a series: [value, length, first index].
 * Missing days (null) neither break nor extend a run: they are drawn empty. */
export function lastRun(values) {
  const list = values || [];
  let i = list.length - 1;
  while (i >= 0 && list[i] == null) i--;
  if (i < 0) return [null, 0, -1];
  const v = list[i];
  let start = i, n = 1;
  for (let j = i - 1; j >= 0; j--) {
    if (list[j] == null) continue;
    if (list[j] !== v) break;
    start = j; n++;
  }
  return [v, n, start];
}

export const signalName = (s) => SIGNAL_LABEL[s] || s;
