import { Info } from "./ui.jsx";
import { utc, dayTime } from "../lib/format.js";

export const QUALITY_LABEL = {
  ready: "Ready",
  history_updated: "History recovered",
  partial_flow: "Partial flow",
  skew_only: "From skew",
  insufficient_data: "Insufficient data",
  unknown: "Unavailable",
  missing: "Unavailable",
  unavailable: "Unavailable",
  stale: "Stale data",
  future: "Timestamp mismatch",
  thin_volume: "Thin volume",
  "warming up": "Warming up",
  "not enough data": "Short history",
  missing_quotes: "Missing quotes",
  modelled_delta: "Estimated delta",
  insufficient_exposure: "Insufficient exposure",
};

export function FlowCoverage({ coverage, as: Tag = "p" }) {
  if (!coverage)
    return <Tag className="status warn">Collection coverage unavailable</Tag>;
  return (
    <Tag className={`status flow-coverage ${coverage.ready ? "" : "warn"}`}>
      {coverage.ready ? "" : `Partial collection · ${(coverage.fraction * 100).toFixed(1)}% of window · `}
      {coverage.end ? `through ${dayTime(coverage.end)}` : ""}
      <Info label="About flow coverage">
        Trades are grouped by their execution time into complete 15-minute
        buckets, refreshed every 15 minutes. Empty intervals count only after a
        successful collection. Partial windows are shown for context and do not
        enter the options tone.
      </Info>
    </Tag>
  );
}

const MODEL_REASON = {
  invalid_curve: "Smile failed price-curve checks",
  thin_quotes: "Too few supported strikes",
  outside_quoted_strikes: "Band extends beyond quoted strikes",
  insufficient_range: "Insufficient strike range",
  duplicate_strikes: "Duplicate strikes",
};
export function ModelDetails({ implied }) {
  if (!implied?.length) return null;
  const fallback = implied.filter((r) => r.method === "atm").length;
  return (
    <details className="condition-details">
      <summary>
        Range models · {fallback} / {implied.length} use ATM fallback
      </summary>
      <p className="status">
        Smile ranges require consistent option-price curves. ATM fallback uses
        one volatility for the entire expiry and does not retain strike skew.
      </p>
      <div className="table-wrap">
        <table className="grid" style={{ minWidth: 420 }}>
          <thead>
            <tr>
              <th>Expiry</th>
              <th>Method</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {implied.map((r) => (
              <tr key={r.expiry} style={{ cursor: "default" }}>
                <td>{utc(r.expiry)}</td>
                <td>{r.method === "atm" ? "ATM fallback" : "Checked smile"}</td>
                <td>{MODEL_REASON[r.quality?.status] || "Checks passed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
