import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import {
  price,
  chg,
  pct,
  usd,
  title,
  utc,
  SIGNAL_RANK,
  SIGNAL_LABEL,
  REGIME,
} from "../lib/format.js";
import { openMarketRow } from "../lib/explain.js";
import { Signal, Tabs, Loading, Failed, Info } from "../components/ui.jsx";
import { Asset, MarketTrace } from "../components/MarketVisuals.jsx";
import {
  EnginePair,
  Convergence,
  CONVERGENCE_HELP,
} from "../components/EngineComparison.jsx";
import { currentEngine } from "../lib/research.js";
import FearGreed from "../components/FearGreed.jsx";
import { ChainMini, ChainLegend } from "../components/Chain.jsx";

export default function Markets() {
  const { data, error } = useData("markets.json");
  const nav = useNavigate();
  const [q, setQ] = useState(""),
    [signalFilter, setSignalFilter] = useState(null),
    [view, setView] = useState("options"),
    [details, setDetails] = useState(false),
    [sort, setSort] = useState(["align", -1]);
  const rows = useMemo(() => {
    let r = (data?.coins || []).filter((c) =>
      c.und.toLowerCase().includes(q.trim().toLowerCase()),
    );
    r = r.filter((c) => (view === "perps" ? !c.has_options : c.has_options));
    if (view === "entries")
      r = r.filter((c) => (SIGNAL_RANK[c.signal_1d] ?? 0) >= 3);
    if (signalFilter)
      r = r.filter(
        (c) =>
          currentEngine(c.engine_comparison?.["1d"]) &&
          (signalFilter === "TRIM"
            ? ["TRIM", "TRIM_HARD"].includes(c.signal_1d)
            : c.signal_1d === signalFilter),
      );
    return [...r].sort((a, b) => {
      const key = (c) => (sort[0] === "align" ? (c.align?.score ?? null) : c[sort[0]]);
      const x = key(a),
        y = key(b);
      if (x == null && y == null) return a.und.localeCompare(b.und);
      if (x == null) return 1;
      if (y == null) return -1;
      return (
        (x > y ? 1 : x < y ? -1 : 0) * sort[1] || a.und.localeCompare(b.und)
      );
    });
  }, [data, q, view, sort, signalFilter]);
  if (error && !data)
    return (
      <div className="wrap page">
        <Failed error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="wrap page">
        <Loading />
      </div>
    );
  const sortHead = (key, name, cls = "") => (
    <th
      className={cls}
      aria-sort={
        sort[0] === key ? (sort[1] > 0 ? "ascending" : "descending") : undefined
      }
    >
      <button
        className="sort-button"
        onClick={() => setSort(([k, d]) => [key, k === key ? -d : -1])}
      >
        {name}
        <span aria-hidden="true">
          {sort[0] === key ? (sort[1] > 0 ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
  const eligible = data.coins.filter((c) =>
    currentEngine(c.engine_comparison?.["1d"]),
  );
  const groups = Object.entries(REGIME)
    .map(([k, name]) => ({
      k,
      name,
      n: eligible.filter((c) => c.regime_1d === k).length,
    }))
    .filter((g) => g.n);
  return (
    <div className="wrap page markets-page">
      <div className="page-heading">
        <div>
          <h1>Markets</h1>
          <p className="sub">
            The daily structure. The price of risk. The positioning behind it.
          </p>
        </div>
        <div className="close-stamp">
          <span>Daily engine</span>
          <b>{data.bars?.["1d"] ? utc(data.bars["1d"]) : "Awaiting close"}</b>
        </div>
      </div>
      <div className="daily-briefing">
        <section className="market-structure">
          <div className="instrument-label">
            Daily market structure{" "}
            <Info label="Explain daily market structure">
              Consensus aggregates eligible daily engine readings. Missing or
              incomplete markets do not vote. The distribution below shows the
              separate regimes of markets with available daily signals, across
              all tracked perpetuals.
            </Info>
          </div>
          <div className="structure-title">
            <strong>
              {data.consensus_detail?.["1d"]?.status === "unavailable"
                ? "Unavailable"
                : title(data.consensus?.["1d"]) || "Unavailable"}
            </strong>
            <span>
              {eligible.length} of {data.coins.length} daily readings available
            </span>
          </div>
          <div
            className="regime-distribution"
            aria-label="Daily regime distribution"
          >
            {groups.map((g) => (
              <span
                key={g.k}
                className={`regime-segment regime-${g.k}`}
                style={{ flex: g.n }}
                title={`${g.name}: ${g.n} markets`}
              />
            ))}
          </div>
          <div className="regime-key">
            {groups.map((g) => (
              <span key={g.k}>
                <i className={`regime-${g.k}`} />
                {g.name}
                <b>{g.n}</b>
              </span>
            ))}
          </div>
        </section>
        <FearGreed
          sentiment={data.context?.sentiment}
          at={data.context?.sentiment_at}
        />
      </div>
      <div className="signal-distribution" aria-label="Filter daily signals">
        {[
          "STRONG_LONG",
          "LIGHT_LONG",
          "ACCUMULATE",
          "WAIT",
          "TRIM",
          "RISK_OFF",
        ].map((signal) => {
          const count = eligible.filter((c) =>
            signal === "TRIM"
              ? ["TRIM", "TRIM_HARD"].includes(c.signal_1d)
              : c.signal_1d === signal,
          ).length;
          return (
            <button
              key={signal}
              disabled={!count && signalFilter !== signal}
              aria-pressed={signalFilter === signal}
              onClick={() =>
                setSignalFilter(signalFilter === signal ? null : signal)
              }
            >
              <span>{SIGNAL_LABEL[signal]}</span>
              <b>{count}</b>
              <i
                style={{
                  width: `${eligible.length ? (count / eligible.length) * 100 : 0}%`,
                }}
              />
            </button>
          );
        })}
        <Info label="Explain daily signal counts">
          Counts cover available daily engines across all tracked markets.
          Select a signal to filter the table; the market-type and search
          filters still apply. A high count does not indicate trade quality.
        </Info>
      </div>
      <section className="market-board" aria-label="Market readings">
        <div className="board-toolbar">
          <Tabs
            label="Market filter"
            value={view}
            onChange={setView}
            items={[
              ["options", "Options markets"],
              ["entries", "Daily entries"],
              ["perps", "Perps only"],
            ]}
          />
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              className="search"
              placeholder="Find a market"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Find a market"
            />
          </label>
        </div>
        <div className="board-controls">
          <span>
            {rows.length} markets{view !== "perps" && !details ? " · sorted by agreement" : ""}{" "}
            <Info>Each market is read in three steps, always in this order: 1 Regime (the daily engine), 2 Wallets (what Derive's best options traders hold on expiries in the window), 3 Options (what option prices lean towards). A framed chain means all three point the same way. Context side by side, not a combined signal.</Info>
          </span>
          <div>
            {view !== "perps" && !details && <ChainLegend />}
            <button
              className="text-control"
              aria-pressed={details}
              onClick={() => setDetails((v) => !v)}
            >
              {details ? "Show overview" : "More measurements"}
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="grid market-grid">
            <thead>
              <tr>
                {sortHead("und", "Market")}
                <th className="hide-md">60 days</th>
                {details || view === "perps" ? (
                  <>
                    <th>Engine pair · 1D / 4H <Info>{CONVERGENCE_HELP}</Info></th>
                    <th>Convergence</th>
                    {sortHead("z_1d", "Daily stretch", "num")}
                    {sortHead("heat_1d", "Daily heat", "num")}
                    {sortHead("oi_usd", "Perp OI", "num")}
                    {sortHead("funding_ann", "Funding / year", "num")}
                  </>
                ) : (
                  <>
                    <th>Regime</th>
                    {sortHead("align", "Next 7 days")}
                    <th>Next 30 days</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.und}
                  tabIndex={0}
                  aria-label={`Open ${c.und} market`}
                  onClick={(e) => openMarketRow(e, nav, c.und)}
                  onKeyDown={(e) => openMarketRow(e, nav, c.und)}
                >
                  <td>
                    <Link className="asset-link" to={`/coin/${c.und}`}>
                      <Asset und={c.und} compact />
                    </Link>
                    <span className="market-price">${price(c.price)}{" "}
                      <small className={c.chg_1d > 0 ? "up" : c.chg_1d < 0 ? "down" : ""}>{chg(c.chg_1d)}</small></span>
                  </td>
                  <td className="hide-md">
                    <MarketTrace values={c.spark_1d} times={c.spark_times_1d} label={`${c.und} daily closes`} />
                  </td>
                  {details || view === "perps" ? (
                    <>
                      <td><EnginePair comparison={c.engine_comparison} compact /></td>
                      <td><Convergence comparison={c.engine_comparison} compact /></td>
                      <td className="num">{c.signal_1d && Number.isFinite(c.z_1d) ? `${c.z_1d.toFixed(2)}σ` : "—"}</td>
                      <td className="num">{c.signal_1d ? (c.heat_1d ?? "—") : "—"}</td>
                      <td className="num">{usd(c.oi_usd)}</td>
                      <td className="num">{pct(c.funding_ann)}</td>
                    </>
                  ) : (
                    <>
                      <td className="regime-td">
                        <div className="regime-cell">{currentEngine(c.engine_comparison?.["1d"]) ? <><Signal s={c.signal_1d} help={false} /><small>{REGIME[c.regime_1d] || title(c.regime_1d)}</small></> : <span className="status">Short history</span>}</div>
                      </td>
                      <td className="chain-td" data-h="7 days"><ChainMini alignment={c.align} horizon="7d" /></td>
                      <td className="chain-td" data-h="30 days"><ChainMini alignment={c.align} horizon="30d" /></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="empty-state">
            <h3>No markets in this view</h3>
            <p>Change the filter or search another symbol.</p>
            <button
              className="btn"
              onClick={() => {
                setQ("");
                setSignalFilter(null);
                setView("options");
              }}
            >
              Show options markets
            </button>
          </div>
        )}
        <div className="board-foot">
          <span>Open any part of a row to inspect the market.</span>
          <span>Regime, wallets and options are read separately and shown side by side.</span>
        </div>
      </section>
      <p className="status">
        Snapshot published {utc(data.generated_at)}. Index price is the latest
        options snapshot where available; daily change compares the two latest
        completed UTC days.
      </p>
    </div>
  );
}
