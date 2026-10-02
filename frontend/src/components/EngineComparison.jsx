import { useState } from "react";
import { Conditions } from "./AnalyticalDetails.jsx";
import { Info, Signal, Tabs } from "./ui.jsx";
import { REGIME, title, utc } from "../lib/format.js";
import { REGIME_HELP } from "../lib/explain.js";
import { currentEngine, comparisonView } from "../lib/research.js";
import { STATUS_NAMES } from "../lib/presentation.js";

export const CONVERGENCE_HELP =
  "Compares the last completed 1D and 4H engine readings. The agreement score uses regime family, signal direction and heat; it is not a trade success rate. The combined signal follows the existing engine rules: exits take priority, conflicting or blocked entries wait. Daily remains the primary price view. Options pricing and wallet positioning do not enter this score.";
export function EnginePair({ comparison, compact = false }) {
  return (
    <div className={`engine-pair ${compact ? "compact" : ""}`}>
      {["1d", "4h"].map((tf) => {
        const r = comparison?.[tf],
          ready = currentEngine(r);
        return (
          <div key={tf} className="engine-pair-row">
            <span className="tf-label">{tf.toUpperCase()}</span>
            <span className="engine-pair-regime">
              {ready
                ? REGIME[r.regime] || title(r.regime)
                : STATUS_NAMES[r?.status === "ready" ? "stale" : r?.status] ||
                  "Unavailable"}
              {ready && (
                <Info label={`Explain ${tf} regime`}>
                  {REGIME_HELP[r.regime]} Last completed bar:{" "}
                  {utc(r.observed_at)}. Derive volume:{" "}
                  {r.volume_status || "unavailable"}.
                </Info>
              )}
            </span>
            {ready ? <Signal s={r.signal} /> : <span className="faint">—</span>}
          </div>
        );
      })}
    </div>
  );
}
export function Convergence({ comparison, compact = false }) {
  const { complete, confluence: c, unified } = comparisonView(comparison);
  return (
    <div className={`convergence ${compact ? "compact" : ""}`}>
      {complete && c ? (
        <>
          <div className="agreement-score">
            <b>
              {c.score}
              <small>/100</small>
            </b>
            <span>{title(c.label)} agreement</span>
            <Info label="Explain timeframe agreement">{CONVERGENCE_HELP}</Info>
          </div>
          <div className="agreement-track" aria-hidden="true">
            <i style={{ width: `${c.score}%` }} />
          </div>
          <div className="combined-signal">
            <span>Combined</span>
            <Signal s={unified} />
          </div>
          {!compact && (
            <div className="agreement-evidence">
              <span>
                Regimes{" "}
                <b>{c.regime_aligned ? "Same family" : "Not aligned"}</b>
              </span>
              <span>
                Signals{" "}
                <b>
                  {c.signal_aligned == null
                    ? "Both waiting"
                    : c.signal_aligned
                      ? "Same direction"
                      : "Not aligned"}
                </b>
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          <span className="label">Comparison incomplete</span>
          <p className="status">Both current engine readings are required.</p>
        </>
      )}
    </div>
  );
}
export default function EngineComparison({ comparison }) {
  return (
    <section
      className="engine-comparison"
      aria-label="Engine timeframe comparison"
    >
      <div className="evidence-heading">
        <span className="section-code">01 / PRICE ENGINE</span>
        <h2>Two timeframes. One decision.</h2>
      </div>
      <div className="engine-comparison-body">
        <EnginePair comparison={comparison} />
        <Convergence comparison={comparison} />
      </div>
    </section>
  );
}

export function EngineEvidence({ latest }) {
  const [tf, setTf] = useState("1d");
  return (
    <section className="condition-scorecard">
      <div className="evidence-heading">
        <span className="section-code">SETUP EVIDENCE</span>
        <h2>What supports the reading?</h2>
        <Tabs
          label="Evidence timeframe"
          value={tf}
          onChange={setTf}
          items={[
            ["1d", "Daily"],
            ["4h", "4 hours"],
          ]}
        />
      </div>
      <Conditions row={latest?.[tf]} expanded />
    </section>
  );
}
