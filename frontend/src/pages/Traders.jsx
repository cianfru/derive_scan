import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, pct } from "../lib/format.js";
import { TYPE_INFO } from "../lib/traders.js";
import { Plate, Tabs, Loading, Failed, PageHead } from "../components/ui.jsx";
import WalletTag from "../components/WalletTag.jsx";
import LeanBar from "../components/LeanBar.jsx";
import CohortExplorer from "../components/CohortExplorer.jsx";
import HistoryStatus, { coverageReady } from "../components/HistoryStatus.jsx";

const PAGE_HELP = `Options traders on Derive, ranked by gross results on expired options, before fees. Market makers are left out. ${TYPE_INFO}`;
const BOARD_HELP = "Gross options PnL counts expired options: premium received minus premium paid plus settlement value, before fees, across the collected history. Win rate: share of expired instruments with positive gross PnL; it ignores win and loss size. Premium traded: option premium bought and sold, before netting; it sets the size cohort. Book: net dollar delta of reconstructed unexpired options, valued on the newest chain; long delta gains from a small price rise, short delta from a fall; perp hedges excluded. Up to 200 wallets are published.";
const tiered = (t) => t.tier === "top" || t.tier === "smart";
const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");

function WinRate({ v }) {
  if (v == null) return <span className="empty-dash">—</span>;
  return (
    <span className="lb-wr">
      <span>{pct(v, 0)}</span>
      <i aria-hidden="true"><b style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></i>
    </span>
  );
}

function Book({ t }) {
  return t.lean?.score != null ? <LeanBar lean={t.lean} width={56} /> : <span className="faint">—</span>;
}

export default function Traders() {
  const { data, error } = useData("traders.json", 5 * 60_000);
  const nav = useNavigate();
  const [kind, setKind] = useState("all");
  const [all, setAll] = useState(false);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  if (!coverageReady(data)) return (
    <div className="wrap page"><PageHead title="Traders" /><HistoryStatus data={data} /></div>);
  const list = data.traders.filter((t) => kind === "all" || t.class === kind);
  const shown = all ? list : list.slice(0, 50);
  const tieredCount = data.traders.filter(tiered).length;
  const open = (t) => nav(`/trader/${t.address.toLowerCase()}`);
  return (
    <div className="wrap page people-page">
      <PageHead title="Traders" info={PAGE_HELP}
        meta={<>{data.ranked_total?.toLocaleString("en-US") ?? "—"} ranked · {tieredCount} Top and Smart · history to {data.through}</>} />
      <Plate title="Leaderboard" info={BOARD_HELP} className="lead-plate"
        right={<Tabs label="Type" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["all", "All"], ["directional", "Directional"], ["income", "Income"], ["hedger", "Hedger"]]} />}
        bodyClass="lb-body">
        <div className="lb">
          <table className="grid lb-table">
            <thead><tr><th className="num lb-rank">#</th><th>Trader</th><th className="num">Gross options PnL</th><th>Win rate</th>
              <th className="num">Premium traded</th><th>Book</th><th className="num">Last trade</th></tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.address} onClick={() => open(t)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(t)}>
                  <td className="num lb-rank">{t.rank}</td>
                  <td className="lb-who">
                    <WalletTag address={t.address} size={28} />
                    <span className="lb-sub">
                      {[t.pnl_cohort, t.size_cohort].filter(Boolean).join(" · ") || "—"}
                      {tiered(t) && <em className="tier-tag">{t.tier}</em>}
                    </span>
                  </td>
                  <td className={`num hero lb-pnl ${tone(t.option_pnl)}`}>{usd(t.option_pnl)}</td>
                  <td className="lb-win"><WinRate v={t.win_rate} /></td>
                  <td className="num lb-prem">{usd(t.premium_traded)}</td>
                  <td className="lb-book"><Book t={t} /></td>
                  <td className="num lb-last faint">{t.last}</td>
                  <td className="lb-m" aria-hidden="true">
                    <span>{pct(t.win_rate, 0)} win · {usd(t.premium_traded)} traded{tiered(t) && <> · <em className="tier-tag">{t.tier}</em></>}</span>
                    {t.lean?.score != null && <LeanBar lean={t.lean} width={56} />}
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>
        {list.length > shown.length && <button className="btn lb-more" onClick={() => setAll(true)}>Show all {list.length}</button>}
      </Plate>
      <CohortExplorer cohorts={data.cohorts} through={data.through} valuedAt={data.generated_at} />
      <p className="status">History to {data.through} UTC · positions valued on the newest options chain</p>
    </div>
  );
}
