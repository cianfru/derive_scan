import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { radarPoint, radarLabels, viewReading, traceGeometry } from "../lib/presentation.js";
import { price, usd, z, chg, clock, REGIME } from "../lib/format.js";
import { Tabs, Loading, Failed, PageHead, PanelHead, Empty, Arrow } from "../components/ui.jsx";
import { Asset } from "../components/MarketVisuals.jsx";
import { useElementWidth } from "../lib/useElementWidth.js";

const TONE = { up: "var(--up)", defensive: "var(--down)", neutral: "var(--fg-2)" };
const toneOf = (coin) => viewReading(coin.align, "30d", "engine").state;
const fill = (state) => TONE[state] || "var(--faint)";

const RADAR_HELP = "Across: the 1D engine's price stretch, in standard deviations from its trend. Up: the Smart cohort's net option delta divided by its gross absolute option delta, from −100% to +100%, on expiries inside the selected window (7 or 30 days). Circle area: gross dollar delta exposure, relative to the largest shown; fill: the daily engine's reading. Markets without a current wallet reading sit on the strip above the axis at their price stretch. Exposure, not a count of traders; context side by side, not an entry score.";

/** Places strip labels in up to three rows so neighbours never overlap. */
function stripRows(items, x) {
  const ends = [];
  return [...items].sort((a, b) => a.x - b.x).map((s) => {
    const cx = x(s.x), half = s.und.length * 3.4 + 2;
    let row = ends.findIndex((end) => end < cx - half - 4);
    if (row < 0) row = ends.length < 4 ? ends.length : ends.indexOf(Math.min(...ends));
    ends[row] = cx + half;
    return { ...s, cx, row };
  });
}

export function RadarMap({ points, strip = [], focus, onSelect }) {
  const [box, width] = useElementWidth(780);
  const W = Math.max(300, width), narrow = W < 500;
  const L = narrow ? 44 : 64, R = narrow ? 12 : 24, T = 12;
  const plotH = narrow ? 300 : 380;
  const bound = Math.max(3, ...[...points, ...strip].map((p) => Math.ceil(Math.abs(p.x))));
  const x = (v) => L + ((v + bound) / (2 * bound)) * (W - L - R);
  const plotBottom = T + plotH;
  const stripped = strip.length ? stripRows(strip, x) : [];
  const stripY = plotBottom + 18;
  const stripLevels = stripped.length ? Math.max(...stripped.map((s) => s.row)) + 1 : 0;
  const axisY = strip.length ? stripY + 16 + stripLevels * 13 + 8 : plotBottom + 22;
  const H = axisY + 26;
  const y = (ratio) => T + ((1 - ratio) / 2) * plotH;
  const maxGross = Math.max(1, ...points.map((p) => p.gross));
  const radius = (p) => Math.max(5, 26 * Math.sqrt(p.gross / maxGross));
  const circles = [...points]
    .sort((a, b) => Number(b.coin.und === focus) - Number(a.coin.und === focus) || b.gross - a.gross)
    .map((p) => ({ name: p.coin.und, x: x(p.x), y: y(p.y), r: radius(p) }));
  const labels = new Map(radarLabels(circles, { left: L, right: W - R, top: T, bottom: plotBottom }).map((l) => [l.name, l]));
  const xTicks = narrow ? [-bound, 0, bound] : [-bound, -bound / 2, 0, bound / 2, bound];
  return (
    <div ref={box} className="radar-map-box">
      <svg className="radar-map" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label="Radar: 1D price stretch versus Smart cohort option delta balance">
        {[-1, -0.5, 0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "radar-zero" : "trace-grid"} />
            <text x={L - 10} y={y(v) + 4} textAnchor="end">{v > 0 ? "+" : ""}{v * 100}%</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={T} y2={plotBottom} className={v === 0 ? "radar-zero" : "trace-grid"} />
            <text x={x(v)} y={axisY} textAnchor="middle">{v > 0 ? "+" : ""}{v}</text>
          </g>
        ))}
        <text className="radar-quad" x={L + 10} y={T + 18}>Long delta</text>
        <text className="radar-quad" x={L + 10} y={plotBottom - 10}>Short delta</text>
        <text className="radar-trend" x={L} y={H - 4}>Below trend</text>
        <text className="radar-trend" x={W - R} y={H - 4} textAnchor="end">Above trend</text>
        {stripped.length > 0 && (
          <g className="radar-strip">
            <line x1={L} x2={W - R} y1={stripY} y2={stripY} className="trace-grid" />
            {stripped.map((s) => (
              <g key={s.und} className={`radar-tick ${s.und === focus ? "selected" : ""}`} onClick={() => onSelect(s.und)} aria-hidden="true">
                <title>{`${s.und}: price stretch ${z(s.x)}, no current wallet reading`}</title>
                <circle cx={s.cx} cy={stripY} r="4" fill="var(--plate)" stroke={s.und === focus ? "var(--orange)" : fill(s.state)} strokeWidth={s.und === focus ? 2 : 1.25} />
                <text x={s.cx} y={stripY + 17 + s.row * 13} textAnchor="middle">{s.und}</text>
                <rect x={s.cx - 16} y={stripY - 8} width="32" height={24 + s.row * 13} fill="transparent" />
              </g>
            ))}
          </g>
        )}
        {[...points]
          .sort((a, b) => Number(a.coin.und === focus) - Number(b.coin.und === focus) || b.gross - a.gross)
          .map((p) => {
            const selected = p.coin.und === focus;
            const r = radius(p), cx = x(p.x), cy = y(p.y);
            const tone = fill(toneOf(p.coin));
            const label = labels.get(p.coin.und);
            const half = p.coin.und.length * 3.6 + 3;
            const homeX = cx + r + half + 6, homeY = cy + 4;
            const displaced = Math.hypot(label.x - homeX, label.y - homeY) > 24;
            const dx = label.x - cx, dy = label.y - 4 - cy, distance = Math.hypot(dx, dy) || 1;
            return (
              <g key={p.coin.und} className={`radar-point ${selected ? "selected" : ""}`}>
                {displaced && <line x1={cx + (dx / distance) * r} y1={cy + (dy / distance) * r} x2={label.x - Math.sign(dx) * half} y2={label.y - 4} stroke="var(--faint)" strokeWidth=".75" pointerEvents="none" />}
                <circle cx={cx} cy={cy} r={Math.max(16, r + 5)} fill="transparent" aria-hidden="true" onClick={() => onSelect(p.coin.und)} />
                {selected && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--orange)" strokeOpacity=".22" strokeWidth="4" pointerEvents="none" />}
                <circle className="radar-dot" cx={cx} cy={cy} r={r} fill={tone} fillOpacity=".25" stroke={selected ? "var(--orange)" : tone} strokeWidth={selected ? 2 : 1} aria-hidden="true" onClick={() => onSelect(p.coin.und)} />
                <g role="button" tabIndex="0" aria-pressed={selected}
                  aria-label={`${p.coin.und}, price stretch ${p.x.toFixed(2)}, option delta balance ${(p.y * 100).toFixed(1)}%, gross exposure ${usd(p.gross)}`}
                  onClick={() => onSelect(p.coin.und)}
                  onKeyDown={(e) => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); onSelect(p.coin.und); } }}>
                  <rect x={label.rect.left} y={label.rect.top} width={label.rect.right - label.rect.left} height={label.rect.bottom - label.rect.top} fill="transparent" />
                  <text x={label.x} y={label.y} textAnchor="middle">{p.coin.und}</text>
                </g>
              </g>
            );
          })}
      </svg>
    </div>
  );
}

/** Daily closes across the full rail width, change at its end. */
function RailTrace({ values, label }) {
  const [box, width] = useElementWidth(300);
  const W = Math.max(160, width), H = 56, room = 58;
  const g = traceGeometry(values, W - room, H, 3);
  if (!g) return <div ref={box} className="rd-trace" />;
  const tone = g.change > 0 ? "up" : g.change < 0 ? "down" : "muted";
  return (
    <div ref={box} className="rd-trace">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label}: ${chg(g.change, 1)}`}>
        <line x1={g.x(g.first)} y1={g.y(values[g.first])} x2={g.x(g.last)} y2={g.y(values[g.first])} className="trace-baseline" />
        <path d={g.path} fill="none" stroke={`var(--${tone})`} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={g.x(g.last)} cy={g.y(values[g.last])} r="2.5" fill={`var(--${tone})`} />
        <text x={W} y={g.y(values[g.last]) + 4} textAnchor="end" className={tone}>{chg(g.change, 1)}</text>
      </svg>
    </div>
  );
}

const KINDS = [["engine", "Engine"], ["options", "Options"], ["wallets", "Wallets"]];

// The number under a reading: z for the engine, skew points for options, delta balance for wallets.
function readingNumber(c, kind, r) {
  if (!r.state) return null;
  if (kind === "engine") return Number.isFinite(c.z_1d) ? z(c.z_1d) : null;
  if (kind === "options") {
    const rr = c.options?.rr25_30d;
    return Number.isFinite(rr) ? `${rr > 0 ? "+" : rr < 0 ? "−" : ""}${Math.abs(rr * 100).toFixed(1)} pts` : null;
  }
  const s = r.row?.score;
  return Number.isFinite(s) ? `${s > 0 ? "+" : s < 0 ? "−" : ""}${Math.abs(s * 100).toFixed(0)}%` : null;
}

export default function Radar() {
  const { data, error } = useData("markets.json");
  const [params, setParams] = useSearchParams();
  const detailRef = useRef(null);
  const horizon = params.get("window") === "7d" ? "7d" : "30d";
  const coins = (data?.coins || []).filter((c) => c.has_options).sort((a, b) => (b.oi_usd || 0) - (a.oi_usd || 0));
  const selected = coins.find((c) => c.und === params.get("focus")) || coins.find((c) => c.und === "BTC") || coins[0];
  const choose = (key, value) => {
    const p = new URLSearchParams(params); p.set(key, value); setParams(p, { replace: true });
    if (key === "focus" && window.matchMedia("(max-width: 900px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    }
  };
  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const points = coins.map((c) => radarPoint(c, horizon)).filter(Boolean);
  const plotted = new Set(points.map((p) => p.coin.und));
  // Only coins whose daily engine reading is current go on the strip; a withheld reading has no stretch to show.
  const strip = coins.filter((c) => !plotted.has(c.und) && Number.isFinite(c.z_1d) && viewReading(c.align, "30d", "engine").state)
    .map((c) => ({ und: c.und, x: c.z_1d, state: toneOf(c) }));
  const selectedPoint = selected && radarPoint(selected, horizon);
  const engineOk = selected && viewReading(selected.align, "30d", "engine").state && Number.isFinite(selected.z_1d);
  const tabs = <Tabs label="Wallet expiry window" value={horizon} onChange={(v) => choose("window", v)} items={[["7d", "Within 7 days", "7 days"], ["30d", "Within 30 days", "30 days"]]} />;

  return (
    <div className="wrap page radar-page">
      <PageHead title="Radar" info={RADAR_HELP} tabs={tabs} meta={<>{coins.length} markets · {clock(data.generated_at)}</>} />
      <div className="plate radar-workspace">
        <section className="radar-stage" aria-label="Positioning map">
          <PanelHead title="Positioning map" right={<span className="radar-count" title="Markets with a current Smart wallet reading">{points.length}/{coins.length}</span>} />
          {points.length || strip.length
            ? <RadarMap points={points} strip={strip} focus={selected?.und} onSelect={(v) => choose("focus", v)} />
            : <div className="radar-empty"><Empty /></div>}
        </section>
        {selected && (
          <aside ref={detailRef} className="radar-detail" aria-live="polite" aria-label={`${selected.und} radar detail`}>
            <div className="rd-coin">
              <Asset und={selected.und} compact />
              <span className="rd-price">${price(selected.price)}</span>
            </div>
            <Link to={`/coin/${selected.und}`} className="rd-trace-link" aria-label={`Open ${selected.und} chart`}>
              <RailTrace values={selected.spark_1d} label={`${selected.und} daily closes`} />
            </Link>
            <div className="rd-figs">
              <div><span>1D stretch</span><b>{engineOk ? z(selected.z_1d) : <Empty />}</b></div>
              <div><span>Delta balance</span><b>{selectedPoint ? `${(selectedPoint.y * 100).toFixed(0)}%` : <Empty />}</b></div>
              <div><span>Gross delta</span><b>{selectedPoint ? usd(selectedPoint.gross) : <Empty />}</b></div>
            </div>
            <div className="rd-readings">
              {KINDS.map(([kind, name]) => {
                const r = viewReading(selected.align, horizon, kind);
                const sub = kind === "engine" && r.state && r.row?.regime ? REGIME[r.row.regime] : readingNumber(selected, kind, r);
                return (
                  <div key={kind}>
                    <span>{name}</span>
                    <b className={`tone-${r.state || "unknown"}`} title={r.state ? undefined : r.label}>{r.state ? r.label : "—"}</b>
                    {sub && <small>{sub}</small>}
                  </div>
                );
              })}
            </div>
            <Link className="rd-open" to={`/coin/${selected.und}`}>Open {selected.und}<Arrow /></Link>
          </aside>
        )}
      </div>
      <section className="plate radar-list" aria-label="Market readings">
        <PanelHead title="Market readings" />
        <div className="rl-head" aria-hidden="true"><span>Market</span><span>Engine</span><span>Options</span><span>Wallets</span></div>
        {coins.map((c) => (
          <button className="rl-row" key={c.und} aria-pressed={c.und === selected?.und} onClick={() => choose("focus", c.und)}>
            <Asset und={c.und} compact />
            {KINDS.map(([kind, name]) => {
              const r = viewReading(c.align, horizon, kind);
              const n = readingNumber(c, kind, r);
              return (
                <span key={kind} className="rl-read" data-key={name}>
                  {r.state ? <b className={`tone-${r.state}`}>{r.label}</b> : <b className="tone-unknown" title={r.label}>—</b>}
                  {n && <small>{n}</small>}
                </span>
              );
            })}
          </button>
        ))}
      </section>
    </div>
  );
}
