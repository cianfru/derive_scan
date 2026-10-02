import { Link, useParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { usd, pct, price, ago } from "../lib/format.js";
import { TYPE, TYPE_INFO, typeOf } from "../lib/traders.js";
import { Plate, Loading, Failed, Info } from "../components/ui.jsx";
import WalletTag from "../components/WalletTag.jsx";
import LeanBar from "../components/LeanBar.jsx";

const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

export default function Trader() {
  const { address } = useParams();
  const { data, error } = useData(`traders/${address.toLowerCase()}.json`, 5 * 60_000);
  if (error && !data) return <div className="wrap page"><Link to="/traders" className="status">Traders /</Link><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const book = data.book || [];
  return (
    <div className="wrap page">
      <div>
        <Link to="/traders" className="status">Traders /</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginTop: 6 }}>
          <WalletTag address={data.address} size={44} className="wtag-head" />
          <span className="status">Rank {data.rank} · <span className={data.tier === "top" || data.tier === "smart" ? "orange" : ""}>{TYPE[typeOf(data)]}</span>
            {data.pnl_cohort ? ` · ${data.pnl_cohort}` : ""}{data.size_cohort ? ` · ${data.size_cohort}` : ""} <Info>{TYPE_INFO}</Info></span>
        </div>
      </div>
      <div className="figs">
        <div className="fig"><span>Options PnL <Info>Options that have expired: premium received minus premium paid plus what was held at expiry, at the settlement price.</Info></span>
          <strong className={data.option_pnl > 0 ? "up" : data.option_pnl < 0 ? "down" : ""}>{usd(data.option_pnl)}</strong></div>
        <div className="fig"><span>Win rate</span><strong>{pct(data.win_rate, 0)}</strong></div>
        <div className="fig"><span>Expired options</span><strong>{data.expired}</strong></div>
        <div className="fig"><span>Premium traded</span><strong>{usd(data.premium_traded)}</strong></div>
        <div className="fig"><span>Perp PnL</span><strong className={data.perp_pnl > 0 ? "up" : data.perp_pnl < 0 ? "down" : ""}>{usd(data.perp_pnl)}</strong></div>
        <div className="fig"><span>Active</span><strong style={{ fontSize: 13 }}>{data.first} to {data.last}</strong></div>
      </div>
      <Plate title="Open options" info="Positions held at the end of the newest rebuilt day, valued on the newest options chain. Entry is the average price paid (long) or received (short). Delta: the position's dollar exposure to the coin's price; positive gains when the price rises."
        right={book.length ? <LeanBar lean={data.lean} /> : null} bodyClass="table-wrap">
        {book.length ? (
          <table className="grid" style={{ minWidth: 720 }}>
            <thead><tr><th>Option</th><th>Side</th><th className="num">Contracts</th><th className="num">Entry</th><th className="num">Mark</th><th className="num">Delta</th><th className="num">Unrealised</th></tr></thead>
            <tbody>
              {book.map((p) => (
                <tr key={p.instrument} style={{ cursor: "default" }}>
                  <td><Link to={`/coin/${p.und}`} style={{ fontWeight: 600 }}>{p.und}</Link> <span className="mono">{p.strike.toLocaleString()} {p.type === "C" ? "call" : "put"}</span> <span className="dim mono">{day(p.expiry)}</span></td>
                  <td className={p.net > 0 ? "up" : "down"}>{p.net > 0 ? "Long" : "Short"}</td>
                  <td className="num">{Math.abs(p.net).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                  <td className="num">{price(p.entry)}</td>
                  <td className="num">{price(p.mark)}</td>
                  <td className={`num ${p.delta_usd > 0 ? "up" : p.delta_usd < 0 ? "down" : ""}`}>{usd(p.delta_usd)}</td>
                  <td className={`num ${p.upnl > 0 ? "up" : p.upnl < 0 ? "down" : ""}`}>{p.upnl == null ? <span className="faint">-</span> : usd(p.upnl)}</td>
                </tr>))}
            </tbody>
          </table>) : <p className="status">No open options.</p>}
      </Plate>
      {data.large_24h?.length > 0 && (
        <Plate title="Large trades, 24h" bodyClass="table-wrap">
          <table className="grid" style={{ minWidth: 560 }}>
            <thead><tr><th>Time</th><th>Instrument</th><th>Side</th><th className="num">Price</th><th className="num">Notional</th></tr></thead>
            <tbody>{data.large_24h.map((t, i) => (
              <tr key={i} style={{ cursor: "default" }}><td className="dim">{ago(t.ts / 1000)}</td><td>{t.instrument}</td>
                <td className={t.direction === "buy" ? "up" : "down"}>{t.direction === "buy" ? "Buy" : "Sell"}</td>
                <td className="num">{price(t.price)}</td><td className="num">{usd(t.notional_usd)}</td></tr>))}</tbody>
          </table>
        </Plate>)}
      <Plate title="Recent activity" info="Options bought and sold per day over the last 45 rebuilt days, with the average price." bodyClass="table-wrap">
        {data.recent?.length ? (
          <table className="grid" style={{ minWidth: 560 }}>
            <thead><tr><th>Day</th><th>Option</th><th className="num">Bought</th><th className="num">Sold</th><th className="num">Average price</th></tr></thead>
            <tbody>{data.recent.map(([d, inst, buy, sell, bv, sv], i) => (
              <tr key={i} style={{ cursor: "default" }}><td className="dim">{d}</td><td className="mono">{inst}</td>
                <td className="num up">{buy ? buy.toLocaleString(undefined, { maximumFractionDigits: 3 }) : ""}</td>
                <td className="num down">{sell ? sell.toLocaleString(undefined, { maximumFractionDigits: 3 }) : ""}</td>
                <td className="num">{price((bv + sv) / (buy + sell))}</td></tr>))}</tbody>
          </table>) : <p className="status">No trades in the last 45 days.</p>}
      </Plate>
      <p className="status">History to {data.through} UTC</p>
    </div>
  );
}
