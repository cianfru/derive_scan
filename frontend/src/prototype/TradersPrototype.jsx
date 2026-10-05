import { useEffect, useMemo, useRef, useState } from "react";
import { usd, pct } from "../lib/format.js";
import { nameIn, shortAddr, viewNames } from "../lib/walletName.js";
import WalletTag from "../components/WalletTag.jsx";
import { coinImage } from "./assets.js";
import "./traders.css";

const GROUPS = {
  "Money Printer": { label: "$1M+ profit", detail: "At least $1M gross profit on expired options", order: 0 },
  "Smart Money": { label: "$100K–$1M profit", detail: "$100K to less than $1M gross profit on expired options", order: 1 },
  Grinder: { label: "$10K–$100K profit", detail: "$10K to less than $100K gross profit on expired options", order: 2 },
  "Humble Earner": { label: "$0–$10K profit", detail: "$0 to less than $10K gross profit on expired options", order: 3 },
  "Exit Liquidity": { label: "Up to $10K loss", detail: "More than $0 and up to $10K gross loss on expired options", order: 4 },
  "Semi-Rekt": { label: "$10K–$100K loss", detail: "More than $10K and up to $100K gross loss on expired options", order: 5 },
  "Full Rekt": { label: "$100K–$1M loss", detail: "More than $100K and up to $1M gross loss on expired options", order: 6 },
  "Giga-Rekt": { label: "Over $1M loss", detail: "More than $1M gross loss on expired options", order: 7 },
  Leviathan: { label: "$10M+ traded", detail: "At least $10M option premium traded", order: 0 },
  Whale: { label: "$1M–$10M traded", detail: "$1M to less than $10M option premium traded", order: 1 },
  Dolphin: { label: "$100K–$1M traded", detail: "$100K to less than $1M option premium traded", order: 2 },
  Fish: { label: "$10K–$100K traded", detail: "$10K to less than $100K option premium traded", order: 3 },
  Shrimp: { label: "Under $10K traded", detail: "Less than $10K option premium traded", order: 4 },
};
const TYPES = { directional: "Directional", income: "Income", hedger: "Hedger", occasional: "Occasional" };
const WINDOWS = [["all", "All open options"], ["7d", "Within 7 days"], ["30d", "Within 30 days"], ["beyond30d", "After 30 days"]];
const number = (v) => Number.isFinite(v) ? v.toLocaleString("en-US") : "—";
const tone = (v) => v > 0 ? "tp-positive" : v < 0 ? "tp-negative" : "";
const complete = (b) => Number.isFinite(b?.score) && Number.isFinite(b?.net_delta_usd) && Number.isFinite(b?.gross_delta_usd) && b?.quotes_complete !== false;
const completeTotals = (book) => {
  const coins = Object.values(book?.coins || {}).filter((b) => b.positions > 0);
  const quoted = coins.filter(complete);
  return {
    net: quoted.length ? quoted.reduce((sum, b) => sum + b.net_delta_usd, 0) : null,
    gross: quoted.length ? quoted.reduce((sum, b) => sum + (b.gross_delta_usd || 0), 0) : null,
    positions: book?.total?.positions ?? coins.reduce((sum, b) => sum + b.positions, 0),
    partial: quoted.length < coins.length,
  };
};
const band = (name) => GROUPS[name]?.label || name || "—";
const windowBook = (c, window) => c?.windows?.[window] || (window === "all" && c?.coins ? { coins: c.coins } : null);
const coinBook = (cohort, window, coin) => {
  const book = windowBook(cohort, window);
  return book ? book.coins?.[coin] || { positions: 0 } : null;
};
const date = (stamp) => stamp ? new Date(stamp * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "Unavailable";

function Exposure({ book, small = false, positions }) {
  if (!complete(book)) return <span className="tp-unavailable">{(positions ?? book?.positions) === 0 ? "No open options" : "No reading"}</span>;
  const score = Math.max(-1, Math.min(1, book.score));
  const state = score >= .25 ? "Long delta" : score <= -.25 ? "Short delta" : "Balanced delta";
  return <span className={`tp-exposure ${small ? "tp-exposure-small" : ""} ${tone(Math.abs(score) >= .25 ? score : 0)}`} title={`Net option delta ${usd(book.net_delta_usd)} / gross delta ${usd(book.gross_delta_usd)}`}>
    <span className="tp-delta-track" aria-hidden="true"><i style={{ left: `${50 + Math.min(0, score) * 50}%`, width: `${Math.abs(score) * 50}%` }} /></span>
    <span>{state}<b>{score > 0 ? "+" : ""}{Math.round(score * 100)}%</b></span>
  </span>;
}

function Method({ cohorts = false, payload, cohortName }) {
  return <details className="tp-method">
    <summary>{cohorts ? "How to read this comparison" : "How this leaderboard is ranked"}<span aria-hidden="true">+</span></summary>
    <div>
      {cohorts && cohortName && <p>The {band(cohortName)} group is also called “{cohortName}”.</p>}
      <p>{cohorts ? "Results groups use gross P&L on expired options over the full collected history. Size groups use premium bought and sold before netting. Group membership stays the same when the expiry window changes." : "Rank is gross P&L on expired options: premium received minus premium paid, plus settlement value. Fees, open-option results and perpetuals are outside the rank. Eligible wallets have at least 10 option legs and one expired instrument. The top 200 are published."}</p>
      <p>{cohorts ? "Dollar delta is approximate sensitivity to a small coin-price move. Balance is net delta divided by gross delta; ±25% separates long, short and balanced. Options are reconstructed through the displayed UTC close. Later trades and perp hedges are excluded. Positions count wallet–instrument pairs, not unique traders. Within 30 days includes within 7 days." : "Win rate counts the share of expired option instruments with positive gross P&L, regardless of win or loss size. The instrument count is shown beside it. Directional takes a view; Income mostly sells out-of-the-money options; Hedger offsets options with perps. Top and Smart describe historical profitable directional cohorts, not a recommendation."}</p>
      <p>Market makers are excluded. {payload?.gaps > 0 ? `${number(payload.gaps)} history readings remain unreconciled${payload.gap_days?.length ? ` (${payload.gap_days.join(", ")} UTC)` : ""}; rankings include the trades read so far.` : "Results describe collected history, not returns on account equity."} Context, not a signal.</p>
    </div>
  </details>;
}

function WalletDossier({ trader, names, onClose, payload }) {
  const ref = useRef(null);
  useEffect(() => {
    const modal = ref.current;
    if (!trader || !modal) return;
    const previous = document.activeElement;
    modal.showModal();
    return () => { modal.close(); previous?.focus?.(); };
  }, [trader]);
  if (!trader) return null;
  const coins = Object.entries(trader.coins || {}).sort((a, b) => b[1] - a[1]);
  return <dialog ref={ref} className="tp-dossier" onCancel={onClose} onClick={(event) => event.target === event.currentTarget && onClose()} aria-labelledby="tp-dossier-name">
    <div className="tp-dossier-inner">
      <div className="tp-dossier-top"><span className="tp-overline">Public wallet · rank {trader.rank}</span><button className="tp-close" aria-label="Close trader details" onClick={onClose}>×</button></div>
      <h2 id="tp-dossier-name"><WalletTag address={trader.address} name={nameIn(names, trader.address)} size={44} /></h2>
      <p className="tp-wallet-address">{trader.address}</p>
      <div className="tp-dossier-hero"><span>Gross options P&L</span><b className={tone(trader.option_pnl)}>{usd(trader.option_pnl)}</b><small>Expired options · before fees</small></div>
      <div className="tp-dossier-stats">
        <div><span>Win rate</span><b>{pct(trader.win_rate, 1)}</b><small>{number(trader.expired)} expired instruments</small></div>
        <div><span>Premium traded</span><b>{usd(trader.premium_traded)}</b><small>Buys + sells, before netting</small></div>
        <div><span>Trading style</span><b>{TYPES[trader.class] || trader.class || "Unclassified"}</b><small>{trader.tier === "top" ? "Top historical cohort" : trader.tier === "smart" ? "Smart historical cohort" : "Published classification"}</small></div>
        <div><span>Open option positions</span><b>{number(trader.open_count)}</b><small>Through {payload.through} UTC close</small></div>
      </div>
      <section className="tp-dossier-section"><h3>Published options sensitivity</h3><Exposure book={trader.lean} positions={trader.open_count} /><p>Net delta <b className={tone(trader.lean?.net_delta_usd)}>{usd(trader.lean?.net_delta_usd)}</b> · gross delta <b>{usd(trader.lean?.gross_delta_usd)}</b></p><small>Options only. Perpetual hedges, volatility and time effects are outside this reading.</small></section>
      <section className="tp-dossier-section"><h3>Reported premium by coin</h3>{coins.length ? coins.map(([coin, premium]) => <div className="tp-coin-volume" key={coin}><span>{coin}</span><b>{usd(premium)}</b></div>) : <p>No coin breakdown published.</p>}<small>Up to four coins, ordered by premium traded.</small></section>
      <div className="tp-wallet-dates"><span>First collected trade<b>{trader.first || "—"}</b></span><span>Last trade<b>{trader.last || "—"}</b></span></div>
      <p className="tp-context">A public trading record, not a full portfolio or a reason to copy a trade.</p>
    </div>
  </dialog>;
}

function Leaderboard({ payload }) {
  const [kind, setKind] = useState("all"), [search, setSearch] = useState(""), [sort, setSort] = useState("rank"), [limit, setLimit] = useState(25), [selected, setSelected] = useState(null);
  const traders = payload.traders || [];
  const names = useMemo(() => viewNames(traders.map((t) => t.address)), [traders]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return traders.filter((t) => (kind === "all" || t.class === kind) && (!q || `${nameIn(names, t.address)} ${t.address}`.toLowerCase().includes(q))).sort((a, b) => sort === "premium" ? (b.premium_traded || 0) - (a.premium_traded || 0) : sort === "sample" ? (b.expired || 0) - (a.expired || 0) : sort === "lowpnl" ? a.option_pnl - b.option_pnl : a.rank - b.rank);
  }, [traders, names, kind, search, sort]);
  const changeKind = (v) => { setKind(v); setLimit(25); };
  return <>
    <div className="tp-toolbar">
      <div className="tp-tabs" role="group" aria-label="Trading style">{[["all", "All styles"], ["directional", "Directional"], ["income", "Income"], ["hedger", "Hedger"]].map(([key, label]) => <button key={key} onClick={() => changeKind(key)} aria-pressed={kind === key}>{label}</button>)}</div>
      <div className="tp-table-controls"><label className="tp-search"><span aria-hidden="true">⌕</span><input aria-label="Search traders by name or address" placeholder="Find a trader" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(25); }} /></label><label className="tp-sort"><span>Sort</span><select aria-label="Sort published traders" value={sort} onChange={(event) => setSort(event.target.value)}><option value="rank">Results · highest</option><option value="lowpnl">Results · lowest</option><option value="premium">Premium traded</option><option value="sample">Expired instruments</option></select></label></div>
    </div>
    <section className="tp-board" aria-label="Published options trader leaderboard">
      <div className="tp-board-heading"><h2>Options leaderboard</h2><span>{number(filtered.length)} of {number(traders.length)} published traders</span></div>
      <div className="tp-table-scroll tp-leaderboard-scroll"><table className="tp-table"><thead><tr><th className="tp-rank">Rank</th><th>Trader</th><th className="tp-numeric">Gross options P&L</th><th className="tp-numeric">Win rate / sample</th><th className="tp-numeric">Premium traded</th><th>Options delta</th><th className="tp-last">Last trade</th></tr></thead><tbody>
        {filtered.slice(0, limit).map((t) => <tr key={t.address} onClick={() => setSelected(t)}>
          <td className="tp-rank tp-mono">{t.rank}</td>
          <td className="tp-who"><button className="tp-identity" onClick={() => setSelected(t)} aria-label={`Open ${nameIn(names, t.address)} details`}><WalletTag address={t.address} name={nameIn(names, t.address)} size={30} /><small>{TYPES[t.class] || "Occasional"}<span>{shortAddr(t.address)}</span></small></button></td>
          <td className={`tp-numeric tp-pnl ${tone(t.option_pnl)}`}>{usd(t.option_pnl)}<small>Before fees</small></td>
          <td className="tp-numeric tp-win"><b>{pct(t.win_rate, 1)}</b><small>{number(t.expired)} instruments</small></td>
          <td className="tp-numeric tp-premium">{usd(t.premium_traded)}<small>{Object.keys(t.coins || {}).join(" · ") || "No coin breakdown"}</small></td>
          <td className="tp-book"><Exposure book={t.lean} positions={t.open_count} small /></td>
          <td className="tp-last tp-mono">{t.last || "—"}<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M3 9 9 3M3 3h6v6" fill="none" stroke="currentColor" strokeWidth="1" /></svg></td>
        </tr>)}
      </tbody></table></div>
      <ol className="tp-mobile-list" aria-label="Published trader results">
        {filtered.slice(0, limit).map((t) => <li key={t.address}><button onClick={() => setSelected(t)} aria-label={`Open ${nameIn(names, t.address)} details`}><div className="tp-mobile-row-head"><WalletTag address={t.address} name={nameIn(names, t.address)} size={28} /><span className={`tp-mobile-pnl ${tone(t.option_pnl)}`}>{usd(t.option_pnl)}<small>Gross options P&L</small></span></div><div className="tp-mobile-row-meta"><span>#{t.rank} · {TYPES[t.class] || "Occasional"}</span><span><b>{pct(t.win_rate, 1)}</b> win · {number(t.expired)} expired</span></div></button></li>)}
      </ol>
      {!filtered.length && <div className="tp-empty"><h3>No traders match this view</h3><p>Try another name, address or trading style.</p><button onClick={() => { setSearch(""); changeKind("all"); }}>Clear filters</button></div>}
      {filtered.length > limit && <button className="tp-show-more" onClick={() => setLimit((n) => n + 25)}>Show next {Math.min(25, filtered.length - limit)} traders <span aria-hidden="true">↓</span></button>}
    </section>
    <Method payload={payload} />
    <WalletDossier trader={selected} names={names} payload={payload} onClose={() => setSelected(null)} />
  </>;
}

function Cohorts({ payload, cohorts }) {
  const [dimension, setDimension] = useState("pnl"), [window, setWindow] = useState("all"), [chosen, setChosen] = useState(null), [mobileCoin, setMobileCoin] = useState(null);
  const rows = useMemo(() => (cohorts?.[dimension] || []).filter((c) => c.wallets > 0).sort((a, b) => (GROUPS[a.name]?.order ?? 99) - (GROUPS[b.name]?.order ?? 99)), [cohorts, dimension]);
  const selected = rows.find((c) => c.name === chosen) || rows[0];
  const coins = useMemo(() => {
    const volumes = {};
    for (const row of rows) for (const [coin, b] of Object.entries(windowBook(row, window)?.coins || {})) volumes[coin] = (volumes[coin] || 0) + (b.gross_delta_usd || 0);
    return Object.keys(volumes).sort((a, b) => volumes[b] - volumes[a]).slice(0, 4);
  }, [rows, window]);
  const totalWallets = rows.reduce((sum, c) => sum + c.wallets, 0);
  const focusedCoin = coins.includes(mobileCoin) ? mobileCoin : coins[0];
  const book = windowBook(selected, window), totals = completeTotals(book);
  const selectedCoins = Object.entries(book?.coins || {}).filter(([, b]) => b.positions > 0).sort((a, b) => (b[1].gross_delta_usd || 0) - (a[1].gross_delta_usd || 0));
  return <>
    <div className="tp-cohort-controls"><div className="tp-tabs" role="group" aria-label="Cohort grouping">{[["pnl", "By results"], ["size", "By trading size"]].map(([key, label]) => <button key={key} aria-pressed={dimension === key} onClick={() => { setDimension(key); setChosen(null); }}>{label}</button>)}</div><div className="tp-tabs tp-expiry-tabs" role="group" aria-label="Expiry of open options">{WINDOWS.map(([key, label]) => <button key={key} aria-pressed={window === key} onClick={() => setWindow(key)}>{label}</button>)}</div></div>
    <section className="tp-board tp-comparison" aria-label="Compare trader cohort positioning">
      <div className="tp-board-heading"><div><h2>How each group is positioned</h2><p>{number(totalWallets)} traders across {rows.length} {dimension === "pnl" ? "result" : "size"} groups · options only</p></div><span className="tp-context-label">Context, not a signal</span></div>
      <label className="tp-mobile-coin-select"><span>Compare a coin</span><select aria-label="Coin to compare on small screens" value={focusedCoin || ""} onChange={(event) => setMobileCoin(event.target.value)}>{coins.map((coin) => <option key={coin} value={coin}>{coin}</option>)}</select></label>
      <div className="tp-table-scroll"><table className="tp-table tp-matrix"><thead><tr><th>{dimension === "pnl" ? "Gross results · full history" : "Premium traded · full history"}</th><th className="tp-numeric">Group traders</th>{coins.map((coin) => <th className={coin === focusedCoin ? "" : "tp-other-mobile-coin"} key={coin}>{coin} delta balance</th>)}<th className="tp-matrix-more" /></tr></thead><tbody>{rows.map((row) => <tr key={row.name} className={row === selected ? "tp-selected-row" : ""} onClick={() => setChosen(row.name)}><td><button className="tp-group-name" aria-pressed={row === selected} onClick={() => setChosen(row.name)}>{band(row.name)}</button></td><td className="tp-numeric tp-mono">{number(row.wallets)}</td>{coins.map((coin) => <td className={coin === focusedCoin ? "" : "tp-other-mobile-coin"} key={coin}><Exposure book={coinBook(row, window, coin)} small /></td>)}<td className="tp-matrix-more" aria-hidden="true">{row === selected ? "−" : "+"}</td></tr>)}</tbody></table></div>
      {!rows.length && <div className="tp-empty">No published cohorts in this grouping.</div>}
      <div className="tp-matrix-legend"><span><i className="tp-negative" />Short delta</span><span className="tp-legend-mid">Balanced ±25%</span><span><i className="tp-positive" />Long delta</span><small>Four coins with the largest gross exposure. Select a group for every coin.</small></div>
    </section>
    {selected && <section className="tp-cohort-detail" aria-label="Selected cohort details" aria-live="polite">
      <div className="tp-detail-heading"><div><span className="tp-overline">Selected group</span><h2>{band(selected.name)}</h2><p>{number(selected.wallets)} traders · {GROUPS[selected.name]?.detail || "Published cohort"}{dimension === "pnl" ? " · before fees" : ""}</p></div><span>{WINDOWS.find(([key]) => key === window)?.[1]}</span></div>
      <div className="tp-detail-stats"><div><span>Net option delta</span><b className={tone(totals.net)}>{usd(totals.net)}{totals.partial && totals.net != null ? "*" : ""}</b></div><div><span>Gross option delta</span><b>{usd(totals.gross)}{totals.partial && totals.gross != null ? "*" : ""}</b></div><div><span>Wallet–option positions</span><b>{number(totals.positions)}</b></div></div>
      <p className="tp-scroll-cue">Swipe to see dollar exposure and positions →</p>
      <div className="tp-table-scroll" tabIndex={0} aria-label="Selected cohort exposure; scroll for dollar values and positions"><table className="tp-table tp-exposure-table"><thead><tr><th>Coin</th><th>Delta balance</th><th className="tp-numeric">Net dollar delta</th><th className="tp-numeric">Gross dollar delta</th><th className="tp-numeric">Positions</th></tr></thead><tbody>{selectedCoins.map(([coin, b]) => <tr key={coin}><td className="tp-coin-name">{coinImage(coin) && <img src={coinImage(coin)} alt="" />}{coin}</td><td><Exposure book={b} /></td><td className={`tp-numeric ${complete(b) ? tone(b.net_delta_usd) : ""}`}>{complete(b) ? usd(b.net_delta_usd) : "No reading"}</td><td className="tp-numeric">{complete(b) ? usd(b.gross_delta_usd) : "No reading"}</td><td className="tp-numeric">{number(b.positions)}</td></tr>)}</tbody></table></div>
      {!selectedCoins.length && <p className="tp-empty">{book ? "No open options in this expiry window." : "This expiry window has not been published."}</p>}
      {totals.partial && <p className="tp-partial">* Totals include only coins with complete quotes. A missing reading is outside the total.</p>}
    </section>}
    <Method cohorts payload={payload} cohortName={selected?.name} />
  </>;
}

export default function TradersPrototype({ data, view = "leaderboard", navigate }) {
  const payload = data?.traders || {};
  const cohorts = data?.cohorts?.pnl ? data.cohorts : payload.cohorts;
  const ready = payload.ready === true && payload.status === "ready";
  return <div className="tp-page">
    <header className="tp-page-head"><div><span className="tp-overline">Research / options traders</span><h1>{view === "cohorts" ? "Trader cohorts" : "Options traders"}</h1><p>{view === "cohorts" ? "Compare groups by past results and trading size, then see their options exposure." : "Expired options results, before fees. See the sample behind every number."}</p></div><div className="tp-history-stamp"><span>History through</span><b>{payload.through || "Not published"}</b><small>UTC close · mainnet research</small></div></header>
    <nav className="tp-page-tabs" aria-label="Traders sections"><button aria-current={view === "leaderboard" ? "page" : undefined} onClick={() => navigate?.("leaderboard")}>Leaderboard</button><button aria-current={view === "cohorts" ? "page" : undefined} onClick={() => navigate?.("cohorts")}>Cohorts</button><span>Market makers excluded · before fees</span></nav>
    {!ready ? <section className="tp-empty tp-board"><h2>{payload.status === "updating" ? "Wallet calculations are updating" : "Wallet history is still accumulating"}</h2><p>{payload.through ? `Processed through ${payload.through} UTC close. ` : ""}{payload.expected_through ? `Coverage required through ${payload.expected_through}.` : "Rankings appear when current coverage is ready."}</p></section> : <>{view === "cohorts" ? <Cohorts payload={payload} cohorts={cohorts} /> : <><div className="tp-scope-line"><span><b>{number(payload.ranked_total)}</b> eligible traders</span><span><b>{number(payload.traders?.length)}</b> published</span><span>Full collected history · expired options</span></div><Leaderboard payload={payload} /></>}</>}
    <footer className="tp-page-footer"><span>Published snapshot · {date(payload.generated_at)}</span><span>{payload.gaps > 0 ? `${number(payload.gaps)} unreconciled history readings · see methodology` : "Options results are separate from account balance and perpetual results."}</span></footer>
  </div>;
}
