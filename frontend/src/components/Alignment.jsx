import { SIGNAL_LABEL } from "../lib/format.js";

const STATE = { up: ["Up", "var(--up)"], defensive: ["Defensive", "var(--down)"], neutral: ["Neutral", "var(--seam-hi)"] };
const ROWS = [["engine", "Engine"], ["options", "Option prices"], ["wallets", "Smart wallets"]];
const HORIZONS = [["7d", "Next 7 days"], ["30d", "Next 30 days"]];

function Cell({ state, note }) {
  const [label, color] = STATE[state] || ["-", "var(--seam)"];
  return (
    <span className="al-cell" style={{ color: state ? color : "var(--faint)" }}>
      <i style={{ background: state ? color : "transparent", borderColor: color }} />
      <b>{state ? label : note || "Quiet"}</b>
    </span>
  );
}

/** Compact: two groups (7 and 30 days) of three squares (engine, option prices, smart wallets). */
export function AlignSquares({ a }) {
  if (!a) return <span className="faint">-</span>;
  return (
    <span className="al-sq" aria-label="Alignment, next 7 and 30 days: engine, option prices, smart wallets">
      {["7d", "30d"].map((h) => (
        <span key={h}>{(a[h] || []).map((s, i) => <i key={i} style={{ background: STATE[s]?.[1] || "transparent" }} />)}</span>))}
    </span>
  );
}

export const ALIGN_INFO = "For the next 7 and the next 30 days, three independent reads. Engine: the 4H signal for 7 days, the 1D signal for 30 days. Option prices: skew, which side takers paid premium for, short-dated stress and put/call changes. Smart wallets: what the best directional options traders on Derive hold on expiries inside the window, by delta (market makers, income sellers and hedgers left out). When all three point the same way the column is marked. Context side by side, not a combined signal.";

/** The grid: rows engine / option prices / smart wallets, columns next 7 / next 30 days. */
export default function AlignmentGrid({ alignment }) {
  const hz = alignment?.horizons;
  if (!hz) return null;
  return (
    <div className="al-grid" role="table" aria-label="Alignment by horizon">
      <div role="row" className="al-head">
        <span />
        {HORIZONS.map(([h, label]) => (
          <span key={h} role="columnheader" className={hz[h]?.aligned ? `al-on ${hz[h].aligned}` : ""}>
            {label}{hz[h]?.aligned && <em>{hz[h].aligned === "up" ? "Aligned up" : "Aligned defensive"}</em>}</span>))}
      </div>
      {ROWS.map(([k, label]) => (
        <div role="row" key={k}>
          <span role="rowheader" className="label">{label}</span>
          {HORIZONS.map(([h]) => {
            const c = hz[h]?.[k] || {};
            const note = k === "engine" ? (c.signal ? SIGNAL_LABEL[c.signal] : "No signal") : k === "wallets" ? (alignment.positions_through ? "Quiet" : "Building") : "Building";
            return (
              <span role="cell" key={h}>
                <Cell state={c.state} note={note} />
                {k === "engine" && c.signal && <small className="dim">{SIGNAL_LABEL[c.signal] || c.signal}</small>}
                {k === "wallets" && c.positions > 0 && <small className="dim">{c.positions} positions</small>}
              </span>);
          })}
        </div>))}
      {alignment.positions_through && <p className="status">Smart wallets as of {alignment.positions_through} close</p>}
    </div>
  );
}
