import { useId, useMemo, useState } from "react";
import { useElementSize } from "../lib/useElementSize.js";
import { DAY, freeSpot, pathData, segments } from "../lib/surface.js";
import { dayTime } from "../lib/format.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2 Oct 2026" for a UTC day. */
export const dayLabel = (t) => { const d = new Date(t * 1000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** Daily points sit at midday of their UTC day; snapshots at their own time. */
const placed = (points, daily) => (points || []).map(([t, v]) => [daily ? t + DAY / 2 : t, v]);

/** Every value the strip can show, in time order: the readout's stops for pointer and keys. */
function stopsOf(traded, recorded, latest) {
  const at = new Map();
  for (const [t, v] of traded) if (v != null) at.set(t, { t, v, recorded: false });
  for (const [t, v] of recorded) if (v != null) at.set(t, { t, v, recorded: true });
  const stops = [...at.values()].sort((a, b) => a.t - b.t);
  if (latest) stops.push({ t: latest[0], v: latest[1], latest: true });
  return stops;
}

/** The thick recorded line runs on to the newest snapshot when that snapshot follows it directly. */
function recordedPath(recorded, latest) {
  const runs = segments(recorded);
  const last = runs.at(-1)?.at(-1);
  return latest && last && latest[0] > last[0] && latest[0] - last[0] <= 2 * DAY ? [...recorded, latest] : recorded;
}

/** A 1-line history under a dashboard figure. Thin: daily readings rebuilt from traded options. Thick:
 * daily medians of recorded quotes (or the recorded 15-minute snapshots when there is no rebuilt
 * history). Dot: the newest snapshot. Band: the past year's 10th-90th percentile. Area mode tints the
 * side of zero each value sits on. Null values break the line. Pointer and arrow keys read any day. */
export default function HistoryStrip({ series, label, format, zero = false, area = false }) {
  const [box, W, H] = useElementSize(320, 56);
  const clip = useId().replace(/:/g, "");
  const [sel, setSel] = useState(null);
  const daily = !series.snapshots;
  const traded = useMemo(() => placed(series.traded, daily), [series, daily]);
  const recorded = useMemo(() => placed(series.recorded, daily), [series, daily]);
  const latest = series.latest;
  const stops = useMemo(() => stopsOf(traded, recorded, latest), [traded, recorded, latest]);
  if (!stops.length) return null;
  const T = 4, B = 4, L = 1, R = 6;
  const x0 = stops[0].t, x1 = Math.max(stops.at(-1).t, x0 + 1);
  const vals = stops.map((s) => s.v).concat(series.band || [], zero || area ? [0] : []);
  let y0 = Math.min(...vals), y1 = Math.max(...vals);
  const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.1 || 0.01;
  y0 -= pad; y1 += pad;
  const X = (t) => L + ((t - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const thick = recordedPath(recorded, latest);
  const yz = Y(0);
  const fill = (points) => segments(points).map((run) => `M${X(run[0][0]).toFixed(1)},${yz.toFixed(1)}`
    + run.map(([t, v]) => `L${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join("") + `L${X(run.at(-1)[0]).toFixed(1)},${yz.toFixed(1)}Z`).join("");
  const bandFrom = Math.max(x0, x1 - 365 * DAY);
  const s = sel == null ? null : stops[Math.min(sel, stops.length - 1)];
  const text = (stop) => `${stop.latest || !daily ? dayTime(stop.t) : dayLabel(stop.t - DAY / 2)} · ${format(stop.v)}${stop.recorded && daily ? " · Recorded" : ""}`;
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const t = x0 + ((e.clientX - r.left) / r.width * W - L) / (W - L - R) * (x1 - x0);
    let best = 0;
    stops.forEach((st, i) => { if (Math.abs(st.t - t) < Math.abs(stops[best].t - t)) best = i; });
    setSel(best);
  };
  const keys = (e) => {
    const i = sel ?? stops.length - 1, last = stops.length - 1;
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, PageUp: i - 30, PageDown: i + 30, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSel(Math.max(0, Math.min(last, next)));
  };
  // "Calls richer" above zero and "Puts richer" below, each where the line leaves room for it.
  const plotted = [...traded, ...thick];
  const tags = area ? [["Calls richer", T, Math.min(yz, T + 11)], ["Puts richer", Math.max(yz, H - B - 11), H - B]]
    .map(([name, a, b]) => b - a >= 10 ? { name, x: freeSpot(plotted, X, Y, name.length * 5.2, a, b, L + 2, W - R - 10), y: b - 2 } : null)
    .filter((t) => t && t.x != null) : [];
  return (
    <div ref={box} className="history-strip" role="slider" tabIndex={0} aria-label={label}
      aria-valuemin={0} aria-valuemax={stops.length - 1} aria-valuenow={s ? stops.indexOf(s) : stops.length - 1}
      aria-valuetext={text(s || stops.at(-1))}
      onPointerDown={pick} onPointerMove={pick} onPointerLeave={() => setSel(null)} onFocus={() => setSel((v) => v ?? stops.length - 1)}
      onBlur={() => setSel(null)} onKeyDown={keys}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {series.band && <rect className="hs-band" x={X(bandFrom)} width={Math.max(0, X(x1) - X(bandFrom))}
          y={Y(series.band[1])} height={Math.max(1, Y(series.band[0]) - Y(series.band[1]))} />}
        {area && <>
          <clipPath id={`${clip}a`}><rect x={0} y={0} width={W} height={yz} /></clipPath>
          <clipPath id={`${clip}b`}><rect x={0} y={yz} width={W} height={Math.max(0, H - yz)} /></clipPath>
          <path className="hs-area up" d={fill(traded) + fill(thick)} clipPath={`url(#${clip}a)`} />
          <path className="hs-area down" d={fill(traded) + fill(thick)} clipPath={`url(#${clip}b)`} />
        </>}
        {(zero || area) && <line className="hs-zero" x1={L} x2={W - R} y1={yz} y2={yz} />}
        {tags.map((t) => <text key={t.name} className="hs-area-label" x={t.x} y={t.y}>{t.name}</text>)}
        <path className="hs-traded" d={pathData(traded, X, Y)} />
        <path className="hs-recorded" d={pathData(thick, X, Y)} />
        {latest && <circle className="hs-dot" cx={X(latest[0])} cy={Y(latest[1])} r="3" />}
        {s && <>
          <line className="hs-cross" x1={X(s.t)} x2={X(s.t)} y1={0} y2={H} />
          <circle className="hs-sel" cx={X(s.t)} cy={Y(s.v)} r="3.5" />
        </>}
      </svg>
      {s && <span className={`hs-readout mono${X(s.t) < W / 2 ? " right" : ""}`}>{text(s)}</span>}
    </div>
  );
}
