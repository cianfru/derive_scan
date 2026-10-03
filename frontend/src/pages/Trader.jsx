import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, pct, price, ago, utc, optionLabel, strike } from "../lib/format.js";
import { TYPE_INFO } from "../lib/traders.js";
import { codename, shortAddr } from "../lib/walletName.js";
import { Plate, Loading, Failed, Info } from "../components/ui.jsx";
import { WalletEmblem } from "../components/WalletTag.jsx";
import LeanBar from "../components/LeanBar.jsx";
import { Asset } from "../components/MarketVisuals.jsx";
import HistoryStatus, { coverageReady } from "../components/HistoryStatus.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (t) => { const d = new Date(t * 1000); return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}`; };
const dayLabel = (iso) => short(Date.parse(`${iso}T00:00:00Z`) / 1000);
const qty = (v) => Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 3 });
const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const tiered = (t) => t.tier === "top" || t.tier === "smart";
const CAP = 20;

const KPI_HELP = "Gross options PnL: expired options, premium received minus premium paid plus settlement value, before fees; it sets the rank. Win rate: share of expired option instruments with positive gross PnL; it counts outcomes, not their size. Expired options: distinct expired instruments with reconstructed results. Premium traded: option premium bought plus sold, before netting; it sets the size cohort. Perp PnL: reported realised perpetual PnL, separate from the ranking. " + TYPE_INFO;
const BOOK_HELP = "Positions reconstructed through the displayed UTC close, valued on fresh options quotes. Marks use a Black-76 model on the index; quoted delta is used where available, otherwise an estimate from the strike IV, marked est. No default volatility is assumed. Later trades are not included, and expired instruments are omitted. Entry is the average cost of the remaining position where daily records determine it; when buys and sells lose their order in a daily aggregate, entry and unrealised PnL show a dash until a later close or reversal establishes a known basis. Delta is dollar exposure to the coin; positive gains when the price rises. Coins are ordered by gross delta.";

function leanOf(rows) {
  const q = rows.filter((p) => p.delta_usd != null);
  const net = q.reduce((s, p) => s + p.delta_usd, 0), gross = q.reduce((s, p) => s + Math.abs(p.delta_usd), 0);
  return { net_delta_usd: net, gross_delta_usd: gross, score: gross > 0 ? net / gross : null };
}

function OpenOptions({ book }) {
  const by = {};
  for (const p of book) (by[p.und] ||= []).push(p);
  const groups = Object.entries(by).map(([und, rows]) => ({
    und, lean: leanOf(rows),
    rows: [...rows].sort((a, b) => a.expiry - b.expiry || a.strike - b.strike),
  })).sort((a, b) => b.lean.gross_delta_usd - a.lean.gross_delta_usd);
  return (
    <table className="grid book-table">
      <thead><tr><th>Option</th><th>Expiry</th><th>Side</th><th className="num">Contracts</th><th className="num">Entry</th><th className="num">Mark</th><th className="num">Delta</th><th className="num">Unrealised</th></tr></thead>
      {groups.map((g) => (
        <tbody key={g.und}>
          <tr className="coin-row">
            <td colSpan={8}>
              <span className="coin-row-in">
                <Link to={`/coin/${g.und}#wallets`} className="asset-link"><Asset und={g.und} compact /></Link>
                <LeanBar lean={g.lean} width={56} />
              </span>
            </td>
          </tr>
          {g.rows.map((p) => {
            const o = optionLabel(p.instrument);
            return (
              <tr key={p.instrument} className="book-row">
                <td className="b-opt mono">{o.strike != null ? `${strike(o.strike, "")} ${o.type}` : p.instrument}</td>
                <td className="b-exp mono faint">{short(p.expiry)}</td>
                <td className="b-side dim">{p.net > 0 ? "Long" : "Short"}</td>
                <td className="num b-qty">{qty(p.net)}</td>
                <td className="num b-entry" data-k="Entry">{p.entry == null ? <span className="faint">–</span> : price(p.entry)}</td>
                <td className="num b-mark" data-k="Mark">{price(p.mark)}</td>
                <td className="num b-delta" data-k="Delta">{p.delta_usd == null ? <span className="faint">–</span> : <>{usd(p.delta_usd)}{p.delta_source !== "quoted" && <span className="faint est"> est</span>}</>}</td>
                <td className={`num hero b-upnl ${tone(p.upnl)}`}>{p.upnl == null ? <span className="faint">–</span> : usd(p.upnl)}</td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

function Recent({ recent }) {
  const [all, setAll] = useState(false);
  const rows = [];
  for (const [d, inst, buy, sell, bv, sv] of recent) {
    if (buy) rows.push({ d, inst, side: "Buy", n: buy, px: bv / buy });
    if (sell) rows.push({ d, inst, side: "Sell", n: sell, px: sv / sell });
  }
  const shown = all ? rows : rows.slice(0, CAP);
  let last = null;
  return (
    <>
      <table className="grid trade-table">
        <thead><tr><th>Side</th><th className="num">Contracts</th><th>Option</th><th className="num">Average price</th></tr></thead>
        <tbody>
          {shown.flatMap((r, i) => {
            const out = [];
            if (r.d !== last) { last = r.d; out.push(<tr key={`d${i}`} className="day-row"><td colSpan={4}>{dayLabel(r.d)}</td></tr>); }
            out.push(
              <tr key={i} className="trade-row">
                <td className="t-side">{r.side}</td>
                <td className="num t-qty">{qty(r.n)}</td>
                <td className="mono t-opt">{optionLabel(r.inst).display}</td>
                <td className="num t-px">{price(r.px)}</td>
              </tr>);
            return out;
          })}
        </tbody>
      </table>
      {rows.length > shown.length && <button className="btn lb-more" onClick={() => setAll(true)}>Show all {rows.length}</button>}
    </>
  );
}

export default function Trader() {
  const { address } = useParams();
  const { data, error } = useData(`traders/${address.toLowerCase()}.json`, 5 * 60_000);
  const [copied, setCopied] = useState(false);
  const crumb = (name) => <nav className="crumbs" aria-label="Breadcrumb"><Link to="/traders">Traders</Link><span>/</span><span>{name}</span></nav>;
  if (error && !data) return <div className="wrap page">{crumb(codename(address))}<Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  if (!coverageReady(data)) return <div className="wrap page">{crumb(codename(address))}<HistoryStatus data={data} /></div>;
  const book = data.book || [];
  const name = codename(data.address);
  const copy = () => { navigator.clipboard?.writeText(data.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {}); };
  const large = (data.large_24h || []).slice(0, CAP);
  return (
    <div className="wrap page people-page trader-page">
      {crumb(name)}
      <section className="plate trader-id">
        <div className="tid">
          <WalletEmblem address={data.address} size={44} />
          <div className="tid-t">
            <h1>{name}{tiered(data) && <em className="tier-tag">{data.tier}</em>}</h1>
            <p className="tid-sub">
              <span className="mono" title={data.address}>{shortAddr(data.address)}</span>
              <button className="tid-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            </p>
            <p className="tid-sub tid-meta">
              <span>Rank {data.rank}</span>
              {data.pnl_cohort && <span>{data.pnl_cohort}</span>}
              {data.size_cohort && <span>{data.size_cohort}</span>}
              <span>since {data.first}</span>
              {data.last && <span>last trade {data.last}</span>}
              <span>perp PnL <b className={`mono ${tone(data.perp_pnl)}`}>{usd(data.perp_pnl)}</b></span>
            </p>
          </div>
        </div>
        <div className="tkpis">
          <div><span>Gross options PnL <Info label="About these figures">{KPI_HELP}</Info></span><b className={`big ${tone(data.option_pnl)}`}>{usd(data.option_pnl)}</b></div>
          <div><span>Win rate</span><b>{pct(data.win_rate, 0)}</b></div>
          <div><span>Expired options</span><b>{data.expired?.toLocaleString("en-US") ?? "—"}</b></div>
          <div><span>Premium traded</span><b>{usd(data.premium_traded)}</b></div>
        </div>
      </section>
      <Plate title="Open options" info={BOOK_HELP} right={data.lean?.score != null ? <LeanBar lean={data.lean} /> : null} bodyClass="flush">
        {book.length ? <OpenOptions book={book} /> : <p className="status pad">—</p>}
      </Plate>
      {large.length > 0 && (
        <Plate title="Large trades, 24h" bodyClass="flush">
          <table className="grid trade-table">
            <thead><tr><th>Time</th><th>Side</th><th className="num">Contracts</th><th>Option</th><th className="num">Price</th><th className="num">Notional</th></tr></thead>
            <tbody>{large.map((t, i) => (
              <tr key={i} className="trade-row">
                <td className="t-time dim">{ago(t.ts / 1000)}</td>
                <td className="t-side">{t.direction === "buy" ? "Buy" : "Sell"}</td>
                <td className="num t-qty">{t.amount != null ? qty(t.amount) : "—"}</td>
                <td className="mono t-opt">{optionLabel(t.instrument).display}</td>
                <td className="num t-px">{price(t.price)}</td>
                <td className="num t-notional">{usd(t.notional_usd)}</td>
              </tr>))}</tbody>
          </table>
        </Plate>)}
      <Plate title="Recent activity" info="Options bought and sold per day over the last 45 rebuilt days, with the average price." bodyClass="flush">
        {data.recent?.length ? <Recent recent={data.recent} /> : <p className="status pad">—</p>}
      </Plate>
      <p className="status">History to {data.through} UTC · book valued {utc(data.generated_at)}{Date.now() / 1000 - data.generated_at > 1800 ? " · historical snapshot" : ""}</p>
    </div>
  );
}
