import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, pct, usd, z, title, dayTime, clock, SIGNAL_RANK, SIGNAL_LABEL, signalTone, REGIME } from "../lib/format.js";
import { openMarketRow } from "../lib/explain.js";
import { Signal, Tabs, Loading, Failed, Info, PanelHead, PageHead, Empty } from "../components/ui.jsx";
import { Asset, MarketTrace } from "../components/MarketVisuals.jsx";
import { EnginePair, Convergence, CONVERGENCE_HELP } from "../components/EngineComparison.jsx";
import { currentEngine } from "../lib/research.js";
import FearGreed from "../components/FearGreed.jsx";
import { ChainMini, ChainLegend, chainReadings } from "../components/Chain.jsx";

const LADDER = ["STRONG_LONG", "LIGHT_LONG", "ACCUMULATE", "WAIT", "TRIM", "RISK_OFF"];
const isSignal = (c, s) => (s === "TRIM" ? ["TRIM", "TRIM_HARD"].includes(c.signal_1d) : c.signal_1d === s);

// How far the wallets and options layers agree with the engine for one window (engine first).
function agreement(c, horizon) {
  const states = chainReadings(c.align, horizon).map((x) => x.state);
  const dir = states[0];
  if (!dir || dir === "neutral") return null;
  return states.slice(1).reduce((n, s) => n + (s === dir ? 1 : s && s !== "neutral" ? -1 : 0), 0);
}

const BOARD_HELP = "Each market is read in three steps, always in this order: 1 Regime (the daily engine), 2 Wallets (what Derive's best options traders hold on expiries in the window), 3 Options (what option prices lean towards). A framed chain means all three point the same way: context side by side, not a combined signal. Price is the latest options index where available; the daily change compares the two latest completed UTC days.";

export default function Markets() {
  const { data, error } = useData("markets.json");
  const nav = useNavigate();
  const [q, setQ] = useState(""),
    [signalFilter, setSignalFilter] = useState(null),
    [view, setView] = useState("options"),
    [details, setDetails] = useState(false),
    [sort, setSort] = useState(["a7", -1]);
  const rows = useMemo(() => {
    let r = (data?.coins || []).filter((c) => c.und.toLowerCase().includes(q.trim().toLowerCase()));
    r = r.filter((c) => (view === "perps" ? !c.has_options : c.has_options));
    if (view === "entries") r = r.filter((c) => (SIGNAL_RANK[c.signal_1d] ?? 0) >= 3);
    if (signalFilter) r = r.filter((c) => currentEngine(c.engine_comparison?.["1d"]) && isSignal(c, signalFilter));
    const key = (c) => (sort[0] === "a7" ? agreement(c, "7d") : sort[0] === "a30" ? agreement(c, "30d") : c[sort[0]]);
    return [...r].sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return (b.align?.score ?? -9) - (a.align?.score ?? -9) || a.und.localeCompare(b.und);
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * sort[1] || (b.align?.score ?? -9) - (a.align?.score ?? -9) || a.und.localeCompare(b.und);
    });
  }, [data, q, view, sort, signalFilter]);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;

  const sortHead = (key, name, cls = "") => (
    <th className={cls} aria-sort={sort[0] === key ? (sort[1] > 0 ? "ascending" : "descending") : undefined}>
      <button className="sort-button" onClick={() => setSort(([k, d]) => [key, k === key ? -d : -1])}>
        {name}<span aria-hidden="true">{sort[0] === key ? (sort[1] > 0 ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
  const eligible = data.coins.filter((c) => currentEngine(c.engine_comparison?.["1d"]));
  const groups = Object.entries(REGIME)
    .map(([k, name]) => ({ k, name, n: eligible.filter((c) => c.regime_1d === k).length }))
    .filter((g) => g.n);
  const ladder = LADDER.map((s) => ({ s, n: eligible.filter((c) => isSignal(c, s)).length }));
  const most = Math.max(1, ...ladder.map((x) => x.n));
  const zero = ladder.filter((x) => !x.n && signalFilter !== x.s);
  const overview = !details && view !== "perps";
  const consensus = data.consensus_detail?.["1d"]?.status === "unavailable" ? null : data.consensus?.["1d"];

  return (
    <div className="wrap page markets-page">
      <PageHead title="Markets"
        meta={<>Daily close {data.bars?.["1d"] ? dayTime(data.bars["1d"]) : "—"} · snapshot {clock(data.generated_at)}</>} />
      <div className="markets-layout">
        <section className="plate market-structure" aria-label="Daily market structure">
          <PanelHead title="Daily market structure" />
          <div className="structure-body">
            <div className="structure-title">
              <strong>{consensus ? title(consensus) : <Empty />}</strong>
              <span>{eligible.length}/{data.coins.length}</span>
            </div>
            <div className="regime-distribution" aria-label="Daily regime distribution">
              {groups.map((g) => <span key={g.k} className={`regime-segment regime-${g.k}`} style={{ flex: g.n }} title={`${g.name}: ${g.n} markets`} />)}
            </div>
            <div className="regime-key">
              {groups.map((g) => <span key={g.k}><i className={`regime-${g.k}`} />{g.name}<b>{g.n}</b></span>)}
            </div>
            <div className="signal-ladder" role="group" aria-label="Filter by daily signal">
              {ladder.filter((x) => x.n || signalFilter === x.s).map(({ s, n }) => (
                <button key={s} className={`ladder-row ${signalTone(s)}`} aria-pressed={signalFilter === s}
                  onClick={() => setSignalFilter(signalFilter === s ? null : s)}>
                  <span className="ladder-label">{SIGNAL_LABEL[s]}</span>
                  <span className="ladder-bar" aria-hidden="true"><i style={{ width: `${(n / most) * 100}%` }} /></span>
                  <b>{n}</b>
                </button>))}
              {zero.length > 0 && (
                <div className="ladder-row ladder-zero" title={zero.map((x) => SIGNAL_LABEL[x.s]).join(", ")}>
                  <span className="ladder-label">{zero.length} others</span><span className="ladder-bar" /><b>0</b>
                </div>)}
            </div>
          </div>
          <FearGreed sentiment={data.context?.sentiment} at={data.context?.sentiment_at} />
        </section>

        <section className="plate market-board" aria-label="Market readings">
          <div className="board-toolbar">
            <Tabs label="Market filter" value={view} onChange={setView}
              items={[["options", "Options markets", "Options"], ["entries", "Daily entries", "Entries"], ["perps", "Perps only", "Perps"]]} />
            <span className="board-count">
              <span className="mono">{rows.length}</span> markets
              <Info label="How to read the board">{overview ? BOARD_HELP : <>{BOARD_HELP} {CONVERGENCE_HELP}</>}</Info>
            </span>
            {view !== "perps" && (
              <button className="text-control" aria-pressed={details} onClick={() => setDetails((v) => !v)}>
                {details ? "Overview" : <><span className="t-long">More measurements</span><span className="t-short">More</span></>}
              </button>)}
            <label className="search-box">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
              <input className="search" placeholder="Find" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a market" />
            </label>
          </div>
          {overview && rows.length > 0 && <div className="board-mini-head" aria-hidden="true"><span /><span>7D</span><span>30D</span></div>}
          <div className={overview ? "board-rows" : "table-wrap"}>
            <table className={`grid market-grid${overview ? " overview" : ""}`}>
              {overview && (
                <colgroup><col style={{ width: "22%" }} /><col className="hide-md" style={{ width: "16%" }} /><col style={{ width: "18%" }} /><col style={{ width: "22%" }} /><col style={{ width: "22%" }} /></colgroup>)}
              <thead>
                {overview && (
                  <tr className="legend-row"><th /><th className="hide-md" /><th /><th colSpan={2} className="legend-th"><ChainLegend /></th></tr>)}
                <tr>
                  {sortHead("und", "Market")}
                  <th className="hide-md">60D</th>
                  {overview ? (
                    <>
                      <th>Regime</th>
                      {sortHead("a7", "7D", "chain-th")}
                      {sortHead("a30", "30D", "chain-th")}
                    </>
                  ) : (
                    <>
                      <th>Engine pair · 1D / 4H</th>
                      <th>Convergence</th>
                      {sortHead("z_1d", "Daily stretch", "num")}
                      {sortHead("heat_1d", "Daily heat", "num")}
                      {sortHead("oi_usd", "Perp OI", "num")}
                      {sortHead("funding_ann", "Funding / year", "num")}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.und} tabIndex={0} aria-label={`Open ${c.und} market`}
                    onClick={(e) => openMarketRow(e, nav, c.und)} onKeyDown={(e) => openMarketRow(e, nav, c.und)}>
                    <td className="market-td">
                      <div className="market-cell">
                        <Link className="asset-link" to={`/coin/${c.und}`}><Asset und={c.und} compact /></Link>
                        <span className="market-price">${price(c.price)}<small className={c.chg_1d > 0 ? "up" : c.chg_1d < 0 ? "down" : "dim"}>{chg(c.chg_1d)}</small></span>
                      </div>
                    </td>
                    <td className="hide-md trace-td">
                      <MarketTrace values={c.spark_1d} times={c.spark_times_1d} label={`${c.und} daily closes`} />
                    </td>
                    {overview ? (
                      <>
                        <td className="regime-td two-line">
                          {currentEngine(c.engine_comparison?.["1d"])
                            ? <div className="regime-cell"><Signal s={c.signal_1d} explain={false} /><small>{REGIME[c.regime_1d] || title(c.regime_1d)}</small></div>
                            : <Empty label="Short history" />}
                        </td>
                        <td className="chain-td"><ChainMini alignment={c.align} horizon="7d" /></td>
                        <td className="chain-td"><ChainMini alignment={c.align} horizon="30d" /></td>
                      </>
                    ) : (
                      <>
                        <td><EnginePair comparison={c.engine_comparison} compact explain={false} /></td>
                        <td><Convergence comparison={c.engine_comparison} compact explain={false} /></td>
                        <td className="num">{c.signal_1d ? z(c.z_1d) : <Empty />}</td>
                        <td className="num">{c.signal_1d && c.heat_1d != null ? c.heat_1d : <Empty />}</td>
                        <td className="num">{usd(c.oi_usd)}</td>
                        <td className="num">{pct(c.funding_ann)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <div className="empty-state">
              <Empty label="No markets in this view" />
              <button className="text-control" onClick={() => { setQ(""); setSignalFilter(null); setView("options"); }}>Reset filters</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
