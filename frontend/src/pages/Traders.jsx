import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, pct } from "../lib/format.js";
import { TYPE_INFO } from "../lib/traders.js";
import { Plate, Tabs, Loading, Failed, PageHead, Lead, Arrow } from "../components/ui.jsx";
import { tradersLead } from "../lib/takeaway.js";
import WalletTag from "../components/WalletTag.jsx";
import LeanBar from "../components/LeanBar.jsx";
import HistoryStatus, { coverageReady, GapNote } from "../components/HistoryStatus.jsx";
import { codename } from "../lib/walletName.js";
import PosseName from "../components/PosseName.jsx";
import "../research-refinement.css";

const PAGE_HELP = `Options traders on Derive, ranked by gross results on expired options, before fees. Market makers are left out. ${TYPE_INFO}`;
const BOARD_HELP = "Gross options PnL counts expired options: premium received minus premium paid plus settlement value, before fees, across the collected history. Ranks remain the published gross-options-PnL rank when the list is sorted by another metric. Win rate: share of expired instruments with positive gross PnL; it ignores win and loss size. Premium traded: option premium bought and sold, before netting; it sets the size posse. Book: net dollar delta of reconstructed unexpired options, valued on the newest chain; long delta gains from a small price rise, short delta from a fall; perp hedges excluded. Up to 200 wallets are published.";
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
  const [kind, setKind] = useState("all");
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("option_pnl");
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  if (!coverageReady(data)) return (
    <div className="wrap page"><PageHead error={error} title="Traders" /><HistoryStatus data={data} /></div>);
  const search = query.trim().toLowerCase();
  const sortValue = (t) => sort === "last" ? t.last || null : sort === "book" ? (t.lean?.score != null ? t.lean.net_delta_usd : null) : t[sort];
  const list = data.traders.filter((t) => (kind === "all" || t.class === kind)
    && `${t.address} ${t.name || ""} ${codename(t.address)}`.toLowerCase().includes(search))
    .sort((a, b) => {
      const x = sortValue(a), y = sortValue(b);
      if (x == null && y == null) return a.rank - b.rank;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? -1 : x < y ? 1 : 0) || a.rank - b.rank;
    });
  const shown = all ? list : list.slice(0, 50);
  const tieredCount = data.traders.filter(tiered).length;
  return (
    <div className="wrap page people-page">
      <PageHead error={error} title="Traders" info={PAGE_HELP}
        meta={<>{data.ranked_total?.toLocaleString("en-US") ?? "—"} ranked · {tieredCount} Top and Smart · history to {data.through}</>} />
      <Lead lead={tradersLead(data)} />
      <Plate title="Leaderboard" info={BOARD_HELP} className="lead-plate"
        right={<Tabs label="Type" value={kind} onChange={(k) => { setKind(k); setAll(false); }} items={[["all", "All"], ["directional", "Directional"], ["income", "Income"], ["hedger", "Hedger"]]} />}
        bodyClass="lb-body">
        <div className="lb-controls">
          <label className="lb-find"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
            <input aria-label="Find a trader" placeholder="Name or wallet address" value={query} onChange={(e) => { setQuery(e.target.value); setAll(false); }} />
          </label>
          <label className="lb-sort">Sort
            <select aria-label="Sort traders" value={sort} onChange={(e) => { setSort(e.target.value); setAll(false); }}>
              <option value="option_pnl">Gross options PnL</option><option value="win_rate">Win rate</option>
              <option value="premium_traded">Premium traded</option><option value="book">Book delta</option><option value="last">Last trade</option>
            </select>
          </label>
        </div>
        {search && <p className="lb-result-count" role="status">{list.length} {list.length === 1 ? "trader" : "traders"} matching “{query.trim()}”</p>}
        <div className="lb">
          <table className="grid lb-table">
            <thead><tr><th className="num lb-rank" aria-label="Published gross options PnL rank">#</th><th>Trader</th><th className="num">Gross options PnL</th><th>Win rate</th>
              <th className="num">Premium traded</th><th>Book</th><th className="num">Last trade</th></tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.address}>
                  <td className="num lb-rank">{t.rank}</td>
                  <td className="lb-who">
                    <Link className="lb-profile" to={`/trader/${t.address.toLowerCase()}`} aria-label={`Open ${t.name || codename(t.address)} profile`}>
                      <WalletTag address={t.address} name={t.name} size={28} /><Arrow />
                    </Link>
                    <span className="lb-sub">
                      {t.pnl_cohort || t.size_cohort ? [t.pnl_cohort, t.size_cohort].filter(Boolean).map((code, i) => <span key={code}>{i > 0 && " · "}<PosseName code={code} /></span>) : "—"}
                      {tiered(t) && <em className="tier-tag">{t.tier}</em>}
                    </span>
                  </td>
                  <td className={`num hero lb-pnl ${tone(t.option_pnl)}`}><span className="lb-mobile-label">Gross PnL</span>{usd(t.option_pnl)}</td>
                  <td className="lb-win"><WinRate v={t.win_rate} /></td>
                  <td className="num lb-prem">{usd(t.premium_traded)}</td>
                  <td className="lb-book"><Book t={t} /></td>
                  <td className="num lb-last faint">{t.last}</td>
                  <td className="lb-m">
                    <span>{pct(t.win_rate, 0)} win · {usd(t.premium_traded)} traded{tiered(t) && <> · <em className="tier-tag">{t.tier}</em></>}</span>
                    {t.lean?.score != null && <span className="lb-book-label">Book <LeanBar lean={t.lean} width={56} /></span>}
                    <span className="sr-only">Last trade {t.last || "unavailable"}</span>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>
        {!list.length && <p className="empty-state">No traders match these filters.</p>}
        {list.length > shown.length && <button className="btn lb-more" onClick={() => setAll(true)}>Show all {list.length}</button>}
      </Plate>
      <Link className="cohorts-link" to="/traders/posses">
        <span><b>Posses</b><small>Traders grouped by results and by size, and how each group is positioned per coin</small></span>
        <span aria-hidden="true">→</span>
      </Link>
      <p className="status">History to {data.through} UTC · positions valued on the newest options chain<GapNote data={data} /></p>
    </div>
  );
}
