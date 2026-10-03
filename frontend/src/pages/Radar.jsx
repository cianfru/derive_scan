import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { radarPoint, radarLabels, viewReading, WINDOWS } from "../lib/presentation.js";
import { price, usd, utc } from "../lib/format.js";
import { Tabs, Info, Loading, Failed } from "../components/ui.jsx";
import { Asset, ThreeReadings, MarketTrace } from "../components/MarketVisuals.jsx";
import { useElementWidth } from "../lib/useElementWidth.js";
import { coverageReady } from "../components/HistoryStatus.jsx";

export function RadarMap({ points, focus, onSelect }) {
  const [box, width] = useElementWidth(780);
  const W = Math.max(320, width - 32), H = W < 500 ? 360 : 440, L = W < 500 ? 52 : 76, R = 30, T = 40, B = 64;
  const bound = Math.max(3, ...points.map(p => Math.ceil(Math.abs(p.x))));
  const maxGross = Math.max(1, ...points.map(p => p.gross));
  const x = z => L + (z + bound) / (2 * bound) * (W - L - R);
  const y = ratio => T + (1 - ratio) / 2 * (H - T - B);
  const circles = [...points].sort((a, b) => Number(b.coin.und === focus) - Number(a.coin.und === focus) || b.gross - a.gross)
    .map(p => ({ name: p.coin.und, x: x(p.x), y: y(p.y), r: 26 * Math.sqrt(p.gross / maxGross) }));
  const labels = new Map(radarLabels(circles, { left: L, right: W - R, top: T, bottom: H - B }).map(l => [l.name, l]));
  return <div ref={box}><svg className="radar-map" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Radar: 1D price stretch versus Smart cohort option delta balance">
    <rect x={L} y={T} width={(W-L-R)/2} height={(H-T-B)/2} fill="var(--up)" fillOpacity=".025"/><rect x={x(0)} y={y(0)} width={(W-L-R)/2} height={(H-T-B)/2} fill="var(--down)" fillOpacity=".025"/><text x={L} y="18" className="radar-axis-title">Smart cohort option delta balance</text>
    {[-1, -.5, 0, .5, 1].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "radar-zero" : "trace-grid"} /><text x={L - 12} y={y(v) + 4} textAnchor="end">{v > 0 ? "+" : ""}{v * 100}%</text></g>)}
    {(W < 500 ? [-bound, 0, bound] : [-bound, -bound / 2, 0, bound / 2, bound]).map(v => <g key={v}><line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className={v === 0 ? "radar-zero" : "trace-grid"} /><text x={x(v)} y={H - B + 24} textAnchor="middle">{v > 0 ? "+" : ""}{v}</text></g>)}
    {W >= 500 && <text x={L} y={H - 7}>Below trend</text>}<text x={(W + L - R) / 2} y={H - 7} textAnchor="middle">Daily price stretch (z-score)</text>{W >= 500 && <text x={W - R} y={H - 7} textAnchor="end">Above trend</text>}
    {[...points].sort((a, b) => Number(a.coin.und === focus) - Number(b.coin.und === focus) || b.gross - a.gross).map(p => {
      const selected = p.coin.und === focus;
      const r = 26 * Math.sqrt(p.gross / maxGross);
      const label = labels.get(p.coin.und);
      const dx = label.x - x(p.x), dy = label.y - 4 - y(p.y), distance = Math.hypot(dx, dy);

      return <g key={p.coin.und} className={`radar-point ${selected ? "selected" : ""}`}>
        {distance > r + 20 && <line x1={x(p.x) + dx / distance * r} y1={y(p.y) + dy / distance * r} x2={label.x} y2={label.y - 4} stroke="var(--faint)" strokeWidth=".7" pointerEvents="none" />}
        <circle cx={x(p.x)} cy={y(p.y)} r={Math.max(18, r + 5)} fill="transparent" stroke="none" aria-hidden="true" onClick={() => onSelect(p.coin.und)} />
        <circle className="radar-dot" cx={x(p.x)} cy={y(p.y)} r={r} fill="var(--orange)" fillOpacity={selected ? .3 : .12} stroke="var(--orange)" strokeWidth={selected ? 2 : 1} aria-hidden="true" onClick={() => onSelect(p.coin.und)} />
        <g role="button" tabIndex="0" aria-pressed={selected}
          aria-label={`${p.coin.und}, price stretch ${p.x.toFixed(2)}, option delta balance ${(p.y * 100).toFixed(1)}%, gross exposure ${usd(p.gross)}`}
          onClick={() => onSelect(p.coin.und)} onKeyDown={e => {if (["Enter", " "].includes(e.key)) {e.preventDefault(); onSelect(p.coin.und);}}}>
          <rect x={label.rect.left} y={label.rect.top} width={label.rect.right - label.rect.left} height={label.rect.bottom - label.rect.top} fill="transparent" />
          <text x={label.x} y={label.y} textAnchor="middle">{p.coin.und}</text>
        </g>
      </g>;
    })}
  </svg></div>;
}

export default function Radar() {
  const { data, error } = useData("markets.json");
  const [params, setParams] = useSearchParams();
  const detailRef = useRef(null);
  const horizon = params.get("window") === "7d" ? "7d" : "30d";
  const coins = (data?.coins || []).filter(c => c.has_options).sort((a, b) => (b.oi_usd || 0) - (a.oi_usd || 0));
  const selected = coins.find(c => c.und === params.get("focus")) || coins.find(c => c.und === "BTC") || coins[0];
  const choose = (key, value) => {
    const p = new URLSearchParams(params); p.set(key, value); setParams(p, { replace: true });
    if (key === "focus" && window.matchMedia("(max-width: 800px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  };
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const points = coins.map(c => radarPoint(c, horizon)).filter(Boolean);
  const expiredQuotes = coins.filter(c => viewReading(c.align, horizon, "wallets").label === "Stale reading").length;
  const ready = coins.some(c => coverageReady(c.align?.wallet_coverage));
  const selectedPoint = selected && radarPoint(selected, horizon);
  const through = selected?.align?.wallet_coverage?.through;
  const expected = selected?.align?.wallet_coverage?.expected_through;
  return <div className="wrap page radar-page">
    <div className="page-heading"><div><h1>Radar <Info label="How to read the radar">Across: price stretch on the 1D engine, in standard deviations from its trend. Up: the Smart cohort’s net option delta divided by gross absolute option delta, from −100% to +100%. Circle area: gross dollar delta exposure, relative to the largest shown. This is exposure, not a count of bullish traders. History, fresh quoted deltas and the existing minimum exposure checks must pass. Options tone remains a separate reading in the detail panel. This map is a research view; it does not create an entry score.</Info></h1><p className="sub">Price structure meets wallet positioning. Select a market to inspect all three perspectives.</p></div><div className="radar-window"><span className="label">Wallet expiry window</span><Tabs label="Wallet expiry window" value={horizon} onChange={v => choose("window", v)} items={[["7d", "Within 7 days"], ["30d", "Within 30 days"]]} /></div></div>
    <div className="radar-workspace">
      <section className="radar-stage" aria-label="Positioning map">
        <div className="stage-head"><h2>Positioning map</h2><span className="status">{points.length} / {coins.length} markets eligible</span></div>
        {points.length ? <RadarMap points={points} focus={selected?.und} onSelect={v => choose("focus", v)} /> : <div className="radar-empty">
          <svg viewBox="0 0 112 72" width="112" height="72" fill="none" aria-hidden="true"><path d="M8 36h96M56 4v64" stroke="var(--seam-hi)" /><path d="M8 4v64M104 4v64M8 4h96M8 68h96" stroke="var(--seam)" strokeDasharray="3 5"/><path d="M32 44h48M32 28h48" stroke="var(--orange)" strokeWidth="2"/></svg>
          <h2>{ready && expiredQuotes === coins.length ? "The quote snapshot needs refreshing" : ready ? "No markets meet the plotting checks" : "The wallet picture is still building"}</h2>
          <p>{ready && expiredQuotes === coins.length ? "Wallet history is available, but its quote valuations are over 30 minutes old. The map updates when the next valid snapshot is published." : ready ? "The map needs a current 1D engine reading and sufficient option exposure valued with fresh quoted deltas." : "Positions will appear as wallet history catches up. You can already explore price structure and the available options evidence."}</p>
          {through && <div className="history-dates"><span>Processed through<strong>{through}</strong></span><span>Required through<strong>{expected || "Latest UTC close"}</strong></span></div>}
          <Link className="text-link" to="/traders">See wallet collection status</Link>
        </div>}
        <div className="map-reading-key"><span><b>Upper half</b> Smart options book is long delta</span><span><b>Lower half</b> Smart options book is short delta</span><span><b>Left / right</b> Price below / above its daily trend</span></div><div className="stage-foot"><span>Horizontal: 1D price stretch</span><span>Vertical: option delta balance</span><span>Area: gross delta exposure</span></div>
      </section>
      {selected && <aside ref={detailRef} className="radar-detail" aria-live="polite" aria-label={`${selected.und} radar detail`}>
        <div className="detail-heading"><Asset und={selected.und} /><strong>${price(selected.price)}</strong></div>
        <Link to={`/coin/${selected.und}`} className="detail-trace" aria-label={`Open ${selected.und} chart`}><MarketTrace values={selected.spark_1d} label={`${selected.und} recent closes`} /><span className="status">Recent daily closes</span></Link>
        <div className="radar-measures"><div><span>1D price stretch <Info>Standard deviations from the engine’s trend. A missing or stale engine reading is withheld from the map.</Info></span><strong>{viewReading(selected.align, "30d", "engine").state && Number.isFinite(selected.z_1d) ? `${selected.z_1d > 0 ? "+" : ""}${selected.z_1d.toFixed(2)}σ` : "Unavailable"}</strong></div><div><span>Smart option delta balance</span><strong>{selectedPoint ? `${(selectedPoint.y * 100).toFixed(1)}%` : viewReading(selected.align, horizon, "wallets").label}</strong></div><div><span>Gross delta exposure</span><strong>{selectedPoint ? usd(selectedPoint.gross) : "Unavailable"}</strong></div></div>
        <ThreeReadings alignment={selected.align} horizon={horizon} />
        <Link className="btn primary" to={`/coin/${selected.und}#wallets`}>Explore {selected.und}</Link>
        <Link className="text-link" to="/traders">Explore trader cohorts</Link>
      </aside>}
    </div>
    <section className="radar-market-list"><div className="section-heading"><div><h2>Market readings</h2><p className="sub">Choose a market here or on the map.</p></div><span className="status">{WINDOWS[horizon].name}</span></div>
      <div className="radar-list-head"><span>Market</span><span>Engine</span><span>Option prices</span><span>Smart wallets</span></div>
      {coins.map(c => <button className="radar-market" key={c.und} aria-pressed={c.und === selected?.und} onClick={() => choose("focus", c.und)}><Asset und={c.und} compact />{["engine", "options", "wallets"].map(k => { const r = viewReading(c.align, horizon, k); return <span key={k} className={`reading-value ${r.state || "unknown"}`}><small>{k === "engine" ? "Engine" : k === "options" ? "Options" : "Wallets"}</small>{r.label}</span>; })}</button>)}
    </section>
    <p className="status">Snapshot {utc(data.generated_at)}. Smart is the existing historically ranked cohort; Derive’s general leaderboard is not used as a skill score.</p>
  </div>;
}
