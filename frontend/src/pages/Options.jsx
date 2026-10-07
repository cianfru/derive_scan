import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, strike, clock, pct } from "../lib/format.js";
import { Asset } from "../components/MarketVisuals.jsx";
import { MoveBand, SkewInstrument, VolatilityTenors } from "../components/OptionsInstruments.jsx";
import { Loading, Failed, PanelHead, Tabs, Empty, Arrow, Lead, Info } from "../components/ui.jsx";
import { MarketResearchHeader } from "../components/MarketResearchHeader.jsx";
import { optionsLead } from "../lib/takeaway.js";
import "../options-page.css";

const DAYS = { "7d": 7, "30d": 30 };
const roundUp = (v, step) => Math.max(step, Math.ceil((v - 1e-9) / step) * step);

const PAGE_HELP = "Every market with listed options on Derive, largest open interest first. The window sets the priced move: the at-the-money implied volatility for that horizon scaled to it. Open a market for its expiries and strikes.";

const BOARD_HELP = (
  <>
    <b>Priced move</b>: index × ATM implied volatility × √(days/365), one standard deviation of priced movement. Every band shares the scale in the column head; it is market pricing, symmetric and ignores skew.
    <br /><br /><b>30D skew</b>: 25-delta call IV minus put IV at 30 days, in vol points. Negative means puts are priced richer for comparable delta.
    <br /><br /><b>ATM IV</b>: ATM implied volatility at 7, 30 and 90 days on one scale for every market; the figure is the 30-day level. Open Details for all three percentages and the priced dollar range.
    <br /><br /><b>OI</b>: the put wall is the strike below the index with the most puts open, the call wall the strike above it with the most calls, across expiries in the next 30 days. P/C is put contracts over call contracts across all expiries. Open positions, not support or resistance.
  </>
);

export default function Options() {
  const { data, error } = useData("markets.json");
  const [win, setWin] = useState("30d");
  if (!data)
    return <div className="wrap page">{error ? <Failed error={error} /> : <Loading />}</div>;
  const days = DAYS[win];
  const ivOf = (c) => c.options[`atm_iv_${days}d`];
  const coins = data.coins
    .filter((c) => c.options)
    .sort((a, b) => b.options.option_oi_contracts * (b.price || 0) - a.options.option_oi_contracts * (a.price || 0));
  const quoted = coins.filter((c) => Number.isFinite(ivOf(c)));
  const thin = coins.filter((c) => !Number.isFinite(ivOf(c)));
  const moveMax = roundUp(Math.max(0, ...quoted.map((c) => ivOf(c) * Math.sqrt(days / 365))), 0.1);
  const skewMax = roundUp(Math.max(0, ...coins.map((c) => Math.abs(c.options.rr25_30d * 100)).filter(Number.isFinite)), 5);
  const ivs = coins.flatMap((c) => [7, 30, 90].map((d) => c.options[`atm_iv_${d}d`])).filter(Number.isFinite);
  const ivScale = ivs.length ? [Math.min(...ivs), Math.max(...ivs)] : [0, 1];
  const tabs = <Tabs label="Priced move window" value={win} onChange={setWin} items={[["7d", "7 days"], ["30d", "30 days"]]} />;

  const row = (c) => {
    const o = c.options, lv = o.levels;
    const stale = o.status !== "ready" || !Number.isFinite(o.ts) || Date.now() / 1000 - o.ts > 1800 || o.ts > Date.now() / 1000;
    return (
      <article key={c.und} className="ob-market" aria-label={`${c.und} option pricing`}>
      <Link className="ob-row" to={`/coin/${c.und}#options`} aria-label={`Open ${c.und} options`}>
        <span className="ob-coin">
          <Asset und={c.und} compact />
          <span className="ob-mobile-index">${price(c.price)}</span>
          {stale && <small className="ob-stale">as of {clock(o.ts).replace(" UTC", "")}</small>}
        </span>
        <span className="ob-num ob-index" data-key="Index"><span className="ob-cell-label">Index</span>${price(c.price)}</span>
        <span className="ob-move" data-key={`${days}D move`}><span className="ob-cell-label">Priced move · {days}D</span><MoveBand index={c.price} iv={ivOf(c)} days={days} scale={moveMax} /></span>
        <span className="ob-skew" data-key="Skew"><span className="ob-cell-label">30D skew · vol pts</span><SkewInstrument rr={o.rr25_30d} clamp={skewMax} caption /></span>
        <span className="ob-term" data-key="Term"><span className="ob-cell-label">ATM IV · 7 / 30 / 90D</span><VolatilityTenors features={o} ivScale={ivScale} /><span className="ob-tenor-values">{[7, 30, 90].map((d) => <span key={d}><small>{d}D</small><b>{pct(o[`atm_iv_${d}d`])}</b></span>)}</span></span>
        <span className="ob-num ob-walls" data-key="Walls">
          <span className="ob-cell-label">Put / Call walls</span>
          {lv?.put_wall ? <b className="put">{strike(lv.put_wall)}</b> : <Empty />}
          <i>/</i>
          {lv?.call_wall ? <b className="call">{strike(lv.call_wall)}</b> : <Empty />}
        </span>
        <span className="ob-num ob-pc" data-key="P/C"><span className="ob-cell-label">P/C OI</span>{Number.isFinite(o.pc_oi_ratio) ? o.pc_oi_ratio.toFixed(2) : <Empty />}</span>
        <span className="ob-arrow" aria-hidden="true"><Arrow /></span>
      </Link>
      <details className="ob-details">
        <summary aria-label={`${c.und} pricing details`}><span>Details</span><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg></summary>
        <div className="ob-detail-grid">
          <div className="ob-detail-move"><span className="ob-detail-label">Priced move · {days}D<Info label={`About ${c.und} priced movement`}>Index × ATM implied volatility × √({days}/365). A symmetric one-standard-deviation scale of priced movement; it ignores skew. Market pricing, not our view.</Info></span><MoveBand index={c.price} iv={ivOf(c)} days={days} bare /></div>
          <div><span className="ob-detail-label">ATM IV<Info label={`About ${c.und} implied volatility`}>Annualised at-the-money implied volatility, interpolated to 7, 30 and 90 days. Missing tenors are not estimated.</Info></span><div className="ob-detail-tenors">{[7, 30, 90].map((d) => <span key={d}><small>{d}D</small><b>{pct(o[`atm_iv_${d}d`])}</b></span>)}</div></div>
          <div><span className="ob-detail-label">30D skew<Info label={`About ${c.und} skew`}>25-delta call IV minus put IV, in volatility points. Negative means puts are priced richer for comparable delta; positive means calls are richer. Pricing, not trade direction.</Info></span><SkewInstrument rr={o.rr25_30d} bare /></div>
          <div><span className="ob-detail-label">Put / Call walls<Info label={`About ${c.und} open interest`}>The strikes below and above the index with the most put and call contracts open, across expiries in the next 30 days. P/C counts put contracts over call contracts across all expiries. Open positions, not support or resistance.</Info></span><div className="ob-detail-walls"><b className="put">{lv?.put_wall ? strike(lv.put_wall) : <Empty />}</b><span>/</span><b className="call">{lv?.call_wall ? strike(lv.call_wall) : <Empty />}</b></div><span className="ob-detail-ratio">P/C OI <b>{Number.isFinite(o.pc_oi_ratio) ? o.pc_oi_ratio.toFixed(2) : <Empty />}</b></span></div>
        </div>
      </details>
      </article>
    );
  };

  return (
    <div className="wrap page market-research-page options-page research-refined">
      <MarketResearchHeader error={error} title="Options" description="Compare option pricing across markets." info={PAGE_HELP} meta={<>{coins.length} markets · {clock(data.generated_at)}</>} />
      <Lead lead={optionsLead(data)} />
      <section className="plate options-board" aria-label="Options markets">
        <PanelHead title="Option pricing" info={BOARD_HELP} infoLabel="How to read the options board" right={<div className="mr-controls op-window"><span className="op-window-label">Priced move window</span>{tabs}</div>} />
        <div className="ob-head" aria-hidden="true">
          <span>Market</span>
          <span className="num">Index</span>
          <span>Priced move · {days}D <em>Shared scale ±{Math.round(moveMax * 100)}%</em></span>
          <span>30D skew <em>±{skewMax} vol pts</em></span>
          <span>ATM IV <em>7 / 30 / 90D</em></span>
          <span className="num">Put / Call walls <em>Next 30 days</em></span>
          <span className="num">P/C OI</span>
          <span />
        </div>
        {quoted.map(row)}
        {thin.length > 0 && <div className="ob-divider"><span>Thin quotes</span><small>{thin.length} {thin.length === 1 ? "market" : "markets"}</small></div>}
        {thin.map(row)}
        <div className="op-board-foot"><span>Largest open interest first</span><span className="op-shared-scales">Shared scales: move ±{Math.round(moveMax * 100)}% · skew ±{skewMax} vol pts · ATM IV {pct(ivScale[0])}–{pct(ivScale[1])}</span></div>
      </section>
    </div>
  );
}
