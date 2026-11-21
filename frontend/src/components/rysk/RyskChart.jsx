// Rysk on the Saloon's chart (owner, 10 October 2026: "a similar picture of the saloon ... something
// visual"): the coin's last 12 days of 4-hour candles on the left, a Now line, then one column per Friday
// Rysk lists. Each level is a bubble: above the price, selling the coin at that level; below it, buying
// the coin at that level with USDC. The figure inside is about what Rysk's smallest size pays now.
// Levels without room for a bubble are small dots; a click on either opens the trade panel.
import { useMemo } from "react";
import { useElementWidth } from "../../lib/useElementWidth.js";
import { money } from "../../lib/questions.js";
import { premiumEstimate } from "../../lib/rysk/market.js";

const day = (ts) => new Date(ts * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const left = (ts, now) => { const s = Math.max(0, ts - now), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return d ? `in ${d}d ${h}h` : `in ${h}h`; };
const dollars = (v) => (v >= 100 ? `$${Math.round(v).toLocaleString("en-US")}` : v >= 10 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`);
const fmtP = (v) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v >= 10 ? v.toFixed(1) : v.toFixed(v >= 1 ? 2 : 4));

/** Which levels get a bubble and which a dot, per date: nearest the price first, no two bubbles touching. */
export function ryskBubbles(dates, { price, y, R, lo, hi, nowSec, market }) {
  return dates.map((d) => {
    const all = [...d.call.filter((l) => l.strike >= price), ...d.put.filter((l) => l.strike < price)]
      .filter((l) => l.strike >= lo && l.strike <= hi)
      .map((l) => ({ ...l, est: premiumEstimate(l, market, nowSec) }));
    const max = Math.max(1e-9, ...all.map((l) => l.est || 0));
    const placed = [];
    for (const l of [...all].sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))) {
      const r = l.est ? R * (0.78 + 0.22 * Math.sqrt(l.est / max)) : R * 0.75;
      const yy = y(l.strike);
      const room = placed.every((p) => p.dot || Math.abs(p.y - yy) >= p.r + r + 3);
      placed.push({ ...l, y: yy, r: room ? r : 5, dot: !room });
    }
    return { ...d, marks: placed };
  });
}

export default function RyskChart({ coin, market, candles, price, nowSec, selected, onPick }) {
  const [ref, width] = useElementWidth(960);
  const phone = width < 700;
  const W = Math.max(width || 960, phone ? 640 : 760), H = phone ? 440 : 580;
  const m = { l: 12, r: 64, t: 62, b: 28 };
  const pastW = (W - m.l - m.r) * (phone ? 0.28 : 0.34), futX = m.l + pastW;
  const dates = market.dates;
  const colW = (W - m.r - futX) / Math.max(1, dates.length);
  const cols = dates.map((_, i) => futX + colW * (i + 0.5));
  const R = phone ? 24 : 27;
  const cs = candles || [];
  const geo = useMemo(() => {
    const lows = cs.map((c) => c[3]), highs = cs.map((c) => c[2]);
    const lo0 = Math.min(price * 0.9, ...lows), hi0 = Math.max(price * 1.1, ...highs);
    const lo = lo0 * 0.985, hi = hi0 * 1.015;
    const y = (p) => m.t + ((hi - p) / (hi - lo)) * (H - m.t - m.b);
    return { lo, hi, y };
  }, [cs, price, H]);
  const { lo, hi, y } = geo;
  const placed = ryskBubbles(dates, { price, y, R, lo, hi, nowSec, market });
  const bw = cs.length ? pastW / cs.length : 0;
  const ticks = useMemo(() => { const n = 5, out = []; for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n); return out; }, [lo, hi]);
  const sel = selected ? `${selected.key}` : null;
  const minText = `${(Number(market.token.min) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${coin}`;
  return (
    <div ref={ref} className="rk-chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${coin} 4-hour candles, then Rysk's levels on each Friday`}>
        {ticks.map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="rk-grid" /><text x={W - m.r + 8} y={y(t) + 4} className="rk-axis">{fmtP(t)}</text></g>)}
        {cs.map((c, i) => {
          const x = m.l + i * bw + bw / 2, up = c[4] >= c[1];
          return <g key={c[0]} className={up ? "rk-c up" : "rk-c down"}>
            <line x1={x} x2={x} y1={y(c[2])} y2={y(c[3])} />
            <rect x={x - Math.max(1, bw * 0.32)} width={Math.max(2, bw * 0.64)} y={y(Math.max(c[1], c[4]))} height={Math.max(1, Math.abs(y(c[1]) - y(c[4])))} />
          </g>;
        })}
        <line x1={futX} x2={futX} y1={m.t - 26} y2={H - m.b} className="rk-now" />
        <text x={futX - 8} y={m.t - 32} className="rk-now-label" textAnchor="end">Now</text>
        <line x1={m.l} x2={W - m.r} y1={y(price)} y2={y(price)} className="rk-price" />
        <text x={W - m.r + 8} y={y(price) + 4} className="rk-price-label">{fmtP(price)}</text>
        {dates.map((d, i) => <g key={d.expiry}>
          <line x1={cols[i]} x2={cols[i]} y1={m.t - 4} y2={H - m.b} className="rk-col" />
          <text x={cols[i]} y={m.t - 40} className="rk-date" textAnchor="middle">{day(d.expiry)}</text>
          <text x={cols[i]} y={m.t - 22} className="rk-left" textAnchor="middle">{phone ? left(d.expiry, nowSec) : `08:00 · ${left(d.expiry, nowSec)}`}</text>
        </g>)}
        {placed.map((d, i) => d.marks.map((l) => {
          const key = l.key, on = sel === key, sale = !l.isPut;
          const words = `${sale ? "Sell" : "Buy"} ${coin} at ${money(l.strike)} on ${day(l.expiry)}: about ${l.est != null ? dollars(l.est) : "an unknown amount"} now for ${minText}${l.apr != null ? `, ${l.apr.toFixed(1)}% APR` : ""}`;
          const pick = () => onPick(l);
          return <g key={key} className={`rk-b ${sale ? "sell" : "buy"}${l.dot ? " dot" : ""}${on ? " on" : ""}`} transform={`translate(${cols[i]},${l.y})`}
            tabIndex={0} role="button" aria-label={words} aria-pressed={on}
            onClick={pick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }}>
            <title>{words}</title>
            <circle r={l.r} />
            {!l.dot && <>
              <text y={-l.r * 0.28} className="rk-b-side" textAnchor="middle">{sale ? "Sell" : "Buy"}</text>
              <text y={l.r * 0.42} className="rk-b-fig" textAnchor="middle">{l.est != null ? dollars(l.est) : "—"}</text>
              <text x={l.r + 6} y={4} className="rk-b-level">{fmtP(l.strike)}</text>
            </>}
          </g>;
        }))}
      </svg>
    </div>
  );
}
