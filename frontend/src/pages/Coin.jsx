import { useEffect } from "react";
import { useOutletContext, useParams, useLocation } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, pct, usd, title, utc, dayTime, strike, DASH } from "../lib/format.js";
import { Plate, Loading, Failed } from "../components/ui.jsx";
import CandleChart from "../components/CandleChart.jsx";
import { Asset } from "../components/MarketVisuals.jsx";
import EngineComparison from "../components/EngineComparison.jsx";
import OptionsWorkspace from "../components/OptionsWorkspace.jsx";
import Chain, { LayerIcon, chainReadings } from "../components/Chain.jsx";
import CoinWallets from "../components/CoinWallets.jsx";
import MetricHistory from "../components/MetricHistory.jsx";
import { currentEngine } from "../lib/research.js";
import { SIGNAL_HELP } from "../lib/explain.js";
import { RegimeHeader, Readings, Checks } from "../components/RegimePanel.jsx";
import { Link } from "react-router-dom";
import { QUESTIONS_ON } from "../lib/flags.js";
import { HatMark } from "../components/Brand.jsx";

// The chart shows the priced range for the next 30 days only, so candles keep most of the width.
const CONE_DAYS = 30;
const md = (t) => new Date(t * 1000).toISOString().slice(5, 10);

/** Swatches only; values sit on the chart, dates and meaning behind the chart's (i). */
function ChartLegend({ opts }) {
  const cone = (opts?.implied || []).filter((e) => e.days <= CONE_DAYS);
  const lv = opts?.levels;
  return (
    <div className="chart-legend" aria-label="Chart key">
      <span><i className="ribbon-key" />Ribbon</span>
      {cone.length > 0 && <span><i className="range" />Range</span>}
      {lv?.call_wall && <span><i className="dots" style={{ color: "var(--call)" }} />Call wall</span>}
      {lv?.put_wall && <span><i className="dots" style={{ color: "var(--put)" }} />Put wall</span>}
      {lv?.max_pain && <span><i className="dots" style={{ color: "var(--muted)" }} />Max pain</span>}
    </div>
  );
}

function chartInfo(opts, backfilled) {
  const cone = (opts?.implied || []).filter((e) => e.days <= CONE_DAYS);
  const end = cone[cone.length - 1];
  const lv = opts?.levels;
  return (
    <>
      Derive's index with traded volume. Lines: the ribbon's 32- and 58-day averages, coloured by each day's ribbon (gold: averages stacked upward; blue: downward; grey: mixed). Markers show where the daily signal changed.
      {end && <> Range: the middle half of outcomes option prices imply for each expiry to {md(end.expiry)}, from the option snapshot of {utc(opts.ts)} (green upper edge, red lower edge, dashed median). It is market pricing, not our view.</>}
      {lv && <> Call wall{lv.call_wall ? ` ${strike(lv.call_wall, "")}` : ""}: the strike above the index with the most calls open; put wall{lv.put_wall ? ` ${strike(lv.put_wall, "")}` : ""}: the strike below with the most puts, on expiries in the next {lv.days} days. Max pain{lv.max_pain ? ` ${strike(lv.max_pain, "")}` : ""}: the price with the smallest total payout at the {lv.max_pain_expiry ? md(lv.max_pain_expiry) : "nearest"} expiry. These are open-interest concentrations, not support or resistance.</>}
      {backfilled ? ` ${backfilled} earlier bars come from external spot markets (price only).` : ""}
    </>
  );
}

function Step({ id, n, kind, title, right, children }) {
  return (
    <section id={id} className="step">
      <div className="step-head">
        <span className="num">0{n}</span>
        <span className="ico"><LayerIcon kind={kind} size={20} /></span>
        <h2>{title}</h2>
        {right && <span className="step-right">{right}</span>}
      </div>
      {children}
    </section>
  );
}

/** The three layers in one compact row: one row when both horizons read the same, otherwise 7D and 30D side by side. */
function JourneyStrip({ alignment }) {
  if (!alignment) return null;
  const [r7, r30] = ["7d", "30d"].map((h) => chainReadings(alignment, h));
  const same = r7.every((x, i) => x.text === r30[i].text && x.state === r30[i].state);
  const rows = same ? [["7D · 30D", "30d"]] : [["7D", "7d"], ["30D", "30d"]];
  return (
    <nav className={`journey-strip${same ? " single" : ""}`} aria-label="Three layers">
      {rows.map(([label, h]) => {
        const r = h === "7d" ? r7 : r30;
        const agreed = r[0].state && r[0].state !== "neutral" && r.every((x) => x.state === r[0].state);
        return (
          <div key={h} className={`journey-row${agreed ? " agreed" : ""}`}>
            <span className="mono">{label}</span>
            <Chain alignment={alignment} horizon={h} compact />
          </div>);
      })}
    </nav>
  );
}

function PerpFigs({ pos }) {
  if (!pos) return null;
  return (
    <div className="perp-figs">
      <div><span>Funding, annual</span><strong className={`mono${pos.funding_rate < 0 ? " down" : ""}`}>{pct(pos.funding_rate == null ? null : pos.funding_rate * 24 * 365)}</strong></div>
      <div><span>Funding regime</span><strong>{title(pos.funding_regime?.replace("_", " "))}</strong></div>
      <div><span>Perp OI</span><strong className="mono">{usd(pos.oi_value)}</strong></div>
      <div><span>OI change</span><strong className="mono">{pos.oi_status === "ready" ? chg(pos.oi_change_pct) : DASH}</strong></div>
      <div><span>Perp volume 24h</span><strong className="mono">{usd(pos.volume_24h)}</strong></div>
      <div><span>Exhaustion</span><strong>{title(pos.exhaustion_state)}</strong></div>
    </div>
  );
}

/** The way into the Saloon near the top of the page: only in a build with the Saloon on, for a coin with live questions. */
export function SaloonCta({ und, live }) {
  if (!QUESTIONS_ON || !live) return null;
  return (
    <Link className="saloon-cta" to={`/saloon/${und}`}>
      <HatMark size={22} />
      <span><b>{und} in the Saloon</b><small>Yes or no on {und}'s price, priced from Derive options</small></span>
      <span className="saloon-cta-go" aria-hidden="true">→</span>
    </Link>
  );
}

export default function Coin() {
  const { und } = useParams();
  const { theme } = useOutletContext();
  const { data, error } = useData(`coins/${und}.json`);
  const tf = "1d";
  const { hash } = useLocation();
  useEffect(() => {
    if (!data || !hash) return;
    const frame = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start", behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [hash, !!data]);
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const candles = data.candles[tf] || [];
  const last = candles[candles.length - 1];
  const prevDay = candles[candles.length - 2];
  const dayChg = last && prevDay ? (last[4] / prevDay[4] - 1) * 100 : null;
  const row = data.latest?.[tf];
  const row4 = data.latest?.["4h"];
  const pos = data.latest?.["1d"]?.positioning;
  const engineReady = currentEngine(data.engine_comparison?.["1d"]);
  const fourReady = currentEngine(data.engine_comparison?.["4h"]);
  const ribbon = data.ribbon?.[tf] ?? null;
  const closed = row?.signal_bar_close_time ?? (last ? last[0] + 86400 : null);
  const history = <MetricHistory key={und} history={data.history} collapsible />;
  return (
    <div className="wrap page coin-page">
      <header className="coin-heading">
        <h1><Asset und={und} compact /></h1>
        <span className="coin-price mono">{price(last?.[4])}</span>
        <span className={`coin-chg mono ${dayChg > 0 ? "up" : dayChg < 0 ? "down" : "dim"}`}>{chg(dayChg)}</span>
        {closed && <span className="coin-stamp mono">Closed {dayTime(closed)}</span>}
      </header>
      <JourneyStrip alignment={data.alignment} />
      <SaloonCta und={und} live={data.questions === true} />

      <Step id="regime" n={1} kind="engine" title="Regime">
        <RegimeHeader row={row} row4={row4} history={data.history} current={engineReady} current4={fourReady}
          status={data.engine_comparison?.["1d"]?.status} />
        <Plate className="price-stage" id="price-chart" title={`${und} · 1D`} info={chartInfo(data.options, data.backfilled?.[tf])}
          right={<ChartLegend opts={data.options} />}>
          <CandleChart candles={candles} signals={data.signals?.[tf]} tf={tf} theme={theme} implied={data.options?.implied}
            levels={data.options?.levels} optionsAt={data.options?.ts} optionsIndex={data.options?.features?.index_price} coneDays={CONE_DAYS}
            ribbon={ribbon} />
        </Plate>
        <Readings row={row} history={data.history} ribbon={ribbon} candles={candles} />
        <Checks row={row} ctx={data.engine_context} />
        <details className="engine-detail">
          <summary>Engine detail</summary>
          <div>
            {row?.signal && row?.data_status === "ready" && <p className="signal-explanation">{SIGNAL_HELP[row.signal]}</p>}
            <EngineComparison comparison={data.engine_comparison} />
            <PerpFigs pos={pos && { ...pos, exhaustion_state: row?.exhaustion_state }} />
          </div>
        </details>
      </Step>

      {data.options ? (
        <>
          <Step id="wallets" n={2} kind="wallets" title="Wallets">
            <CoinWallets und={und} alignment={data.alignment} />
          </Step>
          <Step id="options" n={3} kind="options" title="Options"
            right={<span className="step-stamp mono">{dayTime(data.options.ts)}</span>}>
            <OptionsWorkspace key={und} opts={data.options} und={und} flow={data.taker_flow} hasSurface={data.has_surface === true} embedded />
          </Step>
        </>
      ) : <p className="status">{und} has no options on Derive.</p>}
      {history}
    </div>
  );
}
