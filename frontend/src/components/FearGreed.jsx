import { Info, Empty } from "./ui.jsx";
import { utc } from "../lib/format.js";
import "../fear-greed.css";
const BANDS = ["Extreme fear", "Fear", "Neutral", "Greed", "Extreme greed"];
const ARCS = [
  "M24,110 A86,86 0 0 1 39.25,61.10",
  "M41.63,57.83 A86,86 0 0 1 81.50,28.86",
  "M85.36,27.61 A86,86 0 0 1 134.64,27.61",
  "M138.50,28.86 A86,86 0 0 1 178.37,57.83",
  "M180.75,61.10 A86,86 0 0 1 196,110",
];
const COMPACT_HELP = "Alternative.me's market-wide Fear & Greed index, 0 to 100. Not coin-specific. The engine's not-greedy check needs it below 70; at 40 or below some Base forming paths open.";

/** Alternative.me's Fear & Greed dial, as the Markets band shows it: a small dial, the number and its band. */
export default function FearGreed({ sentiment, at }) {
  const raw = sentiment?.fear_greed_value;
  const valid = Number.isFinite(raw) && raw >= 0 && raw <= 100;
  const band = valid ? Math.min(4, Math.max(0, Math.ceil(raw / 20) - 1)) : -1;
  const stale = !at || Date.now() / 1000 - at > 86400 + 1200;
  const name = valid ? `${raw} out of 100, ${BANDS[band]}` : "Sentiment unavailable";
  return (
    <div className={`fg-compact fg-band-${band}${stale ? " stale" : ""}`}>
      <svg className="fg-dial" viewBox="14 17 192 101" role="img" aria-label={name}>
        {ARCS.map((d, i) => <path key={d} d={d} className={`fg-arc fg-arc-${i}${i === band ? " on" : ""}`} />)}
        {valid && <g transform={`rotate(${-90 + raw * 1.8} 110 110)`}>
          <path d="M110 29 110 110" className="fg-needle" />
          <circle cx="110" cy="24" r="5.5" className="fg-marker" />
        </g>}
        <circle cx="110" cy="110" r="5" className="fg-hub" />
      </svg>
      <div className="fg-read">
        <span className="fg-label">
          Fear &amp; Greed
          <Info label="Explain Fear and Greed">
            {COMPACT_HELP}{" "}
            {at ? `${stale ? "Previous observation" : "Observed"} ${utc(at)}.` : "Observation time unavailable."}
          </Info>
        </span>
        <span className="fg-value">
          {valid ? <strong>{raw}</strong> : <Empty label="Sentiment unavailable" />}
          {valid && <em>{BANDS[band]}</em>}
        </span>
      </div>
    </div>
  );
}
