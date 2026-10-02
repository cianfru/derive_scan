import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, pct } from "../lib/format.js";
import { TYPE, TYPE_INFO, typeOf } from "../lib/traders.js";
import { Plate, Tabs, Loading, Failed, Info } from "../components/ui.jsx";
import WalletTag from "../components/WalletTag.jsx";
import LeanBar from "../components/LeanBar.jsx";
import HistoryStatus, { coverageReady } from "../components/HistoryStatus.jsx";

const COHORT_INFO = {
  pnl: "Options traders grouped by their results on options that have expired, from Money Printer (over $1M) to Giga-Rekt (over $1M lost). Each cell is the net delta of the cohort's open options on that coin: right and green when their positions gain from a rise, left and red when they gain from a fall. Market makers are left out.",
  size: "Options traders grouped by the premium they have traded, from Leviathan (over $10M) to Shrimp (under $10K). Each cell is the net delta of the cohort's open options on that coin: right and green when their positions gain from a rise, left and red when they gain from a fall. Market makers are left out.",
};

function Cohorts({ cohorts }) {
  const [dim, setDim] = useState("pnl");
  const rows = (cohorts?.[dim] || []).filter((c) => c.wallets > 0);
  return (
    <Plate title="Cohorts" info={COHORT_INFO[dim]} bodyClass="table-wrap"
      right={<Tabs label="Cohorts" value={dim} onChange={setDim} items={[["pnl", "By results"], ["size", "By size"]]} />}>
      <table className="grid cohort-grid" style={{ minWidth: 640 }}>
        <thead><tr><th>Cohort</th><th className="num">Wallets</th><th>BTC</th><th>ETH</th><th>Other coins</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.name} style={{ cursor: "default" }}>
              <td style={{ fontWeight: 600 }}>{c.name}</td>
              <td className="num">{c.wallets}</td>
              {["BTC", "ETH", "Other"].map((u) => <td key={u}>{c.coins[u]?.positions ? <LeanBar lean={c.coins[u]} /> : <span className="faint">No positions</span>}</td>)}
            </tr>))}
        </tbody>
      </table>
    </Plate>
  );
}

export default function Traders() {
  const { data, error } = useData("traders.json", 5 * 60_000);
  const nav = useNavigate();
  const [kind, setKind] = useState("all");
  const [all, setAll] = useState(false);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  if (!coverageReady(data)) return (
    <div className="wrap page"><h1>Traders</h1><HistoryStatus data={data} /></div>);
  const list = data.traders.filter((t) => kind === "all" || (kind === "directional" ? t.class === "directional" : t.class === kind));
  const shown = all ? list : list.slice(0, 50);
  return (
    <div className="wrap page">
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1>Traders</h1>
          <p className="sub">Options traders on Derive, ranked by gross results on expired options, before fees. Market makers left out.</p>
        </div>
        <div className="figs" style={{ minWidth: "min(480px, 100%)" }}>
          <div className="fig"><span>Ranked</span><strong>{data.ranked_total?.toLocaleString() ?? "-"}</strong></div>
          <div className="fig"><span>Top and Smart</span><strong>{data.traders.filter((t) => t.tier === "top" || t.tier === "smart").length}</strong></div>
          <div className="fig"><span>History to</span><strong style={{ fontSize: 14 }}>{data.through}</strong></div>
        </div>
      </div>
      <Cohorts cohorts={data.cohorts} />
      <Plate title="Leaderboard" info={<>{TYPE_INFO} Gross options PnL counts expired options: premium received minus premium paid plus settlement value, before fees. Win rate: share of expired instruments with positive gross PnL. Book: positions reconstructed through the displayed UTC close and valued on the newest chain; subsequent trades are not included.</>}
        right={<Tabs label="Type" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["all", "All"], ["directional", "Directional"], ["income", "Income"], ["hedger", "Hedger"]]} />}
        bodyClass="table-wrap">
        <table className="grid" style={{ minWidth: 900 }}>
          <thead><tr><th>Trader</th><th>Type</th><th className="num">Gross options PnL</th><th className="num">Win rate</th><th className="num">Premium traded</th>
            <th>Results</th><th>Size</th><th>Book</th><th className="num">Last trade</th></tr></thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.address} onClick={() => nav(`/trader/${t.address.toLowerCase()}`)} tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && nav(`/trader/${t.address.toLowerCase()}`)}>
                <td><span className={`rank ${t.rank <= 3 ? "top3" : ""}`}>{t.rank}</span><WalletTag address={t.address} size={22} /></td>
                <td className={t.tier === "top" || t.tier === "smart" ? "orange" : "dim"}>{TYPE[typeOf(t)]}</td>
                <td className={`num ${t.option_pnl > 0 ? "up" : t.option_pnl < 0 ? "down" : ""}`}>{usd(t.option_pnl)}</td>
                <td className="num">{pct(t.win_rate, 0)}</td>
                <td className="num">{usd(t.premium_traded)}</td>
                <td className="dim">{t.pnl_cohort || "-"}</td>
                <td className="dim">{t.size_cohort || "-"}</td>
                <td>{t.open_count ? <LeanBar lean={t.lean} width={56} /> : <span className="faint">No unexpired positions</span>}</td>
                <td className="num dim">{t.last}</td>
              </tr>))}
          </tbody>
        </table>
        {list.length > shown.length && <button className="btn" style={{ marginTop: 12 }} onClick={() => setAll(true)}>Show all {list.length}</button>}
      </Plate>
      <p className="status">History to {data.through} UTC · positions valued on the newest options chain</p>
    </div>
  );
}
