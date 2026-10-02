import { Info } from "./ui.jsx";
import { utc } from "../lib/format.js";
const BANDS = ["Extreme fear", "Fear", "Neutral", "Greed", "Extreme greed"];
const ARCS = [
  "M24,110 A86,86 0 0 1 39.25,61.10",
  "M41.63,57.83 A86,86 0 0 1 81.50,28.86",
  "M85.36,27.61 A86,86 0 0 1 134.64,27.61",
  "M138.50,28.86 A86,86 0 0 1 178.37,57.83",
  "M180.75,61.10 A86,86 0 0 1 196,110",
];
export default function FearGreed({ sentiment, at }) {
  const raw = sentiment?.fear_greed_value;
  const valid = Number.isFinite(raw) && raw >= 0 && raw <= 100;
  const band = valid ? Math.min(4, Math.max(0, Math.ceil(raw / 20) - 1)) : -1;
  const stale = !at || Date.now() / 1000 - at > 86400 + 1200;
  return (
    <section className="sentiment-instrument" aria-label="Fear and Greed index">
      <div className="instrument-label">
        Fear & Greed{" "}
        <Info label="Explain Fear and Greed">
          Alternative.me’s market-wide sentiment index, from 0 (extreme fear) to
          100 (extreme greed). It is not coin-specific. The engine's fear gate
          is ≤40 for some Accumulate and Revival paths; its not-greedy gate is
          below 70. The dial bands and needle use the same value.{" "}
          {at ? `Observed ${utc(at)}.` : "Observation time unavailable."}
        </Info>
      </div>
      <div className="sentiment-body">
        <svg
          viewBox="0 0 220 135"
          role="img"
          aria-label={
            valid
              ? `${raw} out of 100, ${BANDS[band]}`
              : "Sentiment unavailable"
          }
        >
          {ARCS.map((d, i) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke={i === band ? "var(--orange)" : "var(--seam-hi)"}
              strokeWidth="10"
            />
          ))}
          <path
            d="M86.5 37.7 80.3 18.7 M154.7 48.5 166.4 32.3"
            stroke="var(--muted)"
          />
          {valid && (
            <g transform={`rotate(${-90 + raw * 1.8} 110 110)`}>
              <path d="M110 42 107 110 113 110Z" fill="var(--fg)" />
              <circle cx="110" cy="110" r="5" fill="var(--orange)" />
            </g>
          )}
          <text x="24" y="132" textAnchor="middle">
            0
          </text>
          <text x="196" y="132" textAnchor="middle">
            100
          </text>
        </svg>
        <div>
          <strong>
            {valid ? raw : "—"}
            <small>/100</small>
          </strong>
          <b>{valid ? BANDS[band] : "Unavailable"}</b>
          <span>
            {stale
              ? "Previous observation"
              : raw >= 70
                ? "Greed gate active"
                : raw <= 40
                  ? "Fear territory"
                  : "Between engine thresholds"}
          </span>
        </div>
      </div>
    </section>
  );
}
