import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, pct } from "../lib/format.js";
import { TYPE, TYPE_INFO, typeOf } from "../lib/traders.js";
import { Plate, Tabs, Loading, Failed, Info } from "../components/ui.jsx";
import WalletTag from "../components/WalletTag.jsx";
import LeanBar from "../components/LeanBar.jsx";
import CohortExplorer from "../components/CohortExplorer.jsx";
import HistoryStatus, { coverageReady } from "../components/HistoryStatus.jsx";

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
        <div className="figs trader-summary" style={{ minWidth: "min(480px, 100%)" }}>
          <div className="fig"><span>Ranked <Info>Wallets that meet the existing minimum trade and expired-option requirements, excluding market makers. Up to 200 are published in the leaderboard.</Info></span><strong>{data.ranked_total?.toLocaleString() ?? "-"}</strong></div>
          <div className="fig"><span>Top and Smart <Info>Number of wallets in the published leaderboard assigned either of the existing profitable directional tiers. These are separate from the results and size cohorts below.</Info></span><strong>{data.traders.filter((t) => t.tier === "top" || t.tier === "smart").length}</strong></div>
          <div className="fig"><span>History to</span><strong style={{ fontSize: 14 }}>{data.through}</strong></div>
        </div>
      </div>
      <CohortExplorer cohorts={data.cohorts} through={data.through} valuedAt={data.generated_at} />
      <Plate title="Leaderboard" info={<>{TYPE_INFO} Gross options PnL counts expired options: premium received minus premium paid plus settlement value, before fees, across the collected history. Win rate: share of expired instruments with positive gross PnL; it ignores win and loss size. Premium traded: option premium bought and sold, before netting; it sets the size cohort. Book: net dollar delta of reconstructed unexpired options, through the displayed UTC close and valued on the newest chain; long delta gains from a small price rise, short delta from a fall; perp hedges excluded.</>}
        right={<Tabs label="Type" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["all", "All"], ["directional", "Directional"], ["income", "Income"], ["hedger", "Hedger"]]} />}
        bodyClass="table-wrap">
        <table className="grid" style={{ minWidth: 900 }}>
          <thead><tr><th>Trader</th><th>Type</th><th className="num">Gross options PnL</th><th className="num">Win rate</th><th className="num">Premium traded</th>
            <th>Results</th><th>Size</th><th>Book</th><th className="num">Last trade</th></tr></thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.address} onClick={() => nav(`/trader/${t.address.toLowerCase()}`)} tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && nav(`/trader/${t.address.toLowerCase()}`)}>
                <td><span className={`rank ${t.rank <= 3 ? "top3" : ""}`}>{t.rank}</span><WalletTag address={t.address} size={28} /></td>
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
