import { useState } from "react";
import { ASSET_NAMES, traceGeometry, viewReading, WINDOWS } from "../lib/presentation.js";
import { price, chg, utc, REGIME } from "../lib/format.js";
import { useElementWidth } from "../lib/useElementWidth.js";
import { SIGNAL_HELP, REGIME_HELP, READING_HELP } from "../lib/explain.js";
import { Info } from "./ui.jsx";

export function Asset({ und, compact = false }) {
  const ext = ["HYPE", "PUMP"].includes(und) ? "jpg" : ["CC", "LIT", "VVV"].includes(und) ? "png" : "svg";
  return <span className="asset"><img className="asset-icon" src={`/coins/${und}.${ext}`} alt="" width="34" height="34" /><span><b>{und}</b>{!compact && <small>{ASSET_NAMES[und] || "Derive market"}</small>}</span></span>;
}
export function Reading({ alignment, horizon = "30d", kind, detail = false }) {
  const { state, label, row } = viewReading(alignment, horizon, kind);
  return <span className="reading"><span className={`reading-value ${state || "unknown"}`}>{label}<Info label={`Explain ${kind === "engine" ? "daily engine" : kind === "wallets" ? "Smart wallets" : "options tone"}`}>{READING_HELP[kind]} {kind === "engine" && !state && row?.history_bars != null ? `The last engine evaluation used ${row.history_bars} bars. Full price normalisation needs 499; external history can extend price but never Derive volume. Open the market for its history sources.` : ""} {kind === "engine" && state && SIGNAL_HELP[row?.signal]} {kind === "engine" && state && REGIME_HELP[row?.regime]} {row?.observed_at ? `Observed ${utc(row.observed_at)}.` : ''}</Info></span>{kind === "engine" && state && row?.regime && <small>{REGIME[row.regime]}</small>}{detail && <small>{WINDOWS[horizon][kind]}</small>}</span>;
}
export function ThreeReadings({ alignment, horizon = "30d" }) {
  return <div className="three-readings">{[["engine", "Engine"], ["options", "Option prices"], ["wallets", "Smart wallets"]].map(([kind, label]) => <div key={kind}><span className="label">{label}</span><Reading alignment={alignment} horizon={horizon} kind={kind} detail /></div>)}</div>;
}

export function MarketTrace({ values, times, label = "Price history", large = false }) {
  const [active, setActive] = useState(null);
  const [figure, width] = useElementWidth(620);
  const W = large ? Math.max(280, Math.min(620, width)) : 136, H = large ? (W < 400 ? 190 : 230) : 38;
  const g = traceGeometry(values, large ? W - 66 : W, large ? H - 24 : H, large ? 10 : 3);
  if (!g) return <span className="status">History unavailable</span>;
  const at = Number.isInteger(active) && Number.isFinite(values[active]) ? active : g.last;
  const stamp = times?.[at];
  const dt = t => new Date(t * 1000).toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });
  const change = g.change;
  const tone = change > 0 ? "up" : change < 0 ? "down" : "dim";
  const pick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * W;
    const nearest = Math.round((px - 10) / (W - 86) * (values.length - 1));
    setActive(Math.max(0, Math.min(values.length - 1, nearest)));
  };
  const key = event => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActive(event.key === "Home" ? g.first : event.key === "End" ? g.last : Math.max(0, Math.min(values.length - 1, at + (event.key === "ArrowRight" ? 1 : -1))));
    }
  };
  return <figure ref={figure} className={`market-trace ${large ? "expanded" : "compact"}`}>
    {large && <figcaption><span>{active === null ? "Latest recorded close" : "Selected close"}<strong>${price(values[at])}</strong></span><span className="trace-caption-right"><b className={tone}>{chg(change)}</b><small>Across shown samples</small></span></figcaption>}
    <svg viewBox={`0 0 ${W} ${H}`} width={large ? undefined : W} height={large ? undefined : H} role={large ? "slider" : "img"}
      aria-label={large ? `${label}. Use arrow keys to explore closes.` : `${label}: ${chg(change)} across ${values.length} samples. Dashed line is the first close.`}
      aria-valuemin={large ? 1 : undefined} aria-valuemax={large ? values.length : undefined} aria-valuenow={large ? at + 1 : undefined}
      aria-valuetext={large ? `$${price(values[at])}${stamp ? `, ${utc(stamp)}` : ""}` : undefined} tabIndex={large ? 0 : undefined}
      onPointerMove={large ? pick : undefined} onPointerLeave={large ? () => setActive(null) : undefined} onKeyDown={large ? key : undefined} onBlur={large ? () => setActive(null) : undefined}>
      <title>{label}</title>
      {large && [g.lo, g.hi].map((v, i) => <g key={i}><line x1="10" y1={g.y(v)} x2={W - 68} y2={g.y(v)} className="trace-grid" /><text x={W - 1} y={g.y(v) + 4} textAnchor="end">{price(v)}</text></g>)}
      <line x1={g.x(g.first)} y1={g.y(values[g.first])} x2={g.x(g.last)} y2={g.y(values[g.first])} className="trace-baseline" />
      <path d={g.path} fill="none" stroke={large ? "var(--orange)" : `var(--${tone === "dim" ? "muted" : tone})`} strokeWidth={large ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" />
      {large && active !== null && <line x1={g.x(at)} x2={g.x(at)} y1="5" y2={H - 20} className="trace-crosshair" />}
      <circle cx={g.x(at)} cy={g.y(values[at])} r={large ? 4 : 2} fill={large ? "var(--orange)" : `var(--${tone === "dim" ? "muted" : tone})`} stroke="var(--plate)" strokeWidth="2" />
      {large && times?.length === values.length && <><text x="10" y={H - 2}>{dt(times[g.first])}</text><text x={W - 68} y={H - 2} textAnchor="end">{dt(times[g.last])}</text></>}
    </svg>
    {!large && <figcaption className={`trace-change ${tone}`}>{chg(change, 1)}</figcaption>}
    {large && <div className="trace-foot"><span>{stamp ? utc(stamp) : "Daily closing prices"}</span><span>Dashed line: first close <Info label="About the price trace">Each vertex is a recorded daily close. Values are joined directly without smoothing. The vertical scale fits this asset’s range; compare the percentage change, not the steepness of different traces. Use the arrow keys on the chart to inspect samples.</Info></span></div>}
  </figure>;
}
