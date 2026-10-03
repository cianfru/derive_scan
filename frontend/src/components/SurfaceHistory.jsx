import { useId, useMemo, useState } from "react";
import { PanelHead, Tabs } from "./ui.jsx";
import { useElementWidth } from "../lib/useElementWidth.js";
import { DAY, FORMAT, SNAPSHOT_KEY, TENORS, WINDOWS, freeSpot, pairs, pathData, segments, windowSlice } from "../lib/surface.js";
import { dayTime } from "../lib/format.js";
import { dayLabel } from "./HistoryStrip.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ok = (v) => v != null && Number.isFinite(v);
const mid = (points) => points.map(([t, v]) => [t + DAY / 2, v]);

/** The history method behind the chart's (i); the seam sentence uses the published overlap of the two sources. */
export function methodInfo(surface) {
  const o = surface?.overlap?.atm30;
  let seam = "";
  if (o && o.days > 0 && Number.isFinite(o.median_diff)) {
    const gap = -o.median_diff * 100;
    seam = ` On the ${o.days === 1 ? "one day" : `${o.days} days`} both exist, the 30-day reading from traded options sat ${Math.abs(gap).toFixed(1)} volatility points ${gap >= 0 ? "above" : "below"} the recorded quotes (median).`;
  }
  return "Derive publishes no past quotes and recording began on 1 Oct 2026. Each earlier day's reading is fitted to that day's traded options across strikes and expiries and shown as a 5-day median (thin lines). Thick lines: daily medians of Derive's quotes, recorded every 15 minutes since 1 Oct 2026, full days only. Dots: the latest snapshot."
    + `${seam} The two sources are never joined. Gaps: too few trades that day. Skew: 25-delta call minus put implied volatility at 30 days; it does not identify trade direction. Market pricing, not our view.`;
}

/** Gridline values: a round step giving at most `most` lines. */
function ticks(lo, hi, steps, most) {
  const step = steps.find((s) => (hi - lo) / s <= most) || steps.at(-1);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}
/** Month starts between t0 and t1, every k months so labels sit at least 64px apart; January and the first label show the year. */
function monthTicks(t0, t1, width) {
  const span = (t1 - t0) / (30.44 * DAY);
  const k = [1, 2, 3, 6, 12].find((n) => (width / span) * n >= 64) || 12;
  const out = [];
  const d = new Date(t0 * 1000);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  for (;;) {
    if (m > 11) { y += 1; m -= 12; }
    const t = Date.UTC(y, m, 1) / 1000;
    if (t > t1) break;
    if (m % k === 0) out.push([t, m === 0 ? String(y) : out.length ? MONTHS[m] : `${MONTHS[m]} ${y}`]);
    m += 1;
  }
  return out;
}
/** Direct labels at the right edge, nudged apart so none overlap. */
function spread(items, gap, lo, hi) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + gap);
  const over = sorted.length ? sorted.at(-1).y - hi : 0;
  if (over > 0) sorted.forEach((s) => { s.y -= over; });
  for (let i = sorted.length - 2; i >= 0; i--) sorted[i].y = Math.min(sorted[i].y, sorted[i + 1].y - gap);
  if (sorted.length && sorted[0].y < lo) { const d = lo - sorted[0].y; sorted.forEach((s) => { s.y += d; }); }
  return sorted;
}

/** The long view on the IV history tab: ATM implied volatility at 7, 30 and 90 days over 3M, 1Y or all
 * of the rebuilt history, and the 30-day skew as an area around zero, sharing one time axis. */
export default function SurfaceHistory({ surface, opts }) {
  const [win, setWin] = useState("1Y");
  const [box, measured] = useElementWidth(900);
  const W = Math.max(300, measured);
  const narrow = W < 560;
  const [sel, setSel] = useState(null);
  const clip = useId().replace(/:/g, "");
  const f = opts?.features || {}, at = opts?.ts;
  const lastDay = surface.days.at(-1);
  const end = Math.max(ok(at) ? at : 0, lastDay + DAY);
  const view = useMemo(() => {
    const line = (m) => ({
      traded: windowSlice(mid(pairs(surface.days, surface.traded[m])), win, end),
      recorded: windowSlice(mid(pairs(surface.days, surface.recorded[m] || surface.days.map(() => null))), win, end),
      latest: ok(f[SNAPSHOT_KEY[m]]) && ok(at) ? [at, f[SNAPSHOT_KEY[m]]] : null,
    });
    const lines = TENORS.filter(([m]) => surface.traded[m]).map(([m, name, color]) => ({ m, name, color, ...line(m) }));
    const skew = surface.traded.rr30 ? line("rr30") : null;
    // Stops: each day in the window with any reading (recorded where it exists), then the latest snapshot.
    const t0 = win === "All" ? surface.days[0] : end - WINDOWS[win];
    const rows = [];
    surface.days.forEach((d, i) => {
      if (d + DAY / 2 < t0) return;
      const vals = {}, src = {};
      for (const m of [...lines.map((l) => l.m), ...(skew ? ["rr30"] : [])]) {
        const r = surface.recorded[m]?.[i], t = surface.traded[m]?.[i];
        if (ok(r)) { vals[m] = r; src[m] = "recorded"; } else if (ok(t)) { vals[m] = t; src[m] = "traded"; }
      }
      if (Object.keys(vals).length) rows.push({ t: d + DAY / 2, day: d, vals, recorded: Object.values(src).includes("recorded") });
    });
    if (ok(at)) rows.push({ t: at, latest: true, vals: Object.fromEntries(Object.entries(SNAPSHOT_KEY).filter(([, k]) => ok(f[k])).map(([m, k]) => [m, f[k]])) });
    return { lines, skew, rows, t0: Math.max(t0, surface.days[0] + DAY / 2) };
  }, [surface, win, end, at, f]);
  const { lines, skew, rows } = view;
  const L = 42, R = 40, top = 8, HA = narrow ? 170 : 220, gap = 22, HB = skew ? (narrow ? 72 : 96) : 0, axis = 22;
  const H = top + HA + (skew ? gap + HB : 0) + axis;
  const x0 = view.t0, x1 = Math.max(end, x0 + DAY);
  const X = (t) => L + ((t - x0) / (x1 - x0)) * (W - L - R);
  const valuesOf = (s) => [...s.traded, ...s.recorded].map((p) => p[1]).filter(ok).concat(s.latest ? [s.latest[1]] : []);
  const aVals = lines.flatMap(valuesOf);
  let a0 = Math.min(...aVals), a1 = Math.max(...aVals);
  const ap = (a1 - a0) * 0.08 || 0.02;
  a0 = Math.max(0, a0 - ap); a1 += ap;
  const YA = (v) => top + (1 - (v - a0) / (a1 - a0)) * HA;
  const sTop = top + HA + gap;
  const sVals = skew ? valuesOf(skew).concat([0]) : [0];
  let s0 = Math.min(...sVals), s1 = Math.max(...sVals);
  const sp = (s1 - s0) * 0.1 || 0.01;
  s0 -= sp; s1 += sp;
  const YS = (v) => sTop + (1 - (v - s0) / (s1 - s0)) * HB;
  if (!rows.length || !aVals.length) return null;
  const s = sel == null ? null : rows[Math.min(sel, rows.length - 1)];
  const shown = s || rows.at(-1);
  const thick = (l) => {
    const last = segments(l.recorded).at(-1)?.at(-1);
    return l.latest && last && l.latest[0] - last[0] <= 2 * DAY ? [...l.recorded, l.latest] : l.recorded;
  };
  const yz = skew ? YS(0) : 0;
  const fill = (points) => segments(points).map((run) => `M${X(run[0][0]).toFixed(1)},${yz.toFixed(1)}`
    + run.map(([t, v]) => `L${X(t).toFixed(1)},${YS(v).toFixed(1)}`).join("") + `L${X(run.at(-1)[0]).toFixed(1)},${yz.toFixed(1)}Z`).join("");
  const skewPoints = skew ? [...skew.traded, ...thick(skew)] : [];
  const areaTags = skew ? [["Calls richer", sTop, Math.min(yz, sTop + 13)], ["Puts richer", Math.max(yz, sTop + HB - 13), sTop + HB]]
    .map(([name, a, b]) => b - a >= 12 ? { name, x: freeSpot(skewPoints, X, YS, name.length * 5.2, a, b, L + 6, W - R - 12), y: b - 3 } : null)
    .filter((t) => t && t.x != null) : [];
  const labels = spread(lines.map((l) => {
    const v = l.latest?.[1] ?? [...l.recorded, ...l.traded].filter((p) => ok(p[1])).sort((p, q) => p[0] - q[0]).at(-1)?.[1];
    return { name: l.name, y: ok(v) ? YA(v) + 4 : null };
  }).filter((x) => x.y != null), 13, top + 8, top + HA);
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const t = x0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (x1 - x0);
    let best = 0;
    rows.forEach((row, i) => { if (Math.abs(row.t - t) < Math.abs(rows[best].t - t)) best = i; });
    setSel(best);
  };
  const keys = (e) => {
    const i = sel ?? rows.length - 1, last = rows.length - 1;
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, PageUp: i - 30, PageDown: i + 30, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSel(Math.max(0, Math.min(last, next)));
  };
  const when = shown.latest ? dayTime(shown.t) : dayLabel(shown.day);
  const source = shown.latest ? null : shown.recorded ? "Recorded" : "From traded options";
  const valueText = [...lines.map((l) => ok(shown.vals[l.m]) ? `${l.name} ${FORMAT.iv(shown.vals[l.m])}` : null),
    skew && ok(shown.vals.rr30) ? `30d skew ${FORMAT.skew(shown.vals.rr30)}` : null].filter(Boolean).join(", ");
  // Gridlines at least 24px apart, six at most.
  const aTicks = ticks(a0, a1, [0.02, 0.05, 0.1, 0.2, 0.5], Math.min(6, Math.floor(HA / 24)));
  const sTicks = skew ? ticks(s0, s1, [0.01, 0.02, 0.05, 0.1, 0.2], Math.max(2, Math.floor(HB / 24))) : [];
  return (
    <section className="surface-history">
      <PanelHead as="h3" title="Implied volatility and skew" info={methodInfo(surface)} infoLabel="About this history"
        right={<Tabs label="History window" value={win} onChange={(w) => { setWin(w); setSel(null); }} items={[["3M", "3M"], ["1Y", "1Y"], ["All", "All"]]} />} />
      <div className="sh-readout" aria-live="polite">
        <time className="mono">{when}</time>
        {lines.map((l) => (
          <span key={l.m} className="sh-value"><i className="sh-key" style={{ background: l.color }} aria-hidden="true" />{l.name}
            <b className="mono">{ok(shown.vals[l.m]) ? FORMAT.iv(shown.vals[l.m]) : "—"}</b></span>
        ))}
        {skew && <span className="sh-value">30d skew<b className="mono">{ok(shown.vals.rr30) ? FORMAT.skew(shown.vals.rr30) : "—"}</b></span>}
        {source && <span className="sh-source">{source}</span>}
      </div>
      <div ref={box} className="sh-plot">
        <svg className="viz" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="slider" tabIndex={0}
          aria-label="Implied volatility and skew history" aria-valuemin={0} aria-valuemax={rows.length - 1}
          aria-valuenow={s ? rows.indexOf(s) : rows.length - 1} aria-valuetext={`${when}: ${valueText}${source ? `. ${source}` : ""}`}
          onPointerDown={pick} onPointerMove={pick} onPointerLeave={() => setSel(null)} onBlur={() => setSel(null)} onKeyDown={keys}>
          <clipPath id={`${clip}p`}><rect x={L} y={0} width={W - L - R + 4} height={H} /></clipPath>
          {aTicks.map((v) => <g key={`a${v}`}><line className="gridline" x1={L} x2={W - R} y1={YA(v)} y2={YA(v)} />
            <text x={L - 8} y={YA(v) + 3} textAnchor="end">{Math.round(v * 100)}%</text></g>)}
          <g clipPath={`url(#${clip}p)`}>
            {lines.map((l) => <path key={`t${l.m}`} className="sh-traded" style={{ stroke: l.color }} d={pathData(l.traded, X, YA)} />)}
            {lines.map((l) => <path key={`r${l.m}`} className="sh-recorded" style={{ stroke: l.color }} d={pathData(thick(l), X, YA)} />)}
            {lines.map((l) => l.latest && <circle key={`d${l.m}`} className="sh-dot" style={{ fill: l.color }} cx={X(l.latest[0])} cy={YA(l.latest[1])} r="3.5" />)}
          </g>
          {labels.map((x) => <text key={x.name} className="sh-label" x={W - R + 8} y={x.y}>{x.name}</text>)}
          {skew && <g aria-label="30-day skew">
            <clipPath id={`${clip}u`}><rect x={L} y={sTop - 4} width={W - L - R + 4} height={Math.max(0, yz - sTop + 4)} /></clipPath>
            <clipPath id={`${clip}d`}><rect x={L} y={yz} width={W - L - R + 4} height={Math.max(0, sTop + HB + 4 - yz)} /></clipPath>
            {sTicks.map((v) => <text key={`s${v}`} x={L - 8} y={YS(v) + 3} textAnchor="end">{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(Math.round(v * 100))}</text>)}
            <path className="hs-area up" d={fill(skew.traded) + fill(thick(skew))} clipPath={`url(#${clip}u)`} />
            <path className="hs-area down" d={fill(skew.traded) + fill(thick(skew))} clipPath={`url(#${clip}d)`} />
            <line className="hs-zero" x1={L} x2={W - R} y1={yz} y2={yz} />
            {areaTags.map((t) => <text key={t.name} className="hs-area-label" x={t.x} y={t.y}>{t.name}</text>)}
            <g clipPath={`url(#${clip}p)`}>
              <path className="sh-traded" style={{ stroke: "var(--fg)" }} d={pathData(skew.traded, X, YS)} />
              <path className="sh-recorded" style={{ stroke: "var(--fg)" }} d={pathData(thick(skew), X, YS)} />
              {skew.latest && <circle className="sh-dot" style={{ fill: "var(--fg)" }} cx={X(skew.latest[0])} cy={YS(skew.latest[1])} r="3.5" />}
            </g>
            <text className="sh-label" x={W - R + 8} y={sTop + 10}>skew</text>
          </g>}
          {monthTicks(x0, x1, W - L - R).map(([t, label]) => <text key={t} x={X(t)} y={H - 6} textAnchor="middle">{label}</text>)}
          {s && <line className="hs-cross" x1={X(s.t)} x2={X(s.t)} y1={top} y2={H - axis + 4} />}
        </svg>
      </div>
      <div className="sh-legend" aria-hidden="true">
        <span><i className="sh-swatch thin" />From traded options</span>
        <span><i className="sh-swatch thick" />Recorded</span>
      </div>
    </section>
  );
}
