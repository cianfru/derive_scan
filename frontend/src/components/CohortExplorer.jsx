import { useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, Info } from "./ui.jsx";
import { Asset } from "./MarketVisuals.jsx";
import { usd, utc } from "../lib/format.js";
import { COHORT_HELP } from "../lib/explain.js";
const BOUNDS = {
  "Money Printer": "At least $1M gross profit on expired options",
  "Smart Money": "$100K to $1M gross profit on expired options",
  Grinder: "$10K to $100K gross profit on expired options",
  "Humble Earner": "$0 to $10K gross profit on expired options",
  "Exit Liquidity": "$0 to $10K gross loss on expired options",
  "Semi-Rekt": "$10K to $100K gross loss on expired options",
  "Full Rekt": "$100K to $1M gross loss on expired options",
  "Giga-Rekt": "More than $1M gross loss on expired options",
  Leviathan: "At least $10M premium traded",
  Whale: "$1M to $10M premium traded",
  Dolphin: "$100K to $1M premium traded",
  Fish: "$10K to $100K premium traded",
  Shrimp: "Less than $10K premium traded",
};
const complete = (b) => b && b.score != null && b.net_delta_usd != null;
/** Totals over the coins whose quotes are complete; partial when any coin is left out. */
export function completeTotals(book) {
  const coins = Object.values(book?.coins || {}).filter((b) => b.positions > 0);
  const ok = coins.filter(complete);
  const net = ok.reduce((s, b) => s + b.net_delta_usd, 0),
    gross = ok.reduce((s, b) => s + (b.gross_delta_usd || 0), 0);
  return {
    net: ok.length ? net : null,
    gross: ok.length ? gross : null,
    score: gross > 0 ? net / gross : null,
    positions: book?.total?.positions ?? coins.reduce((s, b) => s + b.positions, 0),
    partial: ok.length < coins.length,
  };
}
const toneOf = (s) => (s >= 0.25 ? "up" : s <= -0.25 ? "down" : "dim");
export function ExposureBar({ lean }) {
  const s = lean?.score;
  if (s == null) return <span className="faint">–</span>;
  return (
    <span className={`exposure-reading ${toneOf(s)}`}>
      <span className="exposure-track">
        <i style={{ left: `${50 + Math.min(0, s) * 50}%`, width: `${Math.abs(s) * 50}%` }} />
      </span>
      <b>{s >= 0.25 ? "Long delta" : s <= -0.25 ? "Short delta" : "Balanced delta"}</b>
      <small>{s > 0 ? "+" : ""}{(s * 100).toFixed(0)}%</small>
    </span>
  );
}
function MiniBar({ score }) {
  return (
    <i className={`cohort-mini ${score == null ? "" : toneOf(score)}`} aria-hidden="true">
      {score != null && <b style={{ left: `${50 + Math.min(0, score) * 50}%`, width: `${Math.abs(score) * 50}%` }} />}
    </i>
  );
}
const Dagger = ({ on }) => (on ? <sup className="dagger" aria-label="complete quotes only">†</sup> : null);
export default function CohortExplorer({ cohorts, through, valuedAt }) {
  const [dim, setDim] = useState("pnl"),
    [chosen, setChosen] = useState("Money Printer"),
    [window, setWindow] = useState("all");
  const rows = (cohorts?.[dim] || []).filter((c) => c.wallets > 0);
  const c = rows.find((c) => c.name === chosen) || rows[0];
  const book = c?.windows?.[window];
  const coins = Object.entries(book?.coins || {})
    .filter(([, b]) => b.positions > 0)
    .sort((a, b) => (complete(b[1]) - complete(a[1])) || (b[1].gross_delta_usd || 0) - (a[1].gross_delta_usd || 0));
  const t = completeTotals(book);
  const stale = valuedAt && Date.now() / 1000 - valuedAt > 1800;
  return (
    <section className="cohort-explorer" aria-label="Trader cohort positioning">
      <div className="cohort-heading">
        <h2>
          Cohorts
          <Info label="Explain trader cohorts">
            {BOUNDS[c?.name] ? `${c.name}: ${BOUNDS[c.name]}, before fees. ` : ""}
            Results cohorts use the full collected history of expired options; size cohorts use total premium traded.
            Market makers are excluded. {COHORT_HELP} Open positions count wallet-instrument positions, not distinct
            wallets; Within 30d includes Within 7d. † Totals and selector bars cover only coins whose quotes are
            complete; coins shown with a dash are left out. Positions reconstructed through {through} UTC, valued{" "}
            {valuedAt ? utc(valuedAt) : "at publication"}{stale ? " (historical snapshot)" : ""}.
          </Info>
        </h2>
        <Tabs label="Cohort grouping" value={dim} onChange={setDim} items={[["pnl", "By results"], ["size", "By size"]]} />
      </div>
      <div className="cohort-workspace">
        <nav className="cohort-selector" aria-label="Select trader cohort">
          {rows.map((r) => {
            const rt = completeTotals(r.windows?.[window]);
            return (
              <button key={r.name} aria-pressed={r.name === c?.name} onClick={() => setChosen(r.name)}>
                <span>{r.name}</span>
                <span className="cohort-meta"><MiniBar score={rt.score} /><small>{r.wallets.toLocaleString("en-US")}</small></span>
              </button>
            );
          })}
        </nav>
        <div className="cohort-detail" aria-live="polite">
          {c ? (
            <>
              <div className="cohort-title">
                <h3>{c.name}</h3>
                <span>{BOUNDS[c.name] || "Defined results cohort"}</span>
              </div>
              <Tabs label="Cohort option expiry" value={window} onChange={setWindow}
                items={[["all", "All unexpired"], ["7d", "Within 7d", "7d"], ["30d", "Within 30d", "30d"], ["beyond30d", "Beyond 30d", "> 30d"]]} />
              <div className="cohort-totals">
                <span>Net option delta<b className={t.net > 0 ? "up" : t.net < 0 ? "down" : ""}>{usd(t.net)}<Dagger on={t.partial && t.net != null} /></b></span>
                <span>Gross option delta<b>{usd(t.gross)}<Dagger on={t.partial && t.gross != null} /></b></span>
                <span>Open positions<b>{t.positions ?? "—"}</b></span>
              </div>
              {coins.length > 0 && (
                <div className="table-wrap">
                  <table className="grid exposure-grid">
                    <thead><tr><th>Market</th><th>Delta balance</th><th className="num">Net delta</th><th className="num">Gross delta</th></tr></thead>
                    <tbody>
                      {coins.map(([und, b]) => (
                        <tr key={und}>
                          <td><Link className="asset-link" to={`/coin/${und}#wallets`}><Asset und={und} compact /></Link></td>
                          <td><ExposureBar lean={b} /></td>
                          <td className={`num ${b.net_delta_usd > 0 ? "up" : b.net_delta_usd < 0 ? "down" : ""}`}>{complete(b) ? usd(b.net_delta_usd) : <span className="faint">–</span>}</td>
                          <td className="num two-line">{complete(b) ? usd(b.gross_delta_usd) : <span className="faint">–</span>}<small>{b.positions} {b.positions === 1 ? "position" : "positions"}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!coins.length && <p className="empty-state">{book ? "No open options in this expiry window." : "—"}</p>}
            </>
          ) : (
            <p className="empty-state">—</p>
          )}
        </div>
      </div>
    </section>
  );
}
