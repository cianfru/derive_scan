import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, pct, usd, z, title, dayTime, clock, SIGNAL_RANK, REGIME } from "../lib/format.js";
import { openMarketRow } from "../lib/explain.js";
import { Tabs, Loading, Failed, Info, PageHead, Empty, Lead } from "../components/ui.jsx";
import { marketsLead } from "../lib/takeaway.js";
import { Asset, MarketTrace } from "../components/MarketVisuals.jsx";
import { EnginePair, Convergence, CONVERGENCE_HELP } from "../components/EngineComparison.jsx";
import { currentEngine } from "../lib/research.js";
import StructureBand, { isSignal } from "../components/StructureBand.jsx";
import { ChainLegend, LayerIcon, LayerTile, chainAgreed, chainReadings } from "../components/Chain.jsx";

const SCOPE = { options: "options markets", entries: "daily entries", perps: "perps only" };
const inView = (c, view) => (view === "perps" ? !c.has_options : c.has_options) && (view !== "entries" || (SIGNAL_RANK[c.signal_1d] ?? 0) >= 3);
/** The markets a view holds that have a current daily engine: what the band counts, before search and the signal filter. */
const scopeOf = (coins, view) => (coins || []).filter((c) => inView(c, view) && currentEngine(c.engine_comparison?.["1d"]));

// How far the wallets and options layers agree with the engine for one window (engine first).
function agreement(c, horizon) {
  const states = chainReadings(c.align, horizon).map((x) => x.state);
  const dir = states[0];
  if (!dir || dir === "neutral") return null;
  return states.slice(1).reduce((n, s) => n + (s === dir ? 1 : s && s !== "neutral" ? -1 : 0), 0);
}

const BOARD_HELP = "Each market is read in three steps, always in this order: 1 Regime (the daily engine), 2 Wallets (what Derive's best options traders hold on expiries in the window), 3 Options (what option prices lean towards). Wallets and Options are shown for the next 7 and 30 days; an orange frame means all three point the same way for that window: context side by side, not a combined signal. Hover any tile for what it reads. Price is the latest options index where available; the daily change compares the two latest completed UTC days.";

export default function Markets() {
  const { data, error } = useData("markets.json");
  const nav = useNavigate();
  const [q, setQ] = useState(""),
    [signalFilter, setSignalFilter] = useState(null),
    [view, setView] = useState("options"),
    [details, setDetails] = useState(false),
    [sort, setSort] = useState(["a7", -1]);
  const scoped = useMemo(() => scopeOf(data?.coins, view), [data, view]);
  const rows = useMemo(() => {
    let r = (data?.coins || []).filter((c) => inView(c, view) && c.und.toLowerCase().includes(q.trim().toLowerCase()));
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
  const overview = !details && view !== "perps";
  // A view change keeps the signal filter only while the new view still holds that signal.
  const changeView = (next) => {
    setView(next);
    if (signalFilter && !scopeOf(data.coins, next).some((c) => isSignal(c, signalFilter))) setSignalFilter(null);
  };

  return (
    <div className="wrap page markets-page">
      <PageHead error={error} title="Markets"
        meta={<>Daily close {data.bars?.["1d"] ? dayTime(data.bars["1d"]) : "—"} · snapshot {clock(data.generated_at)}</>} />
      <Lead lead={marketsLead(data)} />
      <div className="markets-layout">
        <StructureBand data={data} scoped={scoped} scopeLabel={SCOPE[view]} signalFilter={signalFilter} onSignal={setSignalFilter} />

        <section className="plate market-board" aria-label="Market readings">
          <div className="board-toolbar">
            <Tabs label="Market filter" value={view} onChange={changeView}
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
          {overview && rows.length > 0 && <div className="board-mini-key"><ChainLegend /></div>}
          {overview && rows.length > 0 && <div className="board-mini-head" aria-hidden="true"><span><LayerIcon kind="wallets" size={13} />Wallets <small>7D · 30D</small></span><span><LayerIcon kind="options" size={13} />Options <small>7D · 30D</small></span></div>}
          <div className={overview ? "board-rows" : "table-wrap"}>
            <table className={`grid market-grid${overview ? " overview" : ""}`}>
              {overview && (
                <colgroup><col style={{ width: "17%" }} /><col className="hide-md" style={{ width: "15%" }} /><col style={{ width: "22%" }} /><col style={{ width: "23%" }} /><col style={{ width: "23%" }} /></colgroup>)}
              <thead>
                {overview && (
                  <tr className="layer-head-row"><th /><th className="hide-md" /><th className="layer-th">Regime</th><th className="layer-th">Wallets</th><th className="layer-th">Options</th></tr>)}
                <tr>
                  {sortHead("und", "Market")}
                  <th className="hide-md">60 days</th>
                  {overview ? (
                    <>
                      <th className="layer-sub">Daily engine</th>
                      <th className="layer-sub"><span>7D</span><span>30D</span></th>
                      <th className="layer-sub"><span>7D</span><span>30D</span></th>
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
                        <td className="regime-td">
                          {currentEngine(c.engine_comparison?.["1d"])
                            ? <LayerTile alignment={c.align} kind="engine" sub={REGIME[c.regime_1d] || title(c.regime_1d)} aligned={!!(chainAgreed(c.align, "7d") || chainAgreed(c.align, "30d"))} />
                            : <Empty label="Short history" />}
                        </td>
                        {["wallets", "options"].map((kind) => (
                          <td key={kind} className={`layer-td ${kind}`}>
                            <div className="layer-pair">
                              {["7d", "30d"].map((h) => <LayerTile key={h} alignment={c.align} kind={kind} horizon={h} tag={h.toUpperCase()} aligned={!!chainAgreed(c.align, h)} />)}
                            </div>
                          </td>))}
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
