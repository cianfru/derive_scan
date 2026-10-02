import { Asset } from "../components/MarketVisuals.jsx";
import OptionsSummary from "../components/OptionsSummary.jsx";
import { openMarketRow } from "../lib/explain.js";
import { Link, useNavigate } from "react-router-dom";
import { useData } from "../lib/data.js";
import { pct, price, utc } from "../lib/format.js";
import { Loading, Failed, Info } from "../components/ui.jsx";

function MiniTerm({ term }) {
  const rows = (term || []).filter(([d, iv]) => Number.isFinite(d) && d >= 0 && Number.isFinite(iv)).sort((a, b) => a[0] - b[0]);
  if (rows.length < 2) return <div className="term-empty status">Too few expiries for a curve</div>;
  const W = 340, H = 136, left = 38, right = 10, top = 18, bottom = 28;
  const lastDay = rows[rows.length - 1][0], ivs = rows.map(t => t[1]), lo = Math.min(...ivs), hi = Math.max(...ivs);
  const pad = Math.max(.01, (hi - lo) * .2);
  const x = d => left + (d - rows[0][0]) / (lastDay - rows[0][0] || 1) * (W - left - right);
  const y = iv => top + (hi + pad - iv) / (hi - lo + 2 * pad) * (H - top - bottom);
  const path = rows.map(([d, iv], i) => `${i ? "L" : "M"}${x(d)},${y(iv)}`).join(" ");
  return <figure className="term-preview"><figcaption>Volatility by expiry <Info label="About the volatility curve">Each point is an expiry's annualised at-the-money implied volatility. Days to expiry use a linear scale. The vertical scale fits this market's observed volatility range.</Info></figcaption><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Annualised implied volatility ranges from ${pct(lo)} to ${pct(hi)} across expiries from ${rows[0][0].toFixed(0)} to ${lastDay.toFixed(0)} days`}>
    {[lo, hi].filter((v, i, a) => a.indexOf(v) === i).map(v => <g key={v}><line x1={left} x2={W-right} y1={y(v)} y2={y(v)} className="trace-grid"/><text x={left-8} y={y(v)+4} textAnchor="end">{pct(v,0)}</text></g>)}
    <path d={path} fill="none" stroke="var(--orange)" strokeWidth="1.7" strokeLinejoin="round"/>
    {rows.map(([d, iv],i) => <circle key={i} cx={x(d)} cy={y(iv)} r="2.3" fill="var(--plate)" stroke="var(--orange)"><title>{d.toFixed(1)} days: {pct(iv)}</title></circle>)}
    <text x={left} y={H-4}>{rows[0][0].toFixed(0)}d</text><text x={W-right} y={H-4} textAnchor="end">{lastDay.toFixed(0)} days</text>
  </svg></figure>;
}

function SkewBar({ rr }) {
  if (rr == null) return <span className="faint">-</span>;
  const w = Math.min(50, Math.abs(rr) * 100 * 6);
  return (
    <span className="meter" style={{ gridTemplateColumns: "80px auto" }}>
      <i className="center"><b style={{ left: rr < 0 ? `${50 - w}%` : "50%", width: `${w}%`, background: rr < 0 ? "var(--sig-exit)" : "var(--orange)" }} /></i>
      <span className="mono">{rr > 0 ? "+" : ""}{(rr * 100).toFixed(2)}</span>
    </span>
  );
}

export default function Options() {
  const nav = useNavigate();
  const { data, error } = useData("markets.json");
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const coins = data.coins.filter((c) => c.options).sort((a, b) => (b.options.option_oi_contracts * (b.price || 0)) - (a.options.option_oi_contracts * (a.price || 0)));
  return (
    <div className="wrap page options-page">
      <div>
        <h1>Options</h1>
        <p className="sub">The price of movement, by market. Open a surface to inspect strikes, expiries and exposure.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
        {coins.map((c) => {
          const o = c.options;
          const t = (o.term || []).filter((x) => x[0] >= 1);
          const slope = t.length >= 2 ? t[t.length - 1][1] - t[0][1] : null;
          return (
            <section key={c.und} className="plate option-card" tabIndex={0} aria-label={`Open ${c.und} options`} onClick={e=>openMarketRow(e,nav,c.und)} onKeyDown={e=>openMarketRow(e,nav,c.und)}>
              <div className="plate-h">
                <Link className="option-market-link" to={`/coin/${c.und}`}><Asset und={c.und}/><span aria-hidden="true">↗</span></Link>
                <span className="mono dim" style={{ fontSize: 13 }}>${price(c.price)}</span>
              </div>
              <div className="plate-b" style={{ display: "grid", gap: 12 }}>
                <p className="option-snapshot status">Snapshot {utc(o.ts)}{Date.now() / 1000 - o.ts > 1800 ? " · historical" : ""}</p>
                <OptionsSummary compact features={o} index={c.price}/>
                <MiniTerm term={o.term} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div className="fig" style={{ padding: 0, background: "none" }}><span>IV 30d <Info>Annualised at-the-money implied volatility, interpolated to a 30-day tenor.</Info></span><strong style={{ fontSize: 17 }}>{pct(o.atm_iv_30d)}</strong></div>
                  <div className="fig" style={{ padding: 0, background: "none" }}><span>Curve <Info>Compares the furthest expiry with the nearest expiry at least one day out. Inverted means near-term annualised volatility is higher; Upward means longer-term volatility is higher. Flat means no difference.</Info></span>
                    <strong style={{ fontSize: 13 }} className={slope < 0 ? "down" : ""}>{slope == null ? "-" : slope < 0 ? "Inverted" : slope === 0 ? "Flat" : "Upward"}</strong></div>
                  <div className="fig" style={{ padding: 0, background: "none" }}><span>Put / call <Info>Outstanding put contracts divided by call contracts. This is contract structure; it does not tell us who bought or sold.</Info></span><strong style={{ fontSize: 17 }}>{o.pc_oi_ratio?.toFixed(2) ?? "-"}</strong></div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="label">Skew 30d <Info>Call minus put implied volatility at 25 delta, in volatility points. Negative means puts are priced richer.</Info></span><SkewBar rr={o.rr25_30d} />
                </div>
              </div>
            </section>);
        })}
      </div>
      <p className="status" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Each surface has its own scale. Compare the labelled IV and skew values across markets.
        <Info>Skew is the 25-delta risk reversal at 30 days: below zero, puts are priced richer than calls. Put / call is open interest. On some coins most open interest comes from call-selling vaults, so read it as structure rather than sentiment.</Info>
      </p>
      {coins[0] && <p className="status">Updated {utc(coins[0].options.ts)}</p>}
    </div>
  );
}
