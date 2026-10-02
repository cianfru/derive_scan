// Options shown as structure: where open interest sits, how volatility is priced across expiries and strikes.
import { useMemo } from "react";
import { price, pct, usd } from "../lib/format.js";

const W = 640;

/** Mirrored open-interest bars by strike: puts left, calls right, the index as a line. */
export function OIWall({ rows, index, height = 360 }) {
  const view = useMemo(() => {
    if (!rows?.length || !index) return null;
    const near = rows.filter((r) => r[0] >= index * 0.6 && r[0] <= index * 1.6 && (r[1] > 0 || r[2] > 0));
    let list = near.length ? near : rows;
    if (list.length > 34) { // merge into round-number buckets so the wall stays readable
      const raw = (list[list.length - 1][0] - list[0][0]) / 28, mag = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
      const by = new Map();
      list.forEach((r) => { const k = Math.round(r[0] / step) * step; const t = by.get(k) || [k, 0, 0]; t[1] += r[1]; t[2] += r[2]; by.set(k, t); });
      list = [...by.values()].sort((a, b) => a[0] - b[0]).filter((r) => r[1] || r[2]);
    }
    const max = Math.max(...list.map((r) => Math.max(r[1], r[2])), 1e-9);
    return { list, max };
  }, [rows, index]);
  if (!view) return <p className="status">No open interest yet.</p>;
  const { list, max } = view;
  const rowH = Math.max(9, Math.min(18, (height - 30) / list.length));
  const H = rowH * list.length + 30, mid = W / 2, half = W / 2 - 70;
  const ys = list.map((_, i) => 14 + (list.length - 1 - i) * rowH);
  // index line between the two strikes around it
  let iy = null;
  for (let i = 0; i < list.length - 1; i++) {
    if (list[i][0] <= index && index <= list[i + 1][0]) {
      const f = (index - list[i][0]) / (list[i + 1][0] - list[i][0] || 1);
      iy = ys[i] + (ys[i + 1] - ys[i]) * f + rowH / 2;
    }
  }
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Open interest by strike, puts left and calls right">
      <text x={mid - 8} y={10} textAnchor="end">Puts</text>
      <text x={mid + 8} y={10}>Calls</text>
      {list.map((r, i) => (
        <g key={i}>
          <rect x={mid - 2 - (r[2] / max) * half} y={ys[i] + 1} width={(r[2] / max) * half} height={rowH - 2} fill="var(--sig-exit)" opacity=".75" />
          <rect x={mid + 2} y={ys[i] + 1} width={(r[1] / max) * half} height={rowH - 2} fill="var(--orange)" opacity=".9" />
          {(list.length <= 18 || i % Math.ceil(list.length / 16) === 0) &&
            <text x={W - 4} y={ys[i] + rowH - 3} textAnchor="end">{price(r[0])}</text>}
        </g>))}
      <line x1={mid} x2={mid} y1={12} y2={H - 14} stroke="var(--seam-hi)" />
      {iy != null && <g>
        <line x1={8} x2={W - 70} y1={iy} y2={iy} stroke="var(--fg)" strokeDasharray="4 3" />
        <text x={10} y={iy - 4} style={{ fill: "var(--fg)" }}>Index {price(index)}</text>
      </g>}
    </svg>
  );
}

/** Implied volatility by strike for one expiry (out-of-the-money side: puts below the forward, calls above). */
export function Smile({ rows, index, height = 200 }) {
  const pts = (rows || []).filter((r) => r[0] >= index * 0.6 && r[0] <= index * 1.6)
    .map((r) => [r[0], r[0] < index ? r[4] : r[3]]).filter((p) => p[1] != null && p[1] > 0);
  if (pts.length < 3) return <p className="status">Not enough quotes.</p>;
  const H = height, L = 44, R = 12, T = 10, B = 26;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) * 0.95, y1 = Math.max(...ys) * 1.05;
  const X = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const ticks = [y0, (y0 + y1) / 2, y1];
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Implied volatility by strike">
      {ticks.map((t, i) => <g key={i}><line className="gridline" x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} /><text x={L - 6} y={Y(t) + 3} textAnchor="end">{pct(t, 0)}</text></g>)}
      <line x1={X(index)} x2={X(index)} y1={T} y2={H - B} stroke="var(--fg)" strokeDasharray="4 3" />
      <path d={d} fill="none" stroke="var(--orange)" strokeWidth="2" />
      {pts.map((p, i) => <circle key={i} cx={X(p[0])} cy={Y(p[1])} r="2.5" fill="var(--bg)" stroke={p[0] < index ? "var(--sig-exit)" : "var(--orange)"} strokeWidth="1.5"><title>{price(p[0])}: {pct(p[1])}</title></circle>)}
      <text x={L} y={H - 6}>{price(x0)}</text><text x={W - R} y={H - 6} textAnchor="end">{price(x1)}</text>
      <text x={X(index)} y={H - 6} textAnchor="middle" style={{ fill: "var(--fg)" }}>{price(index)}</text>
    </svg>
  );
}

/** ATM implied volatility across expiries. */
export function TermStructure({ expiries, height = 220 }) {
  const ex = (expiries || []).filter((e) => e.atm_iv != null && e.tenor_days > 0.4);
  if (ex.length < 2) return <p className="status">Not enough expiries.</p>;
  const H = height, L = 44, R = 14, T = 12, B = 28;
  const lt = (d) => Math.log(1 + d), tmax = Math.max(...ex.map((e) => e.tenor_days));
  const ivs = ex.map((e) => e.atm_iv), y0 = Math.floor(Math.min(...ivs) * 20) / 20, y1 = Math.ceil(Math.max(...ivs) * 20) / 20 || y0 + 0.05;
  const X = (d) => L + (lt(d) / lt(tmax)) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const pts = ex.map((e) => [X(e.tenor_days), Y(e.atm_iv)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const grid = [];
  for (let v = y0; v <= y1 + 1e-9; v += 0.05) grid.push(v);
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="At-the-money implied volatility by days to expiry">
      <defs><linearGradient id="tsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--orange)" stopOpacity=".28" /><stop offset="1" stopColor="var(--orange)" stopOpacity="0" /></linearGradient></defs>
      {grid.map((v, i) => <g key={i}><line className="gridline" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} /><text x={L - 6} y={Y(v) + 3} textAnchor="end">{Math.round(v * 100)}%</text></g>)}
      {[1, 7, 30, 90, 180, 365].filter((d) => d <= tmax * 1.05).map((d) => <text key={d} x={X(d)} y={H - 8} textAnchor="middle">{d}d</text>)}
      <path d={`${line}L${pts[pts.length - 1][0]},${H - B}L${pts[0][0]},${H - B}Z`} fill="url(#tsg)" />
      <path d={line} fill="none" stroke="var(--orange)" strokeWidth="2.2" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="var(--bg)" stroke="var(--orange-hi)" strokeWidth="1.8"><title>{ex[i].tenor_days.toFixed(1)} days: {pct(ex[i].atm_iv)}</title></circle>)}
    </svg>
  );
}

/** A small time series (e.g. 30-day ATM IV over the last two weeks). */
export function MiniSeries({ points, height = 110, format = (v) => pct(v, 1), color = "var(--orange)", zero = false }) {
  const p = (points || []).filter((q) => q[1] != null);
  if (p.length < 2) return <p className="status">Builds as data is recorded.</p>;
  const W = 420, H = height, L = 44, R = 8, T = 8, B = 18;
  const t0 = p[0][0], t1 = p[p.length - 1][0];
  let y0 = Math.min(...p.map((q) => q[1])), y1 = Math.max(...p.map((q) => q[1]));
  if (zero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
  const pad = (y1 - y0) * 0.1 || Math.abs(y1) * 0.05 || 0.01;
  y0 -= pad; y1 += pad;
  const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const d = p.map((q, i) => `${i ? "L" : "M"}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join("");
  const last = p[p.length - 1];
  return (
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} role="img">
      {[y0 + pad, y1 - pad].map((v, i) => <g key={i}><line className="gridline" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} /><text x={L - 6} y={Y(v) + 3} textAnchor="end">{format(v)}</text></g>)}
      {zero && <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="var(--faint)" strokeDasharray="3 3" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" />
      <circle cx={X(last[0])} cy={Y(last[1])} r="3.2" fill={color} />
      <text x={L} y={H - 3}>{new Date(t0 * 1000).toISOString().slice(5, 10)}</text>
      <text x={W - R} y={H - 3} textAnchor="end">{new Date(t1 * 1000).toISOString().slice(5, 10)}</text>
    </svg>
  );
}

/** Index plus and minus one standard deviation over 30 days, from 30-day ATM implied volatility. */
export function PricedRange({ index, iv30 }) {
  if (!index || !iv30) return <p className="status">-</p>;
  const sd = index * iv30 * Math.sqrt(30 / 365), lo = index - sd, hi = index + sd, span = sd * 3;
  const pos = (v) => ((v - (index - span / 2)) / span) * 100;
  return (
    <div>
      <div style={{ position: "relative", height: 34, margin: "8px 0 6px" }}>
        <div style={{ position: "absolute", top: 10, height: 14, left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%`,
          background: "linear-gradient(90deg, color-mix(in srgb, var(--orange) 25%, transparent), color-mix(in srgb, var(--orange) 70%, transparent), color-mix(in srgb, var(--orange) 25%, transparent))",
          clipPath: "polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)" }} />
        <div style={{ position: "absolute", top: 2, height: 30, width: 2, left: `calc(${pos(index)}% - 1px)`, background: "var(--fg)" }} />
      </div>
      <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
        <span>{price(lo)}</span><span style={{ color: "var(--fg)" }}>{price(index)}</span><span>{price(hi)}</span>
      </div>
    </div>
  );
}

/** One row per expiry: the priced ranges as bars on a shared price axis, with the index marked. */
export function PricedByDate({ implied, index }) {
  const rows = (implied || []).slice(0, 9);
  if (!rows.length) return <p className="status">Too few expiries.</p>;
  const lo = Math.min(...rows.map((r) => r.q[0]), index), hi = Math.max(...rows.map((r) => r.q[4]), index);
  const W2 = 640, L = 64, R = 12, rowH = 26, H = rows.length * rowH + 26;
  const X = (v) => L + ((v - lo) / (hi - lo || 1)) * (W2 - L - R);
  return (
    <svg className="viz" viewBox={`0 0 ${W2} ${H}`} role="img" aria-label="Price ranges option prices imply, by expiry">
      <line x1={X(index)} x2={X(index)} y1={4} y2={H - 20} stroke="var(--fg)" strokeDasharray="4 3" />
      {rows.map((r, i) => {
        const y = 8 + i * rowH;
        return (
          <g key={r.expiry}>
            <text x={0} y={y + 13}>{new Date(r.expiry * 1000).toISOString().slice(5, 10)}</text>
            <rect x={X(r.q[0])} y={y + 7} width={X(r.q[4]) - X(r.q[0])} height={4} fill="var(--orange-lo)" opacity=".7" />
            <rect x={X(r.q[1])} y={y + 3} width={X(r.q[3]) - X(r.q[1])} height={12} fill="var(--orange)" />
            <rect x={X(r.q[2]) - 1} y={y + 1} width={2} height={16} fill="var(--fg)" />
            <title>{`${Math.round(r.days)} days: middle ${price(r.q[2])}; half between ${price(r.q[1])} and ${price(r.q[3])}; eight in ten between ${price(r.q[0])} and ${price(r.q[4])}`}</title>
          </g>);
      })}
      <text x={X(lo)} y={H - 4}>{price(lo)}</text>
      <text x={X(index)} y={H - 4} textAnchor="middle" style={{ fill: "var(--fg)" }}>{price(index)}</text>
      <text x={X(hi)} y={H - 4} textAnchor="end">{price(hi)}</text>
    </svg>
  );
}

/** Taker buying vs selling of calls, puts and the perp, as mirrored bars (notional). */
export function TakerFlow({ flow }) {
  const kinds = [["call", "Calls"], ["put", "Puts"], ["perp", "Perp"]].filter(([k]) => flow?.[k]);
  if (!kinds.length) return <p className="status">No trades in the collected portion of this window.</p>;
  const max = Math.max(...kinds.map(([k]) => Math.max(flow[k].buy_notional_usd, flow[k].sell_notional_usd)), 1);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="mono" style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr", fontSize: 11, color: "var(--muted)" }}>
        <span /><span style={{ textAlign: "right", paddingRight: 8 }}>Sold</span><span style={{ paddingLeft: 8 }}>Bought</span>
      </div>
      {kinds.map(([k, label]) => {
        const f = flow[k];
        return (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr", alignItems: "center", gap: 0 }}>
            <span className="label" style={{ color: "var(--fg-2)" }}>{label}</span>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, borderRight: "1px solid var(--seam-hi)", paddingRight: 6 }}>
              <span className="mono dim" style={{ fontSize: 12 }}>{usd(f.sell_notional_usd)}</span>
              <i style={{ height: 14, width: `${(f.sell_notional_usd / max) * 70}%`, background: "var(--sig-exit)", display: "block" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 6 }}>
              <i style={{ height: 14, width: `${(f.buy_notional_usd / max) * 70}%`, background: "var(--orange)", display: "block" }} />
              <span className="mono dim" style={{ fontSize: 12 }}>{usd(f.buy_notional_usd)}</span>
            </div>
          </div>);
      })}
    </div>
  );
}
