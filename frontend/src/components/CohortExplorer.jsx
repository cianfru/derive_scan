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
export function ExposureBar({ lean }) {
  const s = lean?.score;
  if (s == null)
    return (
      <span className="status">
        {lean?.positions
          ? lean.quotes_complete && lean.gross_delta_usd === 0
            ? "Zero quoted delta"
            : "Quote coverage incomplete"
          : "No open positions"}
      </span>
    );
  const tone = s >= 0.25 ? "up" : s <= -0.25 ? "down" : "dim";
  return (
    <span className={`exposure-reading ${tone}`}>
      <span className="exposure-track">
        <i
          style={{
            left: `${50 + Math.min(0, s) * 50}%`,
            width: `${Math.abs(s) * 50}%`,
          }}
        />
      </span>
      <b>
        {s >= 0.25
          ? "Long delta"
          : s <= -0.25
            ? "Short delta"
            : "Balanced delta"}
      </b>
      <small>
        {s > 0 ? "+" : ""}
        {(s * 100).toFixed(0)}%
      </small>
    </span>
  );
}
export default function CohortExplorer({ cohorts, through, valuedAt }) {
  const [dim, setDim] = useState("pnl"),
    [chosen, setChosen] = useState("Money Printer"),
    [window, setWindow] = useState("all");
  const rows = (cohorts?.[dim] || []).filter((c) => c.wallets > 0);
  const c = rows.find((c) => c.name === chosen) || rows[0];
  const book = c?.windows?.[window];
  const coins = Object.entries(book?.coins || {})
    .filter(([, b]) => b.positions > 0)
    .sort((a, b) => (b[1].gross_delta_usd || 0) - (a[1].gross_delta_usd || 0));
  const t = book?.total;
  return (
    <section className="cohort-explorer" aria-label="Trader cohort positioning">
      <div className="cohort-heading">
        <div>
          <h2>Inside the cohort</h2>
          <p className="sub">
            Choose a group. See where its options book is positioned.
          </p>
        </div>
        <Tabs
          label="Cohort grouping"
          value={dim}
          onChange={setDim}
          items={[
            ["pnl", "By results"],
            ["size", "By size"],
          ]}
        />
      </div>
      <div className="cohort-workspace">
        <nav className="cohort-selector" aria-label="Select trader cohort">
          {rows.map((r) => (
            <button
              key={r.name}
              aria-pressed={r.name === c?.name}
              onClick={() => setChosen(r.name)}
            >
              <span>{r.name}</span>
              <small>{r.wallets.toLocaleString()} wallets</small>
            </button>
          ))}
        </nav>
        <div className="cohort-detail" aria-live="polite">
          {c ? (
            <>
              <div className="cohort-title">
                <div>
                  <h3>{c.name}</h3>
                  <p>
                    {BOUNDS[c.name] || "Defined results cohort"}. Before fees.{" "}
                    <Info label="Explain trader cohorts">
                      Results cohorts use the full collected history of expired
                      options, not a 30-day ranking. Size cohorts use total
                      premium traded. Market makers are excluded by the existing
                      classification. {COHORT_HELP}
                    </Info>
                  </p>
                </div>
                <ExposureBar lean={t} />
              </div>
              <Tabs
                label="Cohort option expiry"
                value={window}
                onChange={setWindow}
                items={[
                  ["all", "All unexpired"],
                  ["7d", "Within 7d"],
                  ["30d", "Within 30d"],
                  ["beyond30d", "Beyond 30d"],
                ]}
              />
              <div className="cohort-totals">
                <span>
                  Net option delta <Info>{COHORT_HELP}</Info>
                  <b>{usd(t?.net_delta_usd)}</b>
                </span>
                <span>
                  Gross option delta<b>{usd(t?.gross_delta_usd)}</b>
                </span>
                <span>
                  Open positions{" "}
                  <Info>
                    Wallet-instrument positions, not distinct wallets. The
                    selected expiry filter applies to all figures in this panel;
                    Within 30d includes Within 7d.
                  </Info>
                  <b>{t?.positions ?? "—"}</b>
                </span>
              </div>
              <div className="table-wrap">
                <table className="grid exposure-grid">
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Delta balance</th>
                      <th className="num">Net delta</th>
                      <th className="num">Gross delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coins.map(([und, b]) => (
                      <tr key={und}>
                        <td>
                          <Link className="asset-link" to={`/coin/${und}#wallets`}>
                            <Asset und={und} compact />
                          </Link>
                        </td>
                        <td>
                          <ExposureBar lean={b} />
                        </td>
                        <td
                          className={`num ${b.net_delta_usd > 0 ? "up" : b.net_delta_usd < 0 ? "down" : ""}`}
                        >
                          {usd(b.net_delta_usd)}
                        </td>
                        <td className="num">
                          {usd(b.gross_delta_usd)}
                          <small>{b.positions} positions</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!coins.length && (
                <p className="empty-state">
                  {book
                    ? "No open options in this expiry window."
                    : "This snapshot predates the cohort breakdown. The next publication adds it."}
                </p>
              )}
              <p className="status">
                Positions reconstructed through {through} UTC. Valued{" "}
                {valuedAt ? utc(valuedAt) : "at publication"}
                {valuedAt && Date.now() / 1000 - valuedAt > 1800
                  ? " (historical snapshot)"
                  : ""}
                . Subsequent trades are not included. <Info>{COHORT_HELP}</Info>
              </p>
            </>
          ) : (
            <p className="empty-state">
              No classified cohorts in this snapshot.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
