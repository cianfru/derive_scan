import { SIGNAL_LABEL } from "../lib/format.js";
import { coverageReady } from "./HistoryStatus.jsx";
import { Info } from "./ui.jsx";

import { QUALITY_LABEL } from "./AnalyticalDetails.jsx";
import { readingState } from "../lib/analytics.js";

const STATE = { up: ["Up", "var(--up)"], defensive: ["Defensive", "var(--down)"], neutral: ["Neutral", "var(--seam-hi)"] };
const ROWS = [["engine", "Engine"], ["options", "Option prices"], ["wallets", "Smart wallets"]];
const HORIZONS = [["7d", "Shorter view"], ["30d", "Broader view"]];

function Cell({ state, note }) {
  const [label, color] = STATE[state] || ["-", "var(--seam)"];
  return (
    <span className="al-cell" style={{ color: state ? color : "var(--faint)" }}>
      <i style={{ background: state ? color : "transparent", borderColor: color }} />
      <b>{state ? label : note || "Unavailable"}</b>
    </span>
  );
}

/** Compact: two groups (7 and 30 days) of three squares (engine, option prices, smart wallets). */
export function AlignSquares({ a }) {
  if (!a || a.version !== 2) return <span className="faint">-</span>;
  const states = Object.fromEntries(HORIZONS.map(([h]) => [h, ROWS.map(([key]) => readingState(a.readings?.[h]?.[key], key))]));
  const description = HORIZONS.map(([h, label]) => `${label}: ${ROWS.map(([key, name], i) => `${name}: ${key === "wallets" && !coverageReady(a.wallet_coverage) ? "history incomplete" : STATE[states[h]?.[i]]?.[0] || "insufficient data"}`).join(", ")}`).join(". ");
  return (
    <span className="al-sq" aria-label={description} title={description}>
      {["7d", "30d"].map((h) => (
        <span key={h}>{(states[h] || []).map((s, i) => <i key={i} style={{ background: STATE[i === 2 && !coverageReady(a.wallet_coverage) ? null : s]?.[1] || "transparent" }} />)}</span>))}
      <Info label="Explain alignment readings">{description}</Info>
    </span>
  );
}

export const ALIGN_INFO = "Three separate views, with different measurement windows. Shorter view: 4H engine, 7-day option tenor with 24-hour premium flow, wallet options expiring within 7 days. Broader view: 1D engine, 30-day tenor with 7-day flow, wallet options expiring within 30 days. Options tone averages current skew and covered taker premium; volatility and put/call OI stay separate. These views share market data and are not independent. Smart is the defined cohort ranked by historical gross options PnL. Alignment is context and never feeds the engine.";

/** The grid: rows engine / option prices / smart wallets, columns next 7 / next 30 days. */
export default function AlignmentGrid({ alignment }) {
  const hz = alignment?.horizons;
  if (!hz || alignment.version !== 2) return <p className="status">Updating analytical readings.</p>;
  const walletReady = coverageReady(alignment.wallet_coverage);
  return (
    <div className="al-grid" role="table" aria-label="Alignment by horizon">
      <div role="row" className="al-head">
        <span />
        {HORIZONS.map(([h, label]) => (
          <span key={h} role="columnheader" className={walletReady && hz[h]?.aligned && ROWS.every(([key]) => readingState(hz[h][key], key)) ? `al-on ${hz[h].aligned}` : ""}>
            {label}{walletReady && hz[h]?.aligned && ROWS.every(([key]) => readingState(hz[h][key], key)) && <em>{hz[h].aligned === "up" ? "Aligned up" : "Aligned defensive"}</em>}</span>))}
      </div>
      {ROWS.map(([k, label]) => (
        <div role="row" key={k}>
          <span role="rowheader" className="label">{label}</span>
          {HORIZONS.map(([h]) => {
            const c = hz[h]?.[k] || {};
            const state = readingState(c, k);
            const note = k === "wallets" && !walletReady ? "History incomplete" : QUALITY_LABEL[c.status === "ready" && !state ? "stale" : c.status] || "Unavailable";
            return (
              <span role="cell" key={h}>
                <Cell state={k === "wallets" && !walletReady ? null : state} note={note} />
                {k === "engine" && <small className="dim">{h === "7d" ? "4H" : "1D"} engine{state && c.signal ? ` · ${SIGNAL_LABEL[c.signal] || c.signal}` : ""}</small>}
                {k === "options" && <small className="dim">{h === "7d" ? "7d tenor · 24h flow" : "30d tenor · 7d flow"}</small>}
                {k === "wallets" && c.positions > 0 && <small className="dim">{c.positions} positions · expiry ≤ {h === "7d" ? "7d" : "30d"}<Info>Counts wallet-instrument positions, not distinct wallets. Missing or estimated deltas withhold the directional label. History and valuation have separate observation times.</Info></small>}
              </span>);
          })}
        </div>))}
      <p className="status">Wallet history: {alignment.positions_through ? `through ${alignment.positions_through} UTC close` : "accumulating"}. {!coverageReady(alignment.wallet_coverage) && "Wallet readings are withheld until history is current."} <Info label="About wallet reading availability">Collection continues automatically. Missing history is not a neutral position. Once history is current, a reading requires at least three positions and $10,000 gross delta exposure inside the selected expiry window.</Info></p>
    </div>
  );
}
