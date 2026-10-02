import { Info } from "./ui.jsx";
import { title, utc } from "../lib/format.js";

export const QUALITY_LABEL = {
  ready: "Ready",
  history_updated: "History recovered",
  partial_flow: "Partial flow",
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

export function FlowCoverage({ coverage }) {
  if (!coverage)
    return <p className="status warn">Collection coverage unavailable</p>;
  return (
    <p className={`status ${coverage.ready ? "" : "warn"}`}>
      {coverage.ready
        ? "Complete collection"
        : `Partial collection · ${(coverage.fraction * 100).toFixed(1)}% of window`}
      {coverage.end ? ` · through ${utc(coverage.end)}` : ""}
      <Info label="About flow coverage">
        Trades are grouped by their execution time into complete 15-minute
        buckets. Empty intervals count only after a successful collection.
        Partial windows are shown for context and do not enter the options tone.
      </Info>
    </p>
  );
}

export function Conditions({ row, expanded = false }) {
  const conditions = row?.conditions_detail || [];
  if (!conditions.length)
    return (
      <div className="conditions-visible">
        <div className="condition-score">
          <strong>
            {row?.conditions_met ?? "—"}
            <small> / {row?.conditions_total ?? "—"}</small>
          </strong>
          <span>
            recorded checks passed
            <small>Detailed checklist not saved at this close</small>
          </span>
        </div>
        <div className="recorded-engine-facts">
          {[
            [
              "Price stretch",
              Number.isFinite(row?.zscore)
                ? `${row.zscore.toFixed(2)}σ`
                : "Unavailable",
              "Standard deviations from the trend baseline at this close.",
            ],
            [
              "Heat",
              row?.heat ?? "Unavailable",
              "Extension from the longer-term base, on a scale of 0 to 100.",
            ],
            [
              "Ribbon",
              title(row?.ribbon?.state),
              "Gold: moving averages stacked upward. Blue: stacked downward. Grey: no clear order.",
            ],
            [
              "Exhaustion",
              title(row?.exhaustion_state),
              "Observed extension, relative volume and absorption state. It is a separate engine input, not a reversal call.",
            ],
          ].map(([name, value, help]) => (
            <div key={name}>
              <span>
                {name} <Info label={`Explain ${name}`}>{help}</Info>
              </span>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <p className="status">
          {row?.signal_bar_close_time
            ? `Recorded ${utc(row.signal_bar_close_time)}`
            : "No completed reading"}{" "}
          · individual pass/fail results unavailable.
        </p>
      </div>
    );
  const known = conditions.filter((c) => c.available).length;
  if (expanded)
    return (
      <div className="conditions-visible">
        <div className="condition-score">
          <strong>
            {conditions.filter((c) => c.available && c.met).length}
            <small> / {conditions.length}</small>
          </strong>
          <span>
            checks passed{" "}
            <Info>
              The engine's entry checklist at the displayed close. Unknown
              inputs earn no points. The signal also follows regime-specific
              rules, vetoes and weighted thresholds, so this count alone does
              not determine the signal.
            </Info>
            <small>
              {known} of {conditions.length} inputs available
            </small>
          </span>
        </div>
        <div className="condition-tiles">
          {conditions.map((c) => (
            <div
              key={c.name}
              data-result={!c.available ? "unknown" : c.met ? "pass" : "fail"}
            >
              <span
                className="condition-result"
                aria-label={!c.available ? "Unknown" : c.met ? "Pass" : "Fail"}
              >
                {!c.available ? "?" : c.met ? "✓" : "×"}
              </span>
              <span>{c.label}</span>
              <Info label={`Explain ${c.label}`}>
                {c.desc}.{" "}
                {c.available
                  ? c.met
                    ? "Condition passed."
                    : "Condition did not pass."
                  : "Evidence unavailable; no point awarded."}{" "}
                Source: {c.source?.replaceAll("_", " ") || "Unavailable"}.{" "}
                {c.observed_at
                  ? utc(c.observed_at)
                  : "Observation time unavailable"}{" "}
                · {c.freshness || "Unknown freshness"}.
              </Info>
            </div>
          ))}
        </div>
        <p className="status">
          {row?.timeframe?.toUpperCase() || "Engine"} close{" "}
          {utc(row?.signal_bar_close_time)}
        </p>
      </div>
    );
  return (
    <details className="condition-details">
      <summary>
        Inspect conditions · {known} / {conditions.length} available
      </summary>
      <div className="table-wrap">
        <table className="grid" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th>Condition</th>
              <th>Result</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {conditions.map((c) => (
              <tr key={c.name} style={{ cursor: "default" }}>
                <td>
                  {c.label} <Info label={`About ${c.label}`}>{c.desc}</Info>
                </td>
                <td>{!c.available ? "Unknown" : c.met ? "Pass" : "Fail"}</td>
                <td className="dim">
                  {c.source?.replaceAll("_", " ") || "Unavailable"}
                  <small>
                    {c.observed_at ? utc(c.observed_at) : "No observation time"}{" "}
                    · {c.freshness || "unknown"}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
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
