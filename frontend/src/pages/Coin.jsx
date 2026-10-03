import { useEffect } from "react";
import { Link, useOutletContext, useParams, useLocation } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, pct, usd, title, utc, REGIME } from "../lib/format.js";
import { Plate, Loading, Failed, Info } from "../components/ui.jsx";
import CandleChart from "../components/CandleChart.jsx";
import { Asset, Reading } from "../components/MarketVisuals.jsx";
import EngineComparison, { EngineEvidence } from "../components/EngineComparison.jsx";
import OptionsWorkspace from "../components/OptionsWorkspace.jsx";
import Chain, { LayerIcon, HORIZON_LABEL, chainReadings } from "../components/Chain.jsx";
import CoinWallets from "../components/CoinWallets.jsx";
import MetricHistory from "../components/MetricHistory.jsx";
import { currentEngine } from "../lib/research.js";
import { SIGNAL_HELP } from "../lib/explain.js";

const HORIZON_DAYS = { "4h": 21, "1d": 120 };
function ChartLegend({ opts, tf, last }) {
  const cone = (opts?.implied || []).filter((e) => e.days <= HORIZON_DAYS[tf]);
  const lv = opts?.levels;
  if (!cone.length && !lv) return null;
  const end = cone[cone.length - 1];
  const base = opts?.features?.index_price;
  const rel = (v) =>
    base ? `${v >= base ? "+" : ""}${((v / base - 1) * 100).toFixed(1)}%` : "-";
  return (
    <div className="chart-legend">
      {end && (
        <>
          <span>
            Priced range to{" "}
            {new Date(end.expiry * 1000).toISOString().slice(5, 10)}
          </span>
          <span>
            <i style={{ background: "var(--up)" }} />
            <b className="up">{rel(end.q[3])}</b>
          </span>
          <span>
            <i style={{ background: "var(--down)" }} />
            <b className="down">{rel(end.q[1])}</b>
          </span>
          <span className="dim">
            {end.method === "atm" ? "ATM fallback" : "Checked smile"} ·{" "}
            {utc(opts.ts)}
          </span>
          <Info>
            The upper and lower edges bound the middle half of the model
            distribution for each expiry; the dashed line is its median. They
            begin at the option snapshot's index and time. Asymmetry can reflect
            the forward, volatility and skew, so it does not by itself identify
            call buying. ATM fallback omits strike skew. These are
            market-pricing model ranges.
          </Info>
        </>
      )}
      {lv && (
        <>
          <span>
            <i className="dots" style={{ color: "var(--up)" }} />
            Call wall {lv.call_wall?.toLocaleString() ?? "-"}
          </span>
          <span>
            <i className="dots" style={{ color: "var(--down)" }} />
            Put wall {lv.put_wall?.toLocaleString() ?? "-"}
          </span>
          <span>
            <i className="dots" style={{ color: "var(--muted)" }} />
            Min payout {lv.max_pain?.toLocaleString() ?? "-"} ·{" "}
            {lv.max_pain_expiry
              ? new Date(lv.max_pain_expiry * 1000).toISOString().slice(5, 10)
              : "-"}
          </span>
          <Info>
            Open interest on expiries in the next {lv.days} days. Call wall: the
            strike above the index with the most calls open; put wall: the
            strike below with the most puts. Minimum payout: the price with the
            smallest total intrinsic payout at the single displayed expiry.
            Walls pool the shown window; payout minima are calculated separately
            per expiry. These are OI concentrations, not support or resistance.
          </Info>
        </>
      )}
    </div>
  );
}


function Step({ id, n, kind, title, sub, reading, children }) {
  return (
    <section id={id} className="step">
      <div className="step-head">
        <span className="num">0{n}</span>
        <span className="ico"><LayerIcon kind={kind} size={22} /></span>
        <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
        {reading && <span className="reading">{reading}</span>}
      </div>
      {children}
    </section>
  );
}

function JourneyStrip({ alignment }) {
  if (!alignment) return null;
  return (
    <div className="journey-strip">
      <div className="rows">
        {["7d", "30d"].map((h) => {
          const r = chainReadings(alignment, h);
          const agreed = r[0].state && r[0].state !== "neutral" && r.every((x) => x.state === r[0].state);
          return (
            <div key={h} className={`journey-row${agreed ? " agreed" : ""}`}>
              <span>{HORIZON_LABEL[h]}{agreed ? " · aligned" : ""}</span>
              <Chain alignment={alignment} horizon={h} />
            </div>);
        })}
      </div>
    </div>
  );
}

function RegimeFigs({ row, row4 }) {
  if (!row) return null;
  const z = row.zscore;
  return (
    <div className="regime-figs">
      <div><span>Daily regime</span><strong>{REGIME[row.regime] || title(row.regime)}</strong></div>
      <div><span>4H</span><strong>{REGIME[row4?.regime] || title(row4?.regime)}</strong></div>
      <div><span>Z-score</span><strong className="mono">{z == null ? "-" : z.toFixed(2)}</strong></div>
      <div><span>Heat</span><strong className="mono">{row.heat ?? "-"}</strong></div>
      <div><span>Ribbon</span><strong style={{ color: row.ribbon?.state === "gold" ? "var(--orange)" : row.ribbon?.state === "blue" ? "var(--sig-exit)" : undefined }}>{title(row.ribbon?.state)}</strong></div>
      <div><span>Conditions</span><strong className="mono">{row.conditions_met ?? "-"} / {row.conditions_total ?? "-"}</strong></div>
    </div>
  );
}

function PerpFigs({ pos }) {
  if (!pos) return null;
  return (
    <div className="regime-figs">
      <div><span>Funding, annual</span><strong className={pos.funding_rate < 0 ? "down" : ""}>{pct(pos.funding_rate == null ? null : pos.funding_rate * 24 * 365)}</strong></div>
      <div><span>Funding regime</span><strong>{title(pos.funding_regime?.replace("_", " "))}</strong></div>
      <div><span>Perp OI</span><strong>{usd(pos.oi_value)}</strong></div>
      <div><span>OI change</span><strong>{pos.oi_status === "ready" ? chg(pos.oi_change_pct) : "-"}</strong></div>
      <div><span>Perp volume 24h</span><strong>{usd(pos.volume_24h)}</strong></div>
      <div><span>Exhaustion</span><strong>{title(pos.exhaustion_state)}</strong></div>
    </div>
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
  return (
    <div className="wrap page coin-page">
      <div className="coin-top">
        <div>
          <Link to="/markets" className="status">Markets /</Link>
          <h1><Asset und={und} />
            <span className="mono" style={{ fontSize: 24, fontWeight: 500 }}>{price(last?.[4])}</span>
            <span className={`mono ${dayChg > 0 ? "up" : dayChg < 0 ? "down" : ""}`} style={{ fontSize: 15 }}>{chg(dayChg)} 1D</span></h1>
        </div>
      </div>
      <JourneyStrip alignment={data.alignment} />

      <Step id="regime" n={1} kind="engine" title="Regime" sub="The engine's read of the daily price structure."
        reading={data.alignment ? <Reading alignment={data.alignment} kind="engine" /> : null}>
        {engineReady && <RegimeFigs row={row} row4={row4} />}
        <Plate className="price-stage" id="price-chart" title={`${und} · daily`}
          info={<>Derive's index price with traded volume. Orange line: fast average; grey: slow. Markers show where the daily signal changed. Ahead of the last bar: the middle half of outcomes option prices imply (green upper edge, red lower edge) and where open interest sits.{data.backfilled?.[tf] ? ` ${data.backfilled[tf]} earlier bars come from external spot markets (price only).` : ""}</>}
          right={<span className="status">{row?.signal_bar_close_time ? `Closed ${utc(row.signal_bar_close_time)}` : ""}</span>}>
          <CandleChart candles={candles} signals={data.signals?.[tf]} tf={tf} theme={theme} implied={data.options?.implied}
            levels={data.options?.levels} optionsAt={data.options?.ts} optionsIndex={data.options?.features?.index_price} />
          <ChartLegend opts={data.options} tf={tf} last={last?.[4]} />
        </Plate>
        <MetricHistory key={und} history={data.history} />
        <details className="engine-detail">
          <summary>Engine detail</summary>
          <div>
            {row?.signal && row?.data_status === "ready" && <p className="signal-explanation">{SIGNAL_HELP[row.signal]}</p>}
            <div className="engine-evidence-workspace">
              <EngineComparison comparison={data.engine_comparison} />
              <EngineEvidence latest={data.latest} />
            </div>
            <PerpFigs pos={pos && { ...pos, exhaustion_state: row?.exhaustion_state }} />
            {row?.signal_reason && <p className="status">{row.signal_reason}</p>}
            {data.daily_history && <p className="status">{data.daily_history.available_bars ?? candles.length} daily bars stored; {data.daily_history.evaluated_bars ?? "-"} evaluated at the last close; {data.daily_history.price_only_bars || 0} earlier price-only bars from {data.daily_history.sources?.join(", ") || "external spot markets"}.</p>}
          </div>
        </details>
      </Step>

      {data.options ? (
        <>
          <Step id="wallets" n={2} kind="wallets" title="Wallets" sub="What Derive's ranked options traders hold on this coin."
            reading={data.alignment ? <Reading alignment={data.alignment} horizon="30d" kind="wallets" /> : null}>
            <CoinWallets und={und} alignment={data.alignment} />
          </Step>
          <Step id="options" n={3} kind="options" title="Options" sub="What option prices say: the range priced in, protection, where open interest sits."
            reading={data.alignment ? <Reading alignment={data.alignment} horizon="30d" kind="options" /> : null}>
            <OptionsWorkspace key={und} opts={data.options} und={und} flow={data.taker_flow} embedded />
          </Step>
        </>
      ) : <p className="status">{und} has no options on Derive, so there is no wallet or options step.</p>}
    </div>
  );
}
