import { Reading } from "./MarketVisuals.jsx";
import { coverageReady } from "./HistoryStatus.jsx";
import { Info } from "./ui.jsx";
import { viewReading } from "../lib/presentation.js";
const STATE = {
  up: ["Up", "var(--up)"],
  defensive: ["Defensive", "var(--down)"],
  neutral: ["Neutral", "var(--seam-hi)"],
};
const ROWS = [
  ["engine", "Daily engine"],
  ["options", "Option prices"],
  ["wallets", "Smart wallets"],
];
const HORIZONS = [
  ["7d", "7-day options"],
  ["30d", "30-day options"],
];
export const ALIGN_INFO =
  "Three separate measurements. Both columns use the same daily price engine. The 7-day view compares 7-day option tenor with 24-hour taker premium flow and wallet options expiring within 7 days. The 30-day view uses 30-day tenor, 7-day flow and expiry within 30 days. These are expiry windows, not performance-ranking periods. Alignment is context and never feeds the engine.";
export function AlignSquares({ a }) {
  if (!a || a.version !== 2) return <span className="faint">—</span>;
  const states = Object.fromEntries(
    HORIZONS.map(([h]) => [h, ROWS.map(([k]) => viewReading(a, h, k).state)]),
  );
  const description = HORIZONS.map(
    ([h, label]) =>
      `${label}: ${ROWS.map(([k, name], i) => `${name}: ${k === "wallets" && !coverageReady(a.wallet_coverage) ? "history incomplete" : STATE[states[h][i]]?.[0] || "insufficient data"}`).join(", ")}`,
  ).join(". ");
  return (
    <span className="al-sq" aria-label={description}>
      <span>
        {states["7d"].map((s, i) => (
          <i key={i} style={{ background: STATE[s]?.[1] || "transparent" }} />
        ))}
      </span>
      <span>
        {states["30d"].map((s, i) => (
          <i key={i} style={{ background: STATE[s]?.[1] || "transparent" }} />
        ))}
      </span>
      <Info label="Explain alignment readings">{description}</Info>
    </span>
  );
}
export default function AlignmentGrid({ alignment }) {
  const hz = alignment?.horizons;
  if (!hz || alignment.version !== 2)
    return <p className="status">Updating analytical readings.</p>;
  const ready = coverageReady(alignment.wallet_coverage);
  return (
    <div className="al-grid" role="table" aria-label="Alignment by horizon">
      <div role="row" className="al-head">
        <span />
        {HORIZONS.map(([h, label]) => {
          const states = ROWS.map(([k]) => viewReading(alignment, h, k).state),
            aligned =
              ready &&
              ["up", "defensive"].includes(states[0]) &&
              states.every((s) => s === states[0])
                ? states[0]
                : null;
          return (
            <span
              key={h}
              role="columnheader"
              className={aligned ? `al-on ${aligned}` : ""}
            >
              {label}
              {aligned && (
                <em>{aligned === "up" ? "Aligned up" : "Aligned defensive"}</em>
              )}
            </span>
          );
        })}
      </div>
      {ROWS.map(([k, label]) => (
        <div role="row" key={k}>
          <span role="rowheader" className="label">
            {label}
          </span>
          {HORIZONS.map(([h]) => {
            const c = hz[h]?.[k] || {};
            return (
              <span role="cell" key={h}>
                <Reading alignment={alignment} horizon={h} kind={k} />
                {k === "engine" && (
                  <small className="dim">Last daily close</small>
                )}
                {k === "options" && (
                  <small className="dim">
                    {h === "7d" ? "7d tenor / 24h flow" : "30d tenor / 7d flow"}
                  </small>
                )}
                {k === "wallets" && (
                  <small className="dim">
                    {c.positions > 0 ? `${c.positions} positions / ` : ""}Expiry
                    within {h}
                    <Info>
                      Counts wallet-instrument positions, not distinct wallets.
                      Current history and sufficient exposure with fresh quoted
                      deltas are required for direction. The expiry window is
                      not the ranking period.
                    </Info>
                  </small>
                )}
              </span>
            );
          })}
        </div>
      ))}
      <p className="status">
        Wallet history:{" "}
        {alignment.positions_through
          ? `through ${alignment.positions_through} UTC close`
          : "accumulating"}
        . {!ready && "Wallet readings are withheld until history is current."}{" "}
        <Info label="About wallet reading availability">
          Collection continues automatically. Missing history is not a neutral
          position. Once history is current, a reading requires at least three
          positions and $10,000 gross delta exposure inside the selected expiry
          window.
        </Info>
      </p>
    </div>
  );
}
