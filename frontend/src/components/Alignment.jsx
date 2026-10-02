import { SIGNAL_LABEL } from "../lib/format.js";
import { coverageReady } from "./HistoryStatus.jsx";
import { Info } from "./ui.jsx";

const STATE = { up: ["Up", "var(--up)"], defensive: ["Defensive", "var(--down)"], neutral: ["Neutral", "var(--seam-hi)"] };
const ROWS = [["engine", "Engine"], ["options", "Option prices"], ["wallets", "Smart wallets"]];
const HORIZONS = [["7d", "Next 7 days"], ["30d", "Next 30 days"]];

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
  if (!a) return <span className="faint">-</span>;
  const description = HORIZONS.map(([h, label]) => `${label}: ${ROWS.map(([key, name], i) => `${name}: ${key === "wallets" && !coverageReady(a.wallet_coverage) ? "history incomplete" : STATE[a[h]?.[i]]?.[0] || "insufficient data"}`).join(", ")}`).join(". ");
  return (
    <span className="al-sq" aria-label={description} title={description}>
      {["7d", "30d"].map((h) => (
        <span key={h}>{(a[h] || []).map((s, i) => <i key={i} style={{ background: STATE[i === 2 && !coverageReady(a.wallet_coverage) ? null : s]?.[1] || "transparent" }} />)}</span>))}
      <Info label="Explain alignment readings">{description}</Info>
    </span>
  );
}

export const ALIGN_INFO = "For the next 7 and the next 30 days, three independent reads. Engine: the 4H signal for 7 days, the 1D signal for 30 days. Option prices: skew, which side takers paid premium for, short-dated stress and put/call changes. Smart wallets: what the best directional options traders on Derive hold on expiries inside the window, by delta (market makers, income sellers and hedgers left out). When all three point the same way the column is marked. Context side by side, not a combined signal.";

/** The grid: rows engine / option prices / smart wallets, columns next 7 / next 30 days. */
export default function AlignmentGrid({ alignment }) {
  const hz = alignment?.horizons;
  if (!hz) return null;
  const walletReady = coverageReady(alignment.wallet_coverage);
  return (
    <div className="al-grid" role="table" aria-label="Alignment by horizon">
      <div role="row" className="al-head">
        <span />
        {HORIZONS.map(([h, label]) => (
          <span key={h} role="columnheader" className={walletReady && hz[h]?.aligned ? `al-on ${hz[h].aligned}` : ""}>
            {label}{walletReady && hz[h]?.aligned && <em>{hz[h].aligned === "up" ? "Aligned up" : "Aligned defensive"}</em>}</span>))}
      </div>
      {ROWS.map(([k, label]) => (
        <div role="row" key={k}>
          <span role="rowheader" className="label">{label}</span>
          {HORIZONS.map(([h]) => {
            const c = hz[h]?.[k] || {};
            const note = k === "engine" ? (c.signal ? SIGNAL_LABEL[c.signal] : "No signal") : k === "wallets" ? (!walletReady ? "History incomplete" : c.gross_complete === false ? "Updating calculation" : "Insufficient exposure") : "Insufficient data";
            return (
              <span role="cell" key={h}>
                <Cell state={k === "wallets" && !walletReady ? null : c.state} note={note} />
                {k === "engine" && c.signal && <small className="dim">{SIGNAL_LABEL[c.signal] || c.signal}</small>}
                {k === "wallets" && c.positions > 0 && <small className="dim">{c.positions} positions</small>}
              </span>);
          })}
        </div>))}
      <p className="status">Wallet history: {alignment.positions_through ? `through ${alignment.positions_through} UTC close` : "accumulating"}. {!coverageReady(alignment.wallet_coverage) && "Wallet readings are withheld until history is current."} <Info label="About wallet reading availability">Collection continues automatically. Missing history is not a neutral position. Once history is current, a reading requires at least three positions and $10,000 gross delta exposure inside the selected expiry window.</Info></p>
    </div>
  );
}
