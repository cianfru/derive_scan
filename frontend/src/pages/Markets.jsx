import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, pct, usd, title, ago, utc, SIGNAL_RANK, REGIME, DATA_LABEL } from "../lib/format.js";
import { Signal, Tabs, Plate, Spark, Loading, Failed, Info } from "../components/ui.jsx";

const COLS = [
  ["und", "Perp", (c) => c.und],
  ["price", "Price", (c) => c.price, "num"],
  ["chg_24h", "24h", (c) => c.chg_24h, "num"],
  ["spark", "7 days", null],
  ["signal_4h", "4H", (c) => SIGNAL_RANK[c.signal_4h] ?? -1],
  ["signal_1d", "1D", (c) => SIGNAL_RANK[c.signal_1d] ?? -1],
  ["unified", "Combined", (c) => SIGNAL_RANK[c.unified] ?? -1],
  ["regime_1d", "Regime 1D", (c) => c.regime_1d],
  ["heat_4h", "Heat", (c) => c.heat_4h, "num"],
  ["funding_ann", "Funding", (c) => c.funding_ann, "num"],
  ["oi_usd", "Open interest", (c) => c.oi_usd, "num"],
  ["atm_iv_30d", "IV 30d", (c) => c.atm_iv_30d ?? -1, "num"],
  ["data", "Data", (c) => c.data_1d],
];

export default function Markets() {
  const { data, error } = useData("markets.json");
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [view, setView] = useState("all");
  const [sort, setSort] = useState(["oi_usd", -1]);
  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.coins.filter((c) => c.und.toLowerCase().includes(q.trim().toLowerCase()));
    if (view === "options") r = r.filter((c) => c.has_options);
    if (view === "entries") r = r.filter((c) => (SIGNAL_RANK[c.unified] ?? 0) >= 3);
    const col = COLS.find((c) => c[0] === sort[0]);
    return [...r].sort((a, b) => {
      const x = col[2](a), y = col[2](b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * sort[1];
    });
  }, [data, q, view, sort]);

  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const ctx = data.context || {};
  return (
    <div className="wrap page">
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1>Markets</h1>
          <p className="sub">Every Derive perp, read by the signal engine after each 4H and daily close.</p>
        </div>
        <div className="figs" style={{ minWidth: "min(560px, 100%)" }}>
          <div className="fig"><span>Consensus 4H</span><strong style={{ fontSize: 16 }}>{title(data.consensus?.["4h"])}</strong></div>
          <div className="fig"><span>Fear and Greed</span><strong>{ctx.sentiment?.fear_greed_value ?? "-"}</strong></div>
          <div className="fig"><span>BTC dominance</span><strong>{ctx.global_metrics?.btc_dominance?.toFixed(1) ?? "-"}%</strong></div>
          <div className="fig"><span>Updated</span><strong style={{ fontSize: 14 }}>{ago(data.generated_at)}</strong></div>
        </div>
      </div>
      <Plate
        title="All perps"
        info={<>Signals come from the engine on Derive's index price. 4H and 1D are each timeframe's signal; Combined joins both. Heat is distance from the long-term base, 0 to 100. Funding is annualised. Coins with little history on Derive show earlier bars from an external market, marked on their page.</>}
        right={<div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <Tabs label="Filter" value={view} onChange={setView} items={[["all", "All"], ["entries", "Entries"], ["options", "With options"]]} />
          <input className="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search perps" />
        </div>}
        bodyClass="table-wrap">
        <table className="grid">
          <thead><tr>{COLS.map(([k, label, get, cls]) => (
            <th key={k} className={`${cls || ""} ${get ? "sortable" : ""} ${sort[0] === k ? "sorted" : ""}`}
              onClick={() => get && setSort(([sk, d]) => [k, sk === k ? -d : -1])}
              aria-sort={sort[0] === k ? (sort[1] > 0 ? "ascending" : "descending") : undefined}>
              {label}{sort[0] === k ? (sort[1] > 0 ? " ▲" : " ▼") : ""}</th>))}</tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.und} className={c.data_4h === "not enough data" ? "dim" : ""} onClick={() => nav(`/coin/${c.und}`)}
                tabIndex={0} onKeyDown={(e) => e.key === "Enter" && nav(`/coin/${c.und}`)}>
                <td className="coin">{c.und}<small>{c.has_options ? "Perp · options" : "Perp"}</small></td>
                <td className="num">{price(c.price)}</td>
                <td className={`num ${c.chg_24h > 0 ? "up" : c.chg_24h < 0 ? "down" : ""}`}>{chg(c.chg_24h)}</td>
                <td><Spark values={c.spark} /></td>
                <td><Signal s={c.signal_4h} /></td>
                <td><Signal s={c.signal_1d} /></td>
                <td><Signal s={c.unified} /></td>
                <td>{REGIME[c.regime_1d] || title(c.regime_1d)}</td>
                <td className="num"><span className="meter"><i><b style={{ left: 0, width: `${Math.min(100, c.heat_4h || 0)}%` }} /></i>{c.heat_4h ?? "-"}</span></td>
                <td className={`num ${c.funding_ann < 0 ? "down" : ""}`}>{pct(c.funding_ann, 1)}</td>
                <td className="num">{usd(c.oi_usd)}</td>
                <td className="num">{c.atm_iv_30d ? pct(c.atm_iv_30d, 1) : <span className="faint">-</span>}</td>
                <td><span className={`status ${c.data_1d === "ready" && c.volume_status !== "thin" ? "" : "warn"}`}>
                  {c.data_1d !== "ready" ? DATA_LABEL[c.data_1d] || "-" : c.volume_status === "thin" ? "Thin volume" : "Ready"}</span></td>
              </tr>))}
          </tbody>
        </table>
      </Plate>
      <p className="status">Signal bars: 4H {data.bars?.["4h"] ? utc(data.bars["4h"]) : "-"} · 1D {data.bars?.["1d"] ? utc(data.bars["1d"]) : "-"}</p>
    </div>
  );
}
