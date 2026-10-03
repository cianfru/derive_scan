import { useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, strike, clock } from "../lib/format.js";
import { Asset } from "../components/MarketVisuals.jsx";
import { MoveBand, SkewInstrument, VolatilityTenors } from "../components/OptionsInstruments.jsx";
import { Loading, Failed, PageHead, PanelHead, Tabs, Empty, Arrow } from "../components/ui.jsx";

const DAYS = { "7d": 7, "30d": 30 };
const roundUp = (v, step) => Math.max(step, Math.ceil((v - 1e-9) / step) * step);

const PAGE_HELP = "Every market with listed options on Derive, largest open interest first. The window sets the priced move: the at-the-money implied volatility for that horizon scaled to it. Open a market for its expiries and strikes.";

const BOARD_HELP = (
  <>
    <b>Move</b>: index × ATM implied volatility × √(days/365), one standard deviation of priced movement. Every band shares the scale in the column head; it is market pricing, symmetric and ignores skew.
    <br /><br /><b>Skew</b>: 25-delta call IV minus put IV at 30 days, in vol points. Negative means puts are priced richer for comparable delta.
    <br /><br /><b>Term</b>: ATM IV at 7, 30 and 90 days on one scale for every market; the figure is the 30-day level.
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
  const tabs = <Tabs label="Window" value={win} onChange={setWin} items={[["7d", "Within 7 days", "7 days"], ["30d", "Within 30 days", "30 days"]]} />;

  const row = (c) => {
    const o = c.options, lv = o.levels;
    const stale = o.status !== "ready" || data.generated_at - o.ts > 1800;
    return (
      <Link key={c.und} className="ob-row" to={`/coin/${c.und}#options`} aria-label={`Open ${c.und} options`}>
        <span className="ob-coin">
          <Asset und={c.und} compact />
          {stale && <small className="ob-stale">as of {clock(o.ts).replace(" UTC", "")}</small>}
        </span>
        <span className="ob-num ob-index" data-key="Index">${price(c.price)}</span>
        <span className="ob-move" data-key={`${days}D move`}><MoveBand index={c.price} iv={ivOf(c)} days={days} scale={moveMax} /></span>
        <span className="ob-skew" data-key="Skew"><SkewInstrument rr={o.rr25_30d} clamp={skewMax} /></span>
        <span className="ob-term" data-key="Term"><VolatilityTenors features={o} ivScale={ivScale} /></span>
        <span className="ob-num ob-walls" data-key="Walls">
          {lv?.put_wall ? <b className="put">{strike(lv.put_wall)}</b> : <Empty />}
          <i>/</i>
          {lv?.call_wall ? <b className="call">{strike(lv.call_wall)}</b> : <Empty />}
        </span>
        <span className="ob-num ob-pc" data-key="P/C">{Number.isFinite(o.pc_oi_ratio) ? o.pc_oi_ratio.toFixed(2) : <Empty />}</span>
        <span className="ob-arrow" aria-hidden="true"><Arrow /></span>
      </Link>
    );
  };

  return (
    <div className="wrap page options-page">
      <PageHead title="Options" info={PAGE_HELP} tabs={tabs} meta={<>{coins.length} markets · {clock(data.generated_at)}</>} />
      <section className="plate options-board" aria-label="Options markets">
        <PanelHead title="Surfaces" info={BOARD_HELP} infoLabel="How to read the options board" />
        <div className="ob-head" aria-hidden="true">
          <span>Market</span>
          <span className="num">Index</span>
          <span>{days}D move <em>±{Math.round(moveMax * 100)}%</em></span>
          <span>Skew <em>±{skewMax}</em></span>
          <span>Term 7/30/90</span>
          <span className="num">Put / Call walls</span>
          <span className="num">P/C</span>
          <span />
        </div>
        {quoted.map(row)}
        {thin.length > 0 && <div className="ob-divider"><span>Thin quotes</span></div>}
        {thin.map(row)}
      </section>
    </div>
  );
}
