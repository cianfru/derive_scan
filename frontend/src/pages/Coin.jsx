import { useMemo, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, pct, usd, title, utc, REGIME, DATA_LABEL } from "../lib/format.js";
import { Signal, Tabs, Plate, Loading, Failed, Info } from "../components/ui.jsx";
import CandleChart from "../components/CandleChart.jsx";
import AlignmentGrid, { ALIGN_INFO } from "../components/Alignment.jsx";
import { OIWall, Smile, TermStructure, MiniSeries, PricedRange, PricedByDate, TakerFlow } from "../components/OptionsViz.jsx";

import { Conditions, FlowCoverage, ModelDetails, QUALITY_LABEL } from "../components/AnalyticalDetails.jsx";

function Readout({ row }) {
  if (!row) return <p className="status">No signal yet.</p>;
  const z = Math.max(-3, Math.min(3, row.zscore || 0));
  return (
    <div className="figs">
      <div className="fig"><span>Signal</span>{row.signal_status === "ready" && row.data_status === "ready" ? <Signal s={row.signal} /> : <strong style={{ fontSize: 13 }}>Unavailable</strong>}</div>
      <div className="fig"><span>Regime</span><strong style={{ fontSize: 15 }}>{REGIME[row.regime] || title(row.regime)}</strong></div>
      <div className="fig"><span>Z-score <Info>How far price sits from its trend, in standard deviations. Above 2.5 is stretched.</Info></span>
        <span className="meter" style={{ textTransform: "none" }}><i className="center"><b style={{ left: `${50 + Math.min(0, z) / 3 * 50}%`, width: `${Math.abs(z) / 3 * 50}%`, background: "var(--sig-strong)" }} /></i>
          <strong style={{ fontSize: 15 }}>{row.zscore?.toFixed(2) ?? "-"}</strong></span></div>
      <div className="fig"><span>Heat <Info>Distance from the long-term base, 0 to 100. High heat means extended.</Info></span>
        <span className="meter" style={{ textTransform: "none" }}><i><b style={{ left: 0, width: `${Math.min(100, row.heat || 0)}%` }} /></i>
          <strong style={{ fontSize: 15 }}>{row.heat ?? "-"}</strong></span></div>
      <div className="fig"><span>Exhaustion</span><strong style={{ fontSize: 15 }}>{title(row.exhaustion_state)}</strong></div>
      <div className="fig"><span>Ribbon <Info>Trend structure from four moving averages. Gold: stacked up. Blue: stacked down. Grey: no clear order.</Info></span>
        <strong style={{ fontSize: 15, color: row.ribbon?.state === "gold" ? "var(--orange)" : row.ribbon?.state === "blue" ? "var(--sig-exit)" : "var(--muted)" }}>{title(row.ribbon?.state)}</strong></div>
      <div className="fig"><span>Conditions <Info>Passed checks out of all checks. Unknown evidence earns no point. Inspect each result and its source under Why this signal.</Info></span><strong style={{ fontSize: 15 }}>{row.conditions_met ?? "-"} / {row.conditions_total ?? "-"}</strong></div>
      <div className="fig"><span>Data</span><strong style={{ fontSize: 13, color: row.data_status === "ready" ? "var(--fg)" : "var(--sig-acc)" }}>{DATA_LABEL[row.data_status] || "-"}</strong></div>
    </div>
  );
}

const HORIZON_DAYS = { "4h": 21, "1d": 120 };
const LEAN = { defensive: ["Defensive", "down"], neutral: ["Neutral", ""], up: ["Leaning up", "up"] };
const LEAN_PARTS = [["skew", "Current skew, 30d"], ["flow", "Taker premium, 7d"]];
const LEAN_INFO = "Options tone averages two readings: current 30-day call-minus-put volatility skew, scaled by four volatility points, and the balance of taker option premium over a fully collected seven-day window. Calls bought and puts sold are positive; puts bought and calls sold are negative. Both readings are required. This describes pricing and activity; it does not establish trader intent or future returns. Term structure and put/call open interest are shown separately.";

function Lean({ lean }) {
  const [label, cls] = (lean?.version === 2 && LEAN[lean.state]) || [QUALITY_LABEL[lean?.status] || "Unavailable", "faint"];
  return <strong className={cls} style={{ fontSize: 15 }}>{label}</strong>;
}

function LeanParts({ lean }) {
  return (
    <div className="figs">
      <div className="fig"><span>Options tone <Info>{LEAN_INFO}</Info></span><Lean lean={lean} /></div>
      {LEAN_PARTS.map(([k, label]) => {
        const v = lean?.parts?.[k];
        return (
          <div className="fig" key={k}><span>{label}</span>
            <span className="meter" style={{ textTransform: "none" }}><i className="center">{v != null && <b style={{ left: `${50 + Math.min(0, v) * 50}%`, width: `${Math.abs(v) * 50}%`, background: v < 0 ? "var(--down)" : "var(--up)" }} />}</i>
              <strong style={{ fontSize: 13 }} className={v == null ? "faint" : ""}>{v == null ? "Unavailable" : v >= 0.25 ? "Up" : v <= -0.25 ? "Defensive" : "Neutral"}</strong></span></div>);
      })}
    </div>
  );
}

function ChartLegend({ opts, tf, last }) {
  const cone = (opts?.implied || []).filter((e) => e.days <= HORIZON_DAYS[tf]);
  const lv = opts?.levels;
  if (!cone.length && !lv) return null;
  const end = cone[cone.length - 1];
  const base = opts?.features?.index_price;
  const rel = (v) => base ? `${v >= base ? "+" : ""}${((v / base - 1) * 100).toFixed(1)}%` : "-";
  return (
    <div className="chart-legend">
      {end && <>
        <span>Priced range to {new Date(end.expiry * 1000).toISOString().slice(5, 10)}</span>
        <span><i style={{ background: "var(--up)" }} /><b className="up">{rel(end.q[3])}</b></span>
        <span><i style={{ background: "var(--down)" }} /><b className="down">{rel(end.q[1])}</b></span>
        <span className="dim">{end.method === "atm" ? "ATM fallback" : "Checked smile"} · {utc(opts.ts)}</span>
        <Info>The upper and lower edges bound the middle half of the model distribution for each expiry; the dashed line is its median. They begin at the option snapshot's index and time. Asymmetry can reflect the forward, volatility and skew, so it does not by itself identify call buying. ATM fallback omits strike skew. These are market-pricing model ranges.</Info>
      </>}
      {lv && <>
        <span><i className="dots" style={{ color: "var(--up)" }} />Call wall {lv.call_wall?.toLocaleString() ?? "-"}</span>
        <span><i className="dots" style={{ color: "var(--down)" }} />Put wall {lv.put_wall?.toLocaleString() ?? "-"}</span>
        <span><i className="dots" style={{ color: "var(--muted)" }} />Min payout {lv.max_pain?.toLocaleString() ?? "-"} · {lv.max_pain_expiry ? new Date(lv.max_pain_expiry * 1000).toISOString().slice(5, 10) : "-"}</span>
        <Info>Open interest on expiries in the next {lv.days} days. Call wall: the strike above the index with the most calls open; put wall: the strike below with the most puts. Minimum payout: the price with the smallest total intrinsic payout at the single displayed expiry. Walls pool the shown window; payout minima are calculated separately per expiry. These are OI concentrations, not support or resistance.</Info>
      </>}
    </div>
  );
}

function OptionsPanel({ opts, und, flow }) {
  const [win, setWin] = useState("24h");
  const exps = opts.strikes?.expiries || {};
  const keys = Object.keys(exps).sort();
  const [sel, setSel] = useState("all");
  const index = opts.features?.index_price || opts.strikes?.index;
  const rows = useMemo(() => {
    if (sel !== "all") return exps[sel] || [];
    const by = new Map();
    keys.forEach((k) => exps[k].forEach((r) => { const t = by.get(r[0]) || [r[0], 0, 0, null, null]; t[1] += r[1]; t[2] += r[2]; by.set(r[0], t); }));
    return [...by.values()].sort((a, b) => a[0] - b[0]);
  }, [sel, opts]);
  const smileKey = sel !== "all" ? sel : keys.find((k) => (Number(k) - opts.ts) / 86400 >= 7) || keys[0];
  const f = opts.features || {};
  const hist = opts.iv_history || [];
  const expLabel = (k) => new Date(Number(k) * 1000).toISOString().slice(5, 10);
  return (
    <>
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        <div id="options-detail"><h2>{und} options</h2><p className="sub">Where open interest sits and what traders pay for protection.</p></div>
        <span className="status">Updated {utc(opts.ts)}</span>
      </div>
      {opts.status !== "ready" && <p className="status warn">{QUALITY_LABEL[opts.status] || "Snapshot quality unavailable"} · values below belong to the displayed snapshot.</p>}
      {opts.chain_status !== "ready" && <p className="status warn">Strike snapshot: {QUALITY_LABEL[opts.chain_status] || "Unavailable"}{opts.chain_at ? ` · ${utc(opts.chain_at)}` : ""}</p>}
      <LeanParts lean={opts.lean} />
      <FlowCoverage coverage={opts.lean?.flow_coverage} />
      <p className="status">Relative skew: {opts.lean?.relative_skew?.percentile == null ? "Building history" : `${opts.lean.relative_skew.percentile.toFixed(0)}th percentile of recorded history`} <Info>Separate from current skew and excluded from the options tone. Requires at least one day of observations with 90% slot coverage. The rank describes only the recorded sample.</Info></p>
      <div className="figs">
        <div className="fig"><span>ATM 7d</span><strong>{pct(f.atm_iv_7d)}</strong></div>
        <div className="fig"><span>ATM 30d</span><strong>{pct(f.atm_iv_30d)}</strong></div>
        <div className="fig"><span>ATM 90d</span><strong>{pct(f.atm_iv_90d)}</strong></div>
        <div className="fig"><span>Skew 30d <Info>25-delta risk reversal: call volatility minus put volatility. Below zero, protection against a fall costs more than upside calls.</Info></span>
          <strong className={f.rr25_30d < 0 ? "down" : "up"}>{f.rr25_30d == null ? "-" : `${f.rr25_30d > 0 ? "+" : ""}${(f.rr25_30d * 100).toFixed(2)}`}</strong></div>
        <div className="fig"><span>Put / call OI <Info>Outstanding put contracts divided by call contracts across live expiries. This does not identify buying versus selling; expiry roll-off also changes the ratio.</Info></span><strong>{f.pc_oi_ratio?.toFixed(2) ?? "-"}</strong></div>
        <div className="fig"><span>Option OI</span><strong>{f.option_oi_contracts ? Math.round(f.option_oi_contracts).toLocaleString() : "-"}</strong></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))", gap: 16 }}>
        <Plate title="Open interest by strike" info="Contracts open at each strike. Puts on the left, calls on the right, the dashed line is the index. Large bars are where positions are concentrated."
          right={<select className="search" style={{ width: "auto" }} value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Expiry">
            <option value="all">All expiries</option>{keys.map((k) => <option key={k} value={k}>{expLabel(k)}</option>)}</select>}>
          <OIWall rows={rows} index={index} />
        </Plate>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Plate title="Term structure" info="At-the-money implied volatility by days to expiry. Short expiries above longer ones mean more volatility is priced near term; this is not a direction reading.">
            <TermStructure expiries={opts.expiries} />
          </Plate>
          <Plate title={`Volatility by strike · ${smileKey ? expLabel(smileKey) : ""}`} info="Implied volatility across strikes for one expiry. A higher left side means downside protection is priced richer.">
            <Smile rows={exps[smileKey]} index={index} />
          </Plate>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))", gap: 16 }}>
        <Plate title="Priced outcomes by date" info="For each expiry: the range holding half of the outcomes option prices imply (thick) and eight in ten (thin), with the middle marked. Market pricing, not a view.">
          <PricedByDate implied={opts.implied} index={index} />
          <ModelDetails implied={opts.implied} />
        </Plate>
        <Plate title="Who is buying" info="Trades that crossed the spread, by side. Takers are the aggressive side: buying calls or selling puts leans up, buying puts or selling calls leans down. Hedges and income selling are mixed in."
          right={<Tabs label="Window" value={win} onChange={setWin} items={[["24h", "24h"], ["7d", "7d"]]} />}>
          <FlowCoverage coverage={flow?.[win]?.coverage} />
          <TakerFlow flow={flow?.[win]} />
        </Plate>
      </div>
      <p className="status">Recorded history: {hist.length ? `${utc(hist[0][0])} to ${utc(hist[hist.length - 1][0])} · ${hist.length} samples` : "Unavailable"}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
        <Plate title="ATM 30d, recorded history"><MiniSeries points={hist.map((h) => [h[0], h[2]])} /></Plate>
        <Plate title="Skew 30d, recorded history"><MiniSeries points={hist.map((h) => [h[0], h[4]])} zero color="var(--sig-exit)" format={(v) => (v * 100).toFixed(1)} /></Plate>
        <Plate title="30-day ATM move scale" info="A simple arithmetic approximation, separate from the per-expiry model ranges: the index plus and minus one standard deviation over 30 days, from 30-day ATM volatility. It describes current option prices, not a view.">
          <PricedRange index={index} iv30={f.atm_iv_30d} />
        </Plate>
      </div>
    </>
  );
}

export default function Coin() {
  const { und } = useParams();
  const { theme } = useOutletContext();
  const { data, error } = useData(`coins/${und}.json`);
  const [tf, setTf] = useState("4h");
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const candles = data.candles[tf] || [];
  const last = candles[candles.length - 1];
  const prevDay = candles[candles.length - 1 - (tf === "4h" ? 6 : 1)];
  const dayChg = last && prevDay ? (last[4] / prevDay[4] - 1) * 100 : null;
  const row = data.latest?.[tf];
  const pos = data.latest?.["4h"]?.positioning;
  return (
    <div className="wrap page">
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <Link to="/markets" className="status">Markets /</Link>
          <h1 style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>{und}
            <span className="mono" style={{ fontSize: 24, fontWeight: 500 }}>{price(last?.[4])}</span>
            <span className={`mono ${dayChg > 0 ? "up" : dayChg < 0 ? "down" : ""}`} style={{ fontSize: 15 }}>{chg(dayChg)} 24h</span></h1>
          <p className="status" style={{ margin: "6px 0 0" }}>Last {tf.toUpperCase()} close in USD. The 24h change uses closed 4H bars.</p>
        </div>
        <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
          <span className="label">Engine 4H + 1D <Signal s={data.latest?.["4h"]?.unified_complete ? data.latest["4h"].unified_signal : null} /></span>
          {data.options && <span className="label">Options <Lean lean={data.options.lean} /></span>}
          <Tabs label="Timeframe" value={tf} onChange={setTf} items={[["4h", "4H"], ["1d", "1D"]]} />
        </div>
      </div>
      <nav className="section-nav" aria-label="Market sections">{data.alignment && <a href="#alignment">Three perspectives</a>}<a href="#price-chart">Price chart</a><a href="#signal-evidence">Engine evidence</a>{data.options && <a href="#options-detail">Options detail</a>}</nav>
      <Readout row={row} />
      {data.alignment && (
        <Plate id="alignment" title="Three perspectives" info={ALIGN_INFO}>
          <AlignmentGrid alignment={data.alignment} />
        </Plate>)}
      <Plate id="price-chart" title={`${und} · ${tf.toUpperCase()}`} info={<>Derive's index price with traded volume. Orange line: fast average; grey: slow. Markers show where the signal changed. {data.backfilled?.[tf] ? `The first ${data.backfilled[tf]} bars come from an external market, before Derive listed ${und}.` : ""}</>}
        right={<span className="status">{row?.signal_bar_close_time ? `Bar closed ${utc(row.signal_bar_close_time)}` : ""}</span>}>
        <CandleChart candles={candles} signals={data.signals?.[tf]} tf={tf} theme={theme} backfilled={data.backfilled?.[tf] || 0}
          implied={data.options?.implied} levels={data.options?.levels} optionsAt={data.options?.ts} optionsIndex={data.options?.features?.index_price} />
        <ChartLegend opts={data.options} tf={tf} last={last?.[4]} />
      </Plate>
      {pos && (
        <div className="figs">
          <div className="fig"><span>Funding, annual</span><strong className={pos.funding_rate < 0 ? "down" : ""}>{pct(pos.funding_rate == null ? null : pos.funding_rate * 24 * 365)}</strong></div>
          <div className="fig"><span>Funding regime</span><strong style={{ fontSize: 14 }}>{title(pos.funding_regime?.replace("_", " "))}</strong></div>
          <div className="fig"><span>Open interest</span><strong>{usd(pos.oi_value)}</strong></div>
          <div className="fig"><span>OI contract change <Info>Contract count and mark-price changes use the same two ticker observations. Dollar OI also moves with price. These measurements do not identify which side opened contracts or establish liquidations.</Info></span><strong style={{ fontSize: 14 }}>{pos.oi_status === "ready" ? chg(pos.oi_change_pct) : "Unavailable"}</strong><small className="dim">{pos.oi_status === "ready" ? `Price ${chg(pos.price_change_pct)} · ${(pos.interval_seconds / 3600).toFixed(1)}h interval` : "Needs two comparable observations"}</small></div>
          <div className="fig"><span>Volume 24h</span><strong>{usd(pos.volume_24h)}</strong></div>
        </div>
      )}
      {data.latest?.[tf]?.signal_reason && (
        <Plate id="signal-evidence" title="Why this signal" info="The engine's own summary of the conditions it checked on the last closed bar.">
          <p className="mono" style={{ margin: 0, fontSize: 12.5, color: "var(--fg-2)", whiteSpace: "pre-wrap" }}>{data.latest[tf].signal_reason}</p>
          <Conditions row={row} />
        </Plate>
      )}
      {data.options ? <OptionsPanel opts={data.options} und={und} flow={data.taker_flow} /> : <p className="status">{und} has no options on Derive.</p>}
    </div>
  );
}
