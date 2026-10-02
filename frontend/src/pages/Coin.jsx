import { useMemo, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { price, chg, pct, usd, title, utc, REGIME, DATA_LABEL } from "../lib/format.js";
import { Signal, Tabs, Plate, Loading, Failed, Info } from "../components/ui.jsx";
import CandleChart from "../components/CandleChart.jsx";
import { OIWall, Smile, TermStructure, MiniSeries, PricedRange, PricedByDate, TakerFlow } from "../components/OptionsViz.jsx";

function Readout({ row }) {
  if (!row) return <p className="status">No signal yet.</p>;
  const z = Math.max(-3, Math.min(3, row.zscore || 0));
  return (
    <div className="figs">
      <div className="fig"><span>Signal</span><Signal s={row.signal} /></div>
      <div className="fig"><span>Regime</span><strong style={{ fontSize: 15 }}>{REGIME[row.regime] || title(row.regime)}</strong></div>
      <div className="fig"><span>Z-score <Info>How far price sits from its trend, in standard deviations. Above 2.5 is stretched.</Info></span>
        <span className="meter" style={{ textTransform: "none" }}><i className="center"><b style={{ left: `${50 + Math.min(0, z) / 3 * 50}%`, width: `${Math.abs(z) / 3 * 50}%`, background: "var(--sig-strong)" }} /></i>
          <strong style={{ fontSize: 15 }}>{(row.zscore ?? 0).toFixed(2)}</strong></span></div>
      <div className="fig"><span>Heat <Info>Distance from the long-term base, 0 to 100. High heat means extended.</Info></span>
        <span className="meter" style={{ textTransform: "none" }}><i><b style={{ left: 0, width: `${Math.min(100, row.heat || 0)}%` }} /></i>
          <strong style={{ fontSize: 15 }}>{row.heat ?? "-"}</strong></span></div>
      <div className="fig"><span>Exhaustion</span><strong style={{ fontSize: 15 }}>{title(row.exhaustion_state)}</strong></div>
      <div className="fig"><span>Ribbon <Info>Trend structure from four moving averages. Gold: stacked up. Blue: stacked down. Grey: no clear order.</Info></span>
        <strong style={{ fontSize: 15, color: row.ribbon?.state === "gold" ? "var(--orange)" : row.ribbon?.state === "blue" ? "var(--sig-exit)" : "var(--muted)" }}>{title(row.ribbon?.state)}</strong></div>
      <div className="fig"><span>Conditions</span><strong style={{ fontSize: 15 }}>{row.conditions_met ?? "-"} / {row.conditions_total ?? "-"}</strong></div>
      <div className="fig"><span>Data</span><strong style={{ fontSize: 13, color: row.data_status === "ready" ? "var(--fg)" : "var(--sig-acc)" }}>{DATA_LABEL[row.data_status] || "-"}</strong></div>
    </div>
  );
}

const HORIZON_DAYS = { "4h": 21, "1d": 120 };
const LEAN = { defensive: ["Defensive", "down"], neutral: ["Neutral", ""], up: ["Leaning up", "up"] };
const LEAN_PARTS = [["skew", "Skew vs its range"], ["flow", "Taker premium, 7d"], ["put_call", "Put/call OI, 7d change"], ["term", "Short vs 30d volatility"]];
const LEAN_INFO = "How options positioning reads now, beside the engine's signal and separate from it. Four readings, each from defensive to leaning up: skew against its own recent range, which side takers paid premium for over 7 days (market makers left out), whether puts or calls were added to open interest, and whether short-dated volatility sits above 30-day. Context, not a signal.";

function Lean({ lean }) {
  const [label, cls] = LEAN[lean?.state] || ["Building", "faint"];
  return <strong className={cls} style={{ fontSize: 15 }}>{label}</strong>;
}

function LeanParts({ lean }) {
  return (
    <div className="figs">
      <div className="fig"><span>Options lean <Info>{LEAN_INFO}</Info></span><Lean lean={lean} /></div>
      {LEAN_PARTS.map(([k, label]) => {
        const v = lean?.parts?.[k];
        return (
          <div className="fig" key={k}><span>{label}</span>
            <span className="meter" style={{ textTransform: "none" }}><i className="center">{v != null && <b style={{ left: `${50 + Math.min(0, v) * 50}%`, width: `${Math.abs(v) * 50}%`, background: v < 0 ? "var(--down)" : "var(--up)" }} />}</i>
              <strong style={{ fontSize: 13 }} className={v == null ? "faint" : ""}>{v == null ? "Building" : v > 0.2 ? "Up" : v < -0.2 ? "Defensive" : "Neutral"}</strong></span></div>);
      })}
    </div>
  );
}

function ChartLegend({ opts, tf, last }) {
  const cone = (opts?.implied || []).filter((e) => e.days <= HORIZON_DAYS[tf]);
  const lv = opts?.levels;
  if (!cone.length && !lv) return null;
  const end = cone[cone.length - 1];
  const rel = (v) => `${v >= last ? "+" : ""}${((v / last - 1) * 100).toFixed(1)}%`;
  return (
    <div className="chart-legend">
      {end && <>
        <span>Priced range to {new Date(end.expiry * 1000).toISOString().slice(5, 10)}</span>
        <span><i style={{ background: "var(--up)" }} /><b className="up">{rel(end.q[3])}</b></span>
        <span><i style={{ background: "var(--down)" }} /><b className="down">{rel(end.q[1])}</b></span>
        <Info>Option prices across all strikes imply a spread of outcomes for each expiry. The shaded areas hold the middle half of them: a quarter above the green edge, a quarter below the red one. A green area larger than the red one means calls are paying for more upside than puts for downside, and the reverse. Market pricing, not a view; options tend to over-price large moves.</Info>
      </>}
      {lv && <>
        <span><i className="dots" style={{ color: "var(--up)" }} />Call wall {lv.call_wall?.toLocaleString() ?? "-"}</span>
        <span><i className="dots" style={{ color: "var(--down)" }} />Put wall {lv.put_wall?.toLocaleString() ?? "-"}</span>
        <span><i className="dots" style={{ color: "var(--muted)" }} />Max pain {lv.max_pain?.toLocaleString() ?? "-"}</span>
        <Info>Open interest on expiries in the next {lv.days} days. Call wall: the strike above the index with the most calls open; put wall: the strike below with the most puts. Max pain: the price at which option holders together would be paid least at expiry. These are positions, often watched as levels near expiry.</Info>
      </>}
    </div>
  );
}

function OptionsPanel({ opts, und, flow }) {
  const [win, setWin] = useState("24h");
  const exps = opts.strikes?.expiries || {};
  const keys = Object.keys(exps).sort();
  const [sel, setSel] = useState("all");
  const index = opts.strikes?.index || opts.features?.index_price;
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
        <div><h2>{und} options</h2><p className="sub">Where open interest sits and what traders pay for protection.</p></div>
        <span className="status">Updated {utc(opts.ts)}</span>
      </div>
      <LeanParts lean={opts.lean} />
      <div className="figs">
        <div className="fig"><span>ATM 7d</span><strong>{pct(f.atm_iv_7d)}</strong></div>
        <div className="fig"><span>ATM 30d</span><strong>{pct(f.atm_iv_30d)}</strong></div>
        <div className="fig"><span>ATM 90d</span><strong>{pct(f.atm_iv_90d)}</strong></div>
        <div className="fig"><span>Skew 30d <Info>25-delta risk reversal: call volatility minus put volatility. Below zero, protection against a fall costs more than upside calls.</Info></span>
          <strong className={f.rr25_30d < 0 ? "down" : "up"}>{f.rr25_30d == null ? "-" : `${f.rr25_30d > 0 ? "+" : ""}${(f.rr25_30d * 100).toFixed(2)}`}</strong></div>
        <div className="fig"><span>Put / call OI</span><strong>{f.pc_oi_ratio?.toFixed(2) ?? "-"}</strong></div>
        <div className="fig"><span>Option OI</span><strong>{f.option_oi_contracts ? Math.round(f.option_oi_contracts).toLocaleString() : "-"}</strong></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))", gap: 16 }}>
        <Plate title="Open interest by strike" info="Contracts open at each strike. Puts on the left, calls on the right, the dashed line is the index. Large bars are where positions are concentrated."
          right={<select className="search" style={{ width: "auto" }} value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Expiry">
            <option value="all">All expiries</option>{keys.map((k) => <option key={k} value={k}>{expLabel(k)}</option>)}</select>}>
          <OIWall rows={rows} index={index} />
        </Plate>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Plate title="Term structure" info="At-the-money implied volatility by days to expiry. Rising to the right is the usual shape; short expiries above long ones mean stress now.">
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
        </Plate>
        <Plate title="Who is buying" info="Trades that crossed the spread, by side. Takers are the aggressive side: buying calls or selling puts leans up, buying puts or selling calls leans down. Hedges and income selling are mixed in."
          right={<Tabs label="Window" value={win} onChange={setWin} items={[["24h", "24h"], ["7d", "7d"]]} />}>
          <TakerFlow flow={flow?.[win]} />
        </Plate>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
        <Plate title="ATM 30d, last 14 days"><MiniSeries points={hist.map((h) => [h[0], h[2]])} /></Plate>
        <Plate title="Skew 30d, last 14 days"><MiniSeries points={hist.map((h) => [h[0], h[4]])} zero color="var(--sig-exit)" format={(v) => (v * 100).toFixed(1)} /></Plate>
        <Plate title="Priced 30-day range" info="What option prices imply: the index plus and minus one standard deviation over 30 days, from 30-day ATM volatility. It describes current option prices, not a view.">
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
        </div>
        <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
          <span className="label">Combined <Signal s={data.latest?.["4h"]?.unified_signal} /></span>
          {data.options && <span className="label">Options <Lean lean={data.options.lean} /></span>}
          <Tabs label="Timeframe" value={tf} onChange={setTf} items={[["4h", "4H"], ["1d", "1D"]]} />
        </div>
      </div>
      <Readout row={row} />
      <Plate title={`${und} · ${tf.toUpperCase()}`} info={<>Derive's index price with traded volume. Orange line: fast average; grey: slow. Markers show where the signal changed. {data.backfilled?.[tf] ? `The first ${data.backfilled[tf]} bars come from an external market, before Derive listed ${und}.` : ""}</>}
        right={<span className="status">{row?.signal_bar_close_time ? `Bar closed ${utc(row.signal_bar_close_time)}` : ""}</span>}>
        <CandleChart candles={candles} signals={data.signals?.[tf]} tf={tf} theme={theme} backfilled={data.backfilled?.[tf] || 0}
          implied={data.options?.implied} levels={data.options?.levels} />
        <ChartLegend opts={data.options} tf={tf} last={last?.[4]} />
      </Plate>
      {pos && (
        <div className="figs">
          <div className="fig"><span>Funding, annual</span><strong className={pos.funding_rate < 0 ? "down" : ""}>{pct(pos.funding_rate * 24 * 365)}</strong></div>
          <div className="fig"><span>Funding regime</span><strong style={{ fontSize: 14 }}>{title(pos.funding_regime?.replace("_", " "))}</strong></div>
          <div className="fig"><span>Open interest</span><strong>{usd(pos.oi_value)}</strong></div>
          <div className="fig"><span>OI trend</span><strong style={{ fontSize: 14 }}>{title(pos.oi_trend)}</strong></div>
          <div className="fig"><span>Volume 24h</span><strong>{usd(pos.volume_24h)}</strong></div>
        </div>
      )}
      {data.latest?.[tf]?.signal_reason && (
        <Plate title="Why this signal" info="The engine's own summary of the conditions it checked on the last closed bar.">
          <p className="mono" style={{ margin: 0, fontSize: 12.5, color: "var(--fg-2)", whiteSpace: "pre-wrap" }}>{data.latest[tf].signal_reason}</p>
        </Plate>
      )}
      {data.options ? <OptionsPanel opts={data.options} und={und} flow={data.taker_flow} /> : <p className="status">{und} has no options on Derive.</p>}
    </div>
  );
}
