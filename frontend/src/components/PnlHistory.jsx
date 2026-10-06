import { useMemo, useState } from "react";
import { usd, pct } from "../lib/format.js";
import { useElementWidth } from "../lib/useElementWidth.js";
import { RANGES, rangeSeries, readingAt, pointAt } from "../lib/pnlHistory.js";
import { Plate, Tabs } from "./ui.jsx";
import "../pnl-history.css";

const HELP = "Gross options P&L over time: each option's result is booked on its settlement day (08:00 UTC): premium received minus premium paid plus its value at settlement, before fees. The line ends at the Gross options PnL above. Return is the P&L divided by the premium bought and sold on the options that settled in that time. Open positions count once they settle; perp P&L is not included.";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (iso, year = true) => { const [y, m, d] = iso.split("-"); return `${MONTHS[+m - 1]} ${+d}${year ? `, ${y}` : ""}`; };
const signed = (v) => (v > 0 ? `+${usd(v)}` : usd(v));
const signedPct = (v) => (v == null ? null : `${v > 0 ? "+" : ""}${pct(v, 1)}`);
const tone = (v) => (v > 0 ? "up" : v < 0 ? "down" : "dim");

/** A trader's gross options P&L over time, with a range and a reading at any settlement day under the pointer. */
export default function PnlHistory({ history, through }) {
  const [range, setRange] = useState("all");
  const [active, setActive] = useState(null);
  const [box, width] = useElementWidth(720);
  const days = RANGES.find(([k]) => k === range)[2];
  const series = useMemo(() => rangeSeries(history, through, days), [history, through, days]);
  if (!history?.length || !series) return null;

  const W = Math.max(280, width), H = W < 520 ? 180 : 220;
  const pad = { l: 4, r: 64, t: 12, b: 24 };
  const pts = series.points;
  const vals = pts.map((p) => p.pnl);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= Math.max(1, Math.abs(lo) * 0.1); hi += Math.max(1, Math.abs(hi) * 0.1); }
  const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
  const x = (t) => pad.l + ((t - series.start) / Math.max(1, series.end - series.start)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  let line = `M${x(pts[0].t).toFixed(1)},${y(pts[0].pnl).toFixed(1)}`;
  for (const p of pts.slice(1)) line += `H${x(p.t).toFixed(1)}V${y(p.pnl).toFixed(1)}`;
  const area = `${line}V${H - pad.b}H${x(pts[0].t).toFixed(1)}Z`;

  const end = readingAt(series, pts[pts.length - 1]);
  const i = active == null ? pts.length - 1 : active;
  const shown = readingAt(series, pts[i]);
  const color = end.change >= 0 ? "up" : "down";
  const label = range === "all" ? "since first trade" : `over ${RANGES.find(([k]) => k === range)[1].replace("D", " days").replace("1Y", "1 year")}`;

  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = series.start + ((e.clientX - r.left) / r.width * W - pad.l) / (W - pad.l - pad.r) * (series.end - series.start);
    setActive(pointAt(series, t));
  };
  const keys = (e) => {
    const cur = active ?? pts.length - 1;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: pts.length - 1 }[e.key];
    if (e.key === "Escape") { setActive(null); return; }
    if (next === undefined) return;
    e.preventDefault();
    setActive(Math.max(0, Math.min(pts.length - 1, next)));
  };
  const valueText = `${dayText(shown.day)}: cumulative P&L ${usd(shown.total)}; ${signed(shown.change)}${shown.ret != null ? ` (${signedPct(shown.ret)})` : ""} ${range === "all" ? "since first trade" : "since the range start"}`;

  return (
    <Plate title="P&L history" info={HELP} className="pnl-history"
      right={<Tabs label="P&L range" value={range} onChange={(v) => { setRange(v); setActive(null); }} items={RANGES.map(([k, l]) => [k, l])} />}>
      <div className="ph-read" aria-hidden="true">
        <div className="ph-main">
          <span>{active == null ? `P&L ${label}` : `${dayText(shown.day)} · ${range === "all" ? "since first trade" : "since range start"}`}</span>
          <b className={tone(active == null ? end.change : shown.change)}>{signed(active == null ? end.change : shown.change)}
            {(active == null ? end.ret : shown.ret) != null && <small>{signedPct(active == null ? end.ret : shown.ret)}</small>}</b>
        </div>
        {range !== "all" && <div className="ph-side">
          <span>Cumulative P&L</span>
          <b className={tone(shown.total)}>{usd(shown.total)}</b>
        </div>}
      </div>
      <div ref={box} className="ph-chart" tabIndex={0} role="slider" aria-label="P&L history"
        aria-valuemin={0} aria-valuemax={pts.length - 1} aria-valuenow={i} aria-valuetext={valueText}
        onKeyDown={keys} onBlur={() => setActive(null)}
        onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => { if (e.pointerType !== "touch") setActive(null); }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <defs>
            <linearGradient id="ph-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={`ph-stop-a ${color}`} />
              <stop offset="1" className={`ph-stop-b ${color}`} />
            </linearGradient>
          </defs>
          {[hi - (hi - lo) * 0.08, (hi + lo) / 2, lo + (hi - lo) * 0.08].map((v, k) => (
            <g key={k} className="ph-grid">
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
              <text x={W - pad.r + 8} y={y(v) + 4}>{usd(v)}</text>
            </g>))}
          {lo < 0 && hi > 0 && <line className="ph-zero" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />}
          <path d={area} fill="url(#ph-fill)" />
          <path d={line} className={`ph-line ${color}`} />
          <text className="ph-axis" x={pad.l} y={H - 6}>{dayText(pts[0].day)}</text>
          <text className="ph-axis" x={W - pad.r} y={H - 6} textAnchor="end">{dayText(pts[pts.length - 1].day)}</text>
          {active != null && <>
            <line className="ph-cursor" x1={x(pts[i].t)} x2={x(pts[i].t)} y1={pad.t} y2={H - pad.b} />
            <circle className={`ph-dot ${tone(shown.change) === "dim" ? color : tone(shown.change)}`} cx={x(pts[i].t)} cy={y(pts[i].pnl)} r="4.5" />
          </>}
        </svg>
      </div>
    </Plate>
  );
}
