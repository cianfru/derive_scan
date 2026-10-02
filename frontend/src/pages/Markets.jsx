import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, pct, usd, title, utc, SIGNAL_RANK, REGIME } from "../lib/format.js";
import { WINDOWS } from "../lib/presentation.js";
import { Signal, Tabs, Loading, Failed, Info } from "../components/ui.jsx";
import { Asset, MarketTrace, Reading } from "../components/MarketVisuals.jsx";
import { ALIGN_INFO } from "../components/Alignment.jsx";

export default function Markets() {
  const { data, error } = useData("markets.json");
  const [q, setQ] = useState("");
  const [view, setView] = useState("options");
  const [horizon, setHorizon] = useState("30d");
  const [details, setDetails] = useState(false);
  const [sort, setSort] = useState(["oi_usd", -1]);
  const rows = useMemo(() => {
    let r = (data?.coins || []).filter(c => c.und.toLowerCase().includes(q.trim().toLowerCase()));
    r = r.filter(c => view === "perps" ? !c.has_options : c.has_options);
    if (view === "entries") r = r.filter(c => (SIGNAL_RANK[c.unified] ?? 0) >= 3);
    return [...r].sort((a, b) => {
      const x = a[sort[0]], y = b[sort[0]];
      if (x == null && y == null) return a.und.localeCompare(b.und);
      if (x == null) return 1; if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * sort[1] || a.und.localeCompare(b.und);
    });
  }, [data, q, view, sort]);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const sortHead = (key, name, cls = "") => <th className={cls} aria-sort={sort[0] === key ? sort[1] > 0 ? "ascending" : "descending" : undefined}><button className="sort-button" onClick={() => setSort(([k, d]) => [key, k === key ? -d : -1])}>{name}<span aria-hidden="true">{sort[0] === key ? sort[1] > 0 ? "↑" : "↓" : "↕"}</span></button></th>;
  const ctx = data.context || {};
  return <div className="wrap page markets-page">
    <div className="page-heading"><div><h1>Markets</h1><p className="sub">Find a market. Follow the evidence.</p></div><Link className="btn" to="/radar">Explore radar</Link></div>
    <div className="market-context">
      <div><span>4H market consensus <Info>Ready engine readings only. Eligible assets: {data.consensus_detail?.["4h"]?.counts?.total ?? "—"} / {data.consensus_detail?.["4h"]?.counts?.universe ?? "—"}.</Info></span><b>{title(data.consensus?.["4h"])}</b></div>
      <div><span>Fear & greed</span><b>{ctx.sentiment?.fear_greed_value ?? "—"}<small> / 100</small></b></div>
      <div><span>BTC dominance</span><b>{ctx.global_metrics?.btc_dominance == null ? "—" : `${ctx.global_metrics.btc_dominance.toFixed(1)}%`}</b></div>
      <div className="context-time"><span>Snapshot published</span><b>{utc(data.generated_at)}</b></div>
    </div>
    <section className="market-board" aria-label="Market readings">
      <div className="board-toolbar"><Tabs label="Market filter" value={view} onChange={setView} items={[["options", "Options markets"], ["entries", "Engine entries"], ["perps", "Perps only"]]} /><label className="search-box"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input className="search" placeholder="Find a market" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a market" /></label></div>
      <div className="board-controls"><span>{rows.length} markets <Info>{ALIGN_INFO}</Info></span><div>{view !== "perps" && !details && <Tabs label="Reading window" value={horizon} onChange={setHorizon} items={[["7d", "Shorter view"], ["30d", "Broader view"]]} />}<button className="text-control" aria-pressed={details} onClick={() => setDetails(v => !v)}>{details ? "Show overview" : "Show details"}</button></div></div>
      <div className="table-wrap"><table className="grid market-grid"><thead><tr>
        {sortHead("und", "Market")}{sortHead("price", "Index price", "num")}{sortHead("chg_24h", "24h", "num")}
        <th>Recent closes <Info>Up to 42 closed 4H bars, approximately one week. Each trace uses its own vertical scale. Dashed line: first shown close.</Info></th>
        {details || view === "perps" ? <><th>4H engine</th><th>1D engine</th><th>Engine 4H + 1D <Info>Combines the two engine timeframes only. Options and wallets do not affect it.</Info></th>{sortHead("oi_usd", "Perp open interest", "num")}{sortHead("funding_ann", "Funding / year", "num")}<th>1D regime</th>{sortHead("heat_4h", "4H heat", "num")}{sortHead("atm_iv_30d", "IV 30d", "num")}</> : <>{["engine", "options", "wallets"].map(k => <th key={k}>{k === "engine" ? "Engine" : k === "options" ? "Option prices" : "Smart wallets"}<small>{WINDOWS[horizon][k]}</small></th>)}</>}
      </tr></thead><tbody>{rows.map(c => <tr key={c.und}>
        <td><Link className="asset-link" to={`/coin/${c.und}`}><Asset und={c.und} /></Link></td><td className="num">${price(c.price)}</td><td className={`num ${c.chg_24h > 0 ? "up" : c.chg_24h < 0 ? "down" : ""}`}>{chg(c.chg_24h)}</td><td><MarketTrace values={c.spark} label={`${c.und} recent 4H closes`} /></td>
        {details || view === "perps" ? <><td><Signal s={c.signal_4h} /></td><td><Signal s={c.signal_1d} /></td><td><Signal s={c.unified} /></td><td className="num">{usd(c.oi_usd)}</td><td className="num">{pct(c.funding_ann)}</td><td>{REGIME[c.regime_1d] || "Unavailable"}</td><td className="num">{c.heat_4h ?? "—"}</td><td className="num">{pct(c.atm_iv_30d)}</td></> : <>{["engine", "options", "wallets"].map(k => <td key={k}><Reading alignment={c.align} horizon={horizon} kind={k} /></td>)}</>}
      </tr>)}</tbody></table></div>
      {!rows.length && <div className="empty-state"><h3>No markets match this view</h3><p>Try another symbol or switch the market filter.</p><button className="btn" onClick={() => {setQ(""); setView("options");}}>Show options markets</button></div>}
      <div className="board-foot"><span>Open a market name for charts, conditions and source details.</span><span>Three perspectives, no blended trade score.</span></div>
    </section>
    <p className="status">Engine closes: 4H {data.bars?.["4h"] ? utc(data.bars["4h"]) : "unavailable"}; 1D {data.bars?.["1d"] ? utc(data.bars["1d"]) : "unavailable"}.</p>
  </div>;
}
