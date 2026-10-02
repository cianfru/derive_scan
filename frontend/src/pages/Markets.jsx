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
  REGIME,
} from "../lib/format.js";
import { WINDOWS, STATUS_NAMES } from "../lib/presentation.js";
import { openMarketRow, REGIME_HELP, READING_HELP } from "../lib/explain.js";
import { Signal, Tabs, Loading, Failed, Info } from "../components/ui.jsx";
import { Asset, MarketTrace, Reading } from "../components/MarketVisuals.jsx";
import FearGreed from "../components/FearGreed.jsx";

export default function Markets() {
  const { data, error } = useData("markets.json");
  const nav = useNavigate();
  const [q, setQ] = useState(""),
    [view, setView] = useState("options"),
    [horizon, setHorizon] = useState("30d"),
    [details, setDetails] = useState(false),
    [sort, setSort] = useState(["oi_usd", -1]);
  const rows = useMemo(() => {
    let r = (data?.coins || []).filter((c) =>
      c.und.toLowerCase().includes(q.trim().toLowerCase()),
    );
    r = r.filter((c) => (view === "perps" ? !c.has_options : c.has_options));
    if (view === "entries")
      r = r.filter((c) => (SIGNAL_RANK[c.signal_1d] ?? 0) >= 3);
    return [...r].sort((a, b) => {
      const x = a[sort[0]],
        y = b[sort[0]];
      if (x == null && y == null) return a.und.localeCompare(b.und);
      if (x == null) return 1;
      if (y == null) return -1;
      return (
        (x > y ? 1 : x < y ? -1 : 0) * sort[1] || a.und.localeCompare(b.und)
      );
    });
  }, [data, q, view, sort]);
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
    c.align
      ? c.align.readings?.["30d"]?.engine?.status === "ready"
      : c.signal_1d,
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
            <strong>{data.consensus_detail?.["1d"]?.status === "unavailable" ? "Unavailable" : title(data.consensus?.["1d"]) || "Unavailable"}</strong>
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
                <Info label={`Explain ${g.name}`}>{REGIME_HELP[g.k]}</Info>
              </span>
            ))}
          </div>
        </section>
        <FearGreed
          sentiment={data.context?.sentiment}
          at={data.context?.sentiment_at}
        />
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
            {rows.length} markets / Daily engine{" "}
            <Info>{READING_HELP.engine}</Info>
          </span>
          <div>
            {view !== "perps" && !details && (
              <Tabs
                label="Options window"
                value={horizon}
                onChange={setHorizon}
                items={[
                  ["7d", "7-day options"],
                  ["30d", "30-day options"],
                ]}
              />
            )}
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
                {sortHead("price", "Index / daily", "num")}
                <th>
                  60 daily closes{" "}
                  <Info>
                    Up to 60 completed daily closes. External spot history
                    extends the chart before Derive's listing where available.
                    Each trace has its own vertical scale; the percentage is
                    change across its shown samples. The dashed reference is the
                    first close.
                  </Info>
                </th>
                <th>
                  Daily signal / regime <Info>{READING_HELP.engine}</Info>
                </th>
                {details || view === "perps" ? (
                  <>
                    {sortHead("z_1d", "Daily stretch", "num")}
                    {sortHead("heat_1d", "Daily heat", "num")}
                    {sortHead("oi_usd", "Perp OI", "num")}
                    {sortHead("funding_ann", "Funding / year", "num")}
                  </>
                ) : (
                  <>
                    <th>
                      Option prices <Info>{READING_HELP.options}</Info>
                      <small>{WINDOWS[horizon].options}</small>
                    </th>
                    <th>
                      Smart wallets <Info>{READING_HELP.wallets}</Info>
                      <small>{WINDOWS[horizon].wallets}</small>
                    </th>
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
                      <Asset und={c.und} />
                    </Link>
                  </td>
                  <td className="num">
                    ${price(c.price)}
                    <small
                      className={
                        c.chg_1d > 0 ? "up" : c.chg_1d < 0 ? "down" : ""
                      }
                    >
                      {chg(c.chg_1d)}
                    </small>
                  </td>
                  <td>
                    <MarketTrace
                      values={c.spark_1d}
                      times={c.spark_times_1d}
                      label={`${c.und} daily closes`}
                    />
                  </td>
                  <td>
                    {c.align ? (
                      <Reading alignment={c.align} kind="engine" />
                    ) : (
                      <>
                        <Signal s={c.signal_1d} />
                        <small>
                          {c.signal_1d
                            ? REGIME[c.regime_1d]
                            : STATUS_NAMES[c.engine_status_1d] || "Unavailable"}
                        </small>
                      </>
                    )}
                  </td>
                  {details || view === "perps" ? (
                    <>
                      <td className="num">
                        {c.signal_1d && Number.isFinite(c.z_1d)
                          ? `${c.z_1d.toFixed(2)}σ`
                          : "—"}
                        <Info>
                          Daily price extension in standard deviations from the
                          engine's trend baseline. Positive is above trend;
                          negative is below. It is not a price target.
                        </Info>
                      </td>
                      <td className="num">
                        {c.signal_1d ? (c.heat_1d ?? "—") : "—"}
                        <Info>
                          Daily heat runs from 0 to 100 and measures extension
                          from the engine's longer-term base.
                        </Info>
                      </td>
                      <td className="num">{usd(c.oi_usd)}</td>
                      <td className="num">{pct(c.funding_ann)}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        <Reading
                          alignment={c.align}
                          horizon={horizon}
                          kind="options"
                        />
                      </td>
                      <td>
                        <Reading
                          alignment={c.align}
                          horizon={horizon}
                          kind="wallets"
                        />
                      </td>
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
                setView("options");
              }}
            >
              Show options markets
            </button>
          </div>
        )}
        <div className="board-foot">
          <span>Open any part of a row to inspect the market.</span>
          <span>
            Price engine, option prices and wallet exposure remain separate.
          </span>
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
