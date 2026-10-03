import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { radarPoint, radarLabels, viewReading, traceGeometry } from "../lib/presentation.js";
import { price, usd, z, chg, clock, REGIME, DASH } from "../lib/format.js";
import { Tabs, Loading, Failed, PageHead, PanelHead, Empty, Arrow } from "../components/ui.jsx";
import { Asset } from "../components/MarketVisuals.jsx";
import { useElementWidth } from "../lib/useElementWidth.js";
import { radarFrames, frameAt, trailAt, closeLabel, nearest } from "../lib/radarHistory.js";

const TONE = { up: "var(--up)", defensive: "var(--down)", neutral: "var(--fg-2)" };
const toneOf = (coin) => viewReading(coin.align, "30d", "engine").state;
const fill = (state) => TONE[state] || "var(--faint)";
const EPS = 1e-6;
const MS_PER_CLOSE = 450, REDUCED_MS = 700;
const signedPct = (v) => (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(0)}%` : DASH);

const RADAR_HELP = "Across: the 1D engine's price stretch, in standard deviations from its trend. Up: the Smart cohort's net option delta divided by its gross absolute option delta, from −100% to +100%, on expiries inside the selected window (7 or 30 days). Circle area: gross dollar delta exposure, relative to the largest shown; fill: the daily engine's reading. Markets without a current wallet reading sit on the strip above the axis at their price stretch. Exposure, not a count of traders; context side by side, not an entry score.";
const RADAR_HISTORY_HELP = "History: each circle trails its last 7 daily closes, oldest faintest; Replay steps through the last 30, with circle sizes and the stretch axis on one scale across them. Past wallet readings are rebuilt from Derive's trade history with the Smart cohort as it stood on each day, so later results never choose the wallets. Hollow dot: delta modelled from trade prices; filled dot: delta from recorded option quotes. Dotted step: expiries left or entered the window at that close, so the move comes from the window, not from trading. Grey circle: no recorded engine reading for that close. Context, not a signal.";

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

/** The trail under each circle: solid steps faded by age, dotted where the window rolled; a dot per
 * close, hollow when its delta was modelled. The followed coin's trail is orange. */
function Trails({ trails, focus, x, y, steps }) {
  return (
    <g className="radar-trails">
      {[...trails].map(([und, pts]) => {
        if (pts.length < 2) return null;
        const on = und === focus;
        const head = pts[pts.length - 1];
        const tone = on ? "var(--orange)" : head.engine ? TONE[head.engine] : "var(--fg-2)";
        const n = pts.length;
        const fade = (i) => 1 - 0.65 * ((n - 1 - i) / Math.max(1, n - 1));
        return (
          <g key={und} className={`radar-trail ${on ? "on" : ""}`}>
            {pts.slice(0, -1).map((a, i) => {
              const b = pts[i + 1];
              return <line key={`s${a.i}`} x1={x(a.x)} y1={y(a.y)} x2={x(b.x)} y2={y(b.y)} stroke={tone}
                strokeOpacity={(on ? 0.95 : 0.6) * fade(i + 0.5)} strokeWidth={on ? 1.6 : 1.1} strokeLinecap="round"
                strokeDasharray={b.roll ? "1.5 3.5" : undefined} />;
            })}
            {pts.slice(0, -1).map((a, i) => (
              <g key={`d${a.i}`} className="radar-trail-dot">
                <title>{`${closeLabel(steps[a.i])} close: stretch ${z(a.x)}, balance ${signedPct(a.y)}, ${a.modelled ? "delta modelled from trades" : "delta from recorded quotes"}`}</title>
                <circle cx={x(a.x)} cy={y(a.y)} r={on ? 2.6 : 2} fill={a.modelled ? "var(--plate)" : tone} stroke={tone}
                  strokeWidth="1" strokeOpacity={(on ? 1 : 0.7) * fade(i)} fillOpacity={a.modelled ? 1 : (on ? 1 : 0.7) * fade(i)} />
                <circle cx={x(a.x)} cy={y(a.y)} r="6" fill="transparent" />
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}

/**
 * points: the circles at the playhead. labelPoints: the same coins at the last whole close the
 * playhead passed; labels are placed there and keep their side in between, so they never flicker.
 * maxGross and xBound hold the size and stretch scales across the replay window.
 */
export function RadarMap({ points, strip = [], focus, onSelect, trails = null, steps = [], past = false, maxGross: fixedGross = 0, xBound = 0, labelPoints = null, stripSets = null }) {
  const [box, width] = useElementWidth(780);
  const W = Math.max(300, width), narrow = W < 500;
  const L = narrow ? 44 : 64, R = narrow ? 12 : 24, T = 12;
  const plotH = narrow ? 300 : 380;
  const bound = Math.max(3, Math.ceil(xBound), ...[...points, ...strip].map((p) => Math.ceil(Math.abs(p.x))));
  const x = (v) => L + ((v + bound) / (2 * bound)) * (W - L - R);
  const plotBottom = T + plotH;
  const stripped = strip.length ? stripRows(strip, x) : [];
  const stripY = plotBottom + 18;
  // With history, the strip keeps room for its fullest close, so the map never changes height in Replay.
  const levels = (items) => (items.length ? Math.max(...stripRows(items, x).map((s) => s.row)) + 1 : 0);
  const stripLevels = Math.max(levels(strip), ...(stripSets || []).map(levels));
  const axisY = stripLevels ? stripY + 16 + stripLevels * 13 + 8 : plotBottom + 22;
  const H = axisY + 26;
  const y = (ratio) => T + ((1 - ratio) / 2) * plotH;
  const maxGross = Math.max(1, fixedGross, ...points.map((p) => p.gross));
  const radius = (p) => Math.max(5, 26 * Math.sqrt(p.gross / maxGross));
  const bounds = { left: L, right: W - R, top: T, bottom: plotBottom };
  const order = (pts) => [...pts].sort((a, b) => Number(b.coin.und === focus) - Number(a.coin.und === focus) || b.gross - a.gross);
  const circleOf = (p) => ({ name: p.coin.und, x: x(p.x), y: y(p.y), r: radius(p) });
  const anchors = order(labelPoints || points).map(circleOf);
  const at = new Map(anchors.map((c) => [c.name, c]));
  const sides = new Map(radarLabels(anchors, bounds).map((l) => [l.name, { dx: l.x - at.get(l.name).x, dy: l.y - at.get(l.name).y }]));
  const labelFor = (c) => {
    const half = c.name.length * 3.6 + 3;
    const s = sides.get(c.name) || { dx: c.r + half + 6, dy: 4 };
    const lx = Math.max(L + half, Math.min(W - R - half, c.x + s.dx)), ly = Math.max(T + 14, Math.min(plotBottom - 4, c.y + s.dy));
    return { x: lx, y: ly, rect: { left: lx - half, right: lx + half, top: ly - 12, bottom: ly + 3 } };
  };
  const drawn = [...points]
    .sort((a, b) => Number(a.coin.und === focus) - Number(b.coin.und === focus) || b.gross - a.gross)
    .map((p) => { const c = circleOf(p); return { p, c, label: labelFor(c) }; });
  // The followed trail's date mark, at its oldest close, on the side that clears labels and circles.
  const mark = (() => {
    const pts = focus && trails?.get(focus);
    if (!pts || pts.length < 2) return null;
    const first = pts[0], fx = x(first.x), fy = y(first.y), text = closeLabel(steps[first.i]);
    const half = text.length * 3.4 + 2;
    const rects = drawn.map((d) => d.label.rect);
    const spots = [[0, -8], [0, 16], [-half - 6, 4], [half + 6, 4], [-half - 4, -8], [half + 4, -8], [-half - 4, 16], [half + 4, 16]];
    let best = null;
    for (const [i, [dx, dy]] of spots.entries()) {
      const cx = Math.max(L + half, Math.min(W - R - half, fx + dx)), by = Math.max(T + 12, Math.min(plotBottom - 4, fy + dy));
      const box = { left: cx - half, right: cx + half, top: by - 10, bottom: by + 2 };
      const hit = (b) => box.left < b.right + 2 && box.right + 2 > b.left && box.top < b.bottom + 2 && box.bottom + 2 > b.top;
      const near = (q) => { const nx = Math.max(box.left, Math.min(box.right, q.x)), ny = Math.max(box.top, Math.min(box.bottom, q.y)); return Math.hypot(q.x - nx, q.y - ny) < (q.r || 3) + 2; };
      const score = rects.filter(hit).length * 1000 + drawn.filter((d) => near(d.c)).length * 100 + pts.filter((q) => near({ x: x(q.x), y: y(q.y) })).length * 10 + i;
      if (!best || score < best.score) best = { x: cx, y: by, text, score };
    }
    return best;
  })();
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
        {trails && <Trails trails={trails} focus={focus} x={x} y={y} steps={steps} />}
        {stripped.length > 0 && (
          <g className="radar-strip">
            <line x1={L} x2={W - R} y1={stripY} y2={stripY} className="trace-grid" />
            {stripped.map((s) => (
              <g key={s.und} className={`radar-tick ${s.und === focus ? "selected" : ""}`} onClick={() => onSelect(s.und)} aria-hidden="true">
                <title>{`${s.und}: price stretch ${z(s.x)}, ${past ? "no wallet reading at that close" : "no current wallet reading"}`}</title>
                <circle cx={s.cx} cy={stripY} r="4" fill="var(--plate)" stroke={s.und === focus ? "var(--orange)" : fill(s.state)} strokeWidth={s.und === focus ? 2 : 1.25} />
                <text x={s.cx} y={stripY + 17 + s.row * 13} textAnchor="middle">{s.und}</text>
                <rect x={s.cx - 16} y={stripY - 8} width="32" height={24 + s.row * 13} fill="transparent" />
              </g>
            ))}
          </g>
        )}
        {drawn.map(({ p, c, label }) => {
            const selected = p.coin.und === focus;
            const r = c.r, cx = c.x, cy = c.y;
            const tone = past ? fill(p.engine) : fill(toneOf(p.coin));
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
        {mark && <text className="radar-mark" x={mark.x} y={mark.y} textAnchor="middle" pointerEvents="none">{mark.text}</text>}
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

const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Replay: Play/Pause, a scrubber over the closes with a date tick every 7 closes, the date, Close. */
function Player({ open, onOpen, onClose, steps, t, onScrub, playing, onPlay }) {
  const last = steps.length - 1;
  const playRef = useRef(null);
  useEffect(() => { if (open) playRef.current?.focus(); }, [open]);
  if (!open) return (
    <div className="radar-player closed">
      <button type="button" className="text-control" disabled={last < 1} onClick={onOpen}>Replay</button>
    </div>
  );
  const k = Math.round(t);
  const when = k >= last ? "Now" : closeLabel(steps[k]);
  const ticks = steps.map((s, i) => ({ i, s })).filter(({ i }) => i < last && (last - i) % 7 === 0);
  const key = (e) => {
    const to = { ArrowLeft: Math.ceil(t - EPS) - 1, ArrowDown: Math.ceil(t - EPS) - 1, ArrowRight: Math.floor(t + EPS) + 1, ArrowUp: Math.floor(t + EPS) + 1,
      PageDown: Math.ceil(t - EPS) - 7, PageUp: Math.floor(t + EPS) + 7, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onScrub(Math.max(0, Math.min(last, to)));
  };
  return (
    <div className="radar-player">
      <button ref={playRef} type="button" className="text-control rp-play" onClick={onPlay} aria-label={playing ? "Pause" : `Play the last ${last} closes`}>{playing ? "Pause" : "Play"}</button>
      <div className="rp-scrub">
        <input type="range" min="0" max={last} step="0.01" value={t} aria-label="Close" aria-valuetext={k >= last ? "Now" : `${closeLabel(steps[k])} close`}
          onChange={(e) => onScrub(+e.target.value)} onKeyDown={key} />
        <div className="rp-ticks" aria-hidden="true">
          {ticks.map(({ i, s }) => <span key={i} className={(last - i) % 14 ? "rp-odd" : undefined} style={{ left: `calc(6px + (100% - 12px) * ${i / last})` }}>{closeLabel(s)}</span>)}
        </div>
      </div>
      <span className="rp-when" aria-hidden="true">{when}</span>
      <button type="button" className="text-control" onClick={onClose}>Close</button>
    </div>
  );
}

/** The value of a per-step series at fractional step t, interpolated only between linked closes. */
function seriesAt(values, t) {
  const k = Math.floor(t + EPS), f = t - k;
  const a = values[k], b = values[k + 1];
  if (f < EPS) return a ?? null;
  if (a && b && !b.brk) return { ...a, v: a.v + (b.v - a.v) * f };
  return values[f < 0.5 ? k : k + 1] ?? null;
}

/** One reading over the replay window: thin where modelled, thick where recorded, with an orange
 * cursor at the playhead and the value now at the right edge. */
function HistTrace({ label, values, t, lo, hi, fmt, last, plain = false }) {
  const [box, width] = useElementWidth(240);
  const W = Math.max(120, width), H = 40, ROOM = 48;
  const X = (k) => 2 + (k / Math.max(1, last)) * (W - ROOM - 4);
  const Y = (v) => 3 + ((hi - Math.max(lo, Math.min(hi, v))) / (hi - lo)) * (H - 6);
  const segs = [];
  for (let k = 0; k < values.length - 1; k++) {
    const a = values[k], b = values[k + 1];
    if (a && b && !b.brk) segs.push(<line key={k} x1={X(k)} y1={Y(a.v)} x2={X(k + 1)} y2={Y(b.v)} className={plain ? "rd-hist-plain" : a.thin || b.thin ? "rd-hist-thin" : "rd-hist-line"} />);
  }
  const head = seriesAt(values, t);
  const end = values[last];
  return (
    <div className="rd-hist-row">
      <span>{label}</span>
      <div ref={box} className="rd-hist-plot">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
          {lo < 0 && hi > 0 && <line x1={X(0)} x2={X(last)} y1={Y(0)} y2={Y(0)} className="trace-baseline" />}
          {segs}
          {values.map((p, k) => p && !values[k - 1] && (!values[k + 1] || values[k + 1].brk) ? <circle key={`p${k}`} cx={X(k)} cy={Y(p.v)} r="1.4" className="rd-hist-lone" /> : null)}
          <line x1={X(t)} x2={X(t)} y1="0" y2={H} className="rd-hist-cursor" />
          {head && <circle cx={X(t)} cy={Y(head.v)} r="2.6" className="rd-hist-head" />}
          <text x={W} y={Y(end ? end.v : 0) + 4} textAnchor="end">{end ? fmt(end.v) : DASH}</text>
        </svg>
      </div>
    </div>
  );
}

function HistAxis({ steps }) {
  const [box, width] = useElementWidth(240);
  const W = Math.max(120, width), ROOM = 48;
  return (
    <div className="rd-hist-row rd-hist-axis" aria-hidden="true">
      <span />
      <div ref={box} className="rd-hist-plot">
        <svg viewBox={`0 0 ${W} 12`} width={W} height="12">
          <text x="2" y="10">{closeLabel(steps[0])}</text>
          <text x={W - ROOM - 2} y="10" textAnchor="end">Now</text>
        </svg>
      </div>
    </div>
  );
}

export default function Radar() {
  const { data, error } = useData("markets.json");
  const { data: hist } = useData("radar.json");
  const [params, setParams] = useSearchParams();
  const detailRef = useRef(null);
  const horizon = params.get("window") === "7d" ? "7d" : "30d";
  const coins = useMemo(() => (data?.coins || []).filter((c) => c.has_options).sort((a, b) => (b.oi_usd || 0) - (a.oi_usd || 0)), [data]);
  const selected = coins.find((c) => c.und === params.get("focus")) || coins.find((c) => c.und === "BTC") || coins[0];
  const choose = (key, value) => {
    const p = new URLSearchParams(params); p.set(key, value); setParams(p, { replace: true });
    if (key === "focus" && window.matchMedia("(max-width: 900px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    }
  };
  const livePoints = useMemo(() => coins.map((c) => radarPoint(c, horizon)).filter(Boolean), [coins, horizon]);
  const H = useMemo(() => radarFrames(hist, livePoints, horizon, Date.now() / 1000, coins), [hist, livePoints, horizon, coins]);
  const last = H ? H.last : 0;

  // Replay: t is the playhead (0 .. last, last = now); null means now.
  const [open, setOpen] = useState(false);
  const [t, setTState] = useState(null);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(null), timer = useRef(null);
  const setT = useCallback((v) => { tRef.current = v; setTState(v); }, []);
  const stop = useCallback(() => {
    const run = timer.current;
    if (run?.raf != null) cancelAnimationFrame(run.raf);
    if (run?.interval != null) clearInterval(run.interval);
    timer.current = null; setPlaying(false);
  }, []);
  const play = useCallback(() => {
    if (timer.current != null) return stop();
    let start = tRef.current ?? last;
    if (start >= last - EPS) start = 0;
    setT(start); setPlaying(true);
    if (reducedMotion()) {
      // One whole close at a time, no tween.
      timer.current = { interval: setInterval(() => {
        const next = Math.min(last, Math.floor((tRef.current ?? last) + EPS) + 1);
        setT(next);
        if (next >= last) stop();
      }, REDUCED_MS) };
      return;
    }
    let t0 = null;
    const dur = (last - start) * MS_PER_CLOSE;
    const frame = (ts) => {
      if (t0 == null) t0 = ts;
      const v = Math.min(last, start + ((ts - t0) / dur) * (last - start));
      setT(v);
      if (v >= last) { timer.current = null; setPlaying(false); } else timer.current = { raf: requestAnimationFrame(frame) };
    };
    timer.current = { raf: requestAnimationFrame(frame) };
  }, [last, setT, stop]);
  useEffect(() => stop, [stop]);
  const scrub = useCallback((v) => { stop(); setT(v); }, [stop, setT]);

  if (error && !data) return <div className="wrap page"><Failed error={error} /></div>;
  if (!data) return <div className="wrap page"><Loading /></div>;
  const tt = t == null ? last : Math.max(0, Math.min(t, last));
  const atNow = !H || !open || tt >= last - EPS;
  const k = Math.round(tt);                         // the close the readout names
  const anchorStep = Math.min(last, Math.floor(tt + EPS));  // the last whole close passed: labels are placed there
  const byUnd = new Map(coins.map((c) => [c.und, c]));
  const pointsAt = (s) => [...H.frames].map(([und, row]) => {
    const f = frameAt(row, s);
    return f && byUnd.get(und) ? { coin: byUnd.get(und), ...f } : null;
  }).filter(Boolean);
  // Points at the playhead; at now, the live points exactly as without history.
  const points = atNow ? livePoints : pointsAt(tt);
  const labelPoints = atNow ? null : pointsAt(anchorStep);
  const plotted = new Set(points.map((p) => p.coin.und));
  const strip = atNow
    ? coins.filter((c) => !plotted.has(c.und) && Number.isFinite(c.z_1d) && viewReading(c.align, "30d", "engine").state)
      .map((c) => ({ und: c.und, x: c.z_1d, state: toneOf(c) }))
    : coins.filter((c) => !plotted.has(c.und) && Number.isFinite(nearest(H.series.get(c.und)?.z, tt)))
      .map((c) => ({ und: c.und, x: nearest(H.series.get(c.und).z, tt), state: nearest(H.series.get(c.und).engine, tt) }));
  // Every close's strip, so the map keeps one height through Replay.
  const stripSets = H ? H.steps.map((_, s) => coins.filter((c) => !H.frames.get(c.und)?.[s] && Number.isFinite(H.series.get(c.und)?.z[s]))
    .map((c) => ({ und: c.und, x: H.series.get(c.und).z[s] }))) : null;
  // Trails: up to 7 closes behind each plotted circle.
  const trails = H ? new Map([...H.frames].filter(([und]) => plotted.has(und)).map(([und, row]) => [und, trailAt(row, tt)])) : null;
  // One size scale and one stretch range across the replay window, the same at rest.
  const shown = H ? [...H.frames.values()].flat().filter(Boolean) : [];
  const maxGross = Math.max(0, ...shown.map((p) => p.gross));
  const xBound = H ? Math.max(0, ...[...H.series.values()].flatMap((s) => s.z).filter(Number.isFinite).map((v) => Math.ceil(Math.abs(v)))) : 0;

  const selectedPoint = points.find((p) => p.coin.und === selected?.und) || null;
  const sel = H && selected ? H.series.get(selected.und) : null;
  const engineOk = selected && viewReading(selected.align, "30d", "engine").state && Number.isFinite(selected.z_1d);
  const zShown = atNow ? (engineOk ? selected.z_1d : null) : nearest(sel?.z, tt);
  const wShown = atNow ? selectedPoint : nearest(sel?.w, tt);
  const closeAt = !atNow && k < last ? H.steps[k] : null;
  const closePrice = closeAt && selected?.spark_times_1d ? selected.spark_1d?.[selected.spark_times_1d.indexOf(closeAt)] : null;
  const zSeries = sel?.z.map((v, i) => (Number.isFinite(v) ? { v, brk: i === last && H.brk } : null));
  const wSeries = sel?.w.map((p) => (p ? { v: p.y, thin: p.modelled, brk: p.brk } : null));
  const hasHist = Boolean(sel) && (zSeries.filter(Boolean).length > 1 || wSeries.filter(Boolean).length > 1);
  const sBound = Math.max(2, xBound);
  const tabs = <Tabs label="Wallet expiry window" value={horizon} onChange={(v) => choose("window", v)} items={[["7d", "Within 7 days", "7 days"], ["30d", "Within 30 days", "30 days"]]} />;
  const info = H ? <div className="radar-help"><p>{RADAR_HELP}</p><p>{RADAR_HISTORY_HELP}</p></div> : RADAR_HELP;

  return (
    <div className="wrap page radar-page">
      <PageHead title="Radar" info={info} tabs={tabs} meta={<>{coins.length} markets · {clock(data.generated_at)}</>} />
      <div className="plate radar-workspace">
        <section className="radar-stage" aria-label="Positioning map">
          <PanelHead title="Positioning map" right={<span className="radar-count" title={atNow ? "Markets with a current Smart wallet reading" : "Markets with a Smart wallet reading at that close"}>{points.length}/{coins.length}</span>} />
          {points.length || strip.length
            ? <RadarMap points={points} strip={strip} focus={selected?.und} onSelect={(v) => choose("focus", v)}
                trails={trails} steps={H?.steps} past={!atNow} maxGross={maxGross} xBound={xBound} labelPoints={labelPoints} stripSets={stripSets} />
            : <div className="radar-empty"><Empty /></div>}
          {H && <Player open={open} steps={H.steps} t={tt} onScrub={scrub} playing={playing} onPlay={play}
            onOpen={() => { setOpen(true); setT(null); }} onClose={() => { stop(); setOpen(false); setT(null); }} />}
        </section>
        {selected && (
          <aside ref={detailRef} className="radar-detail" aria-live={playing ? "off" : "polite"} aria-label={`${selected.und} radar detail`}>
            <div className="rd-coin">
              <Asset und={selected.und} compact />
              <span className="rd-price">{atNow || k >= last ? `$${price(selected.price)}` : <><span className="rd-when">{closeLabel(closeAt)} close</span>{Number.isFinite(closePrice) && ` $${price(closePrice)}`}</>}</span>
            </div>
            <Link to={`/coin/${selected.und}`} className="rd-trace-link" aria-label={`Open ${selected.und} chart`}>
              <RailTrace values={selected.spark_1d} label={`${selected.und} daily closes`} />
            </Link>
            <div className="rd-figs">
              <div><span>1D stretch</span><b>{Number.isFinite(zShown) ? z(zShown) : <Empty />}</b></div>
              <div><span>Delta balance</span><b>{wShown ? `${(wShown.y * 100).toFixed(0)}%` : <Empty />}</b></div>
              <div><span>Gross delta</span><b>{wShown ? usd(wShown.gross) : <Empty />}</b></div>
            </div>
            {hasHist && (
              <div className="rd-hist" aria-label={`${selected.und}: balance and stretch over the last ${last} closes`}>
                <HistTrace label="Balance" values={wSeries} t={tt} lo={-1} hi={1} fmt={signedPct} last={last} />
                <HistTrace label="Stretch" values={zSeries} t={tt} lo={-sBound} hi={sBound} fmt={(v) => z(v)} last={last} plain />
                <HistAxis steps={H.steps} />
              </div>
            )}
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
