import { useLayoutEffect, useRef, useState } from "react";
import { money, cents, payAt } from "../lib/questions.js";

/** The width the chart is drawn at, so lines, dot and labels keep their size on any screen. */
function useWidth(ref, off) {
  const [w, setW] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (off || !el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [off]);
  return w;
}

/** The 0-to-$1 ramp over the settlement price: nothing on one side of the zone, $1 on the other,
 * a straight line between. It falls for Lower. The price now is the orange hairline; `mark` puts a
 * dot on the ramp at a settlement price (the outcome slider); `plain` drops the caption. */
export default function PayZone({ lo, hi, side = "yes", index = null, compact = false, mark = null, plain = false }) {
  const box = useRef(null);
  const measured = useWidth(box, compact);
  const W = compact ? 64 : measured || 320;
  // Drawn at its real width: a fixed height band, never taller as the screen gets wider.
  const H = compact ? 18 : Math.round(Math.min(150, Math.max(96, W * 0.3)));
  const pad = compact ? 2 : 14, top = compact ? 2 : 12, base = compact ? H - 2 : H - 26;
  const span = hi - lo;
  const x0 = lo - span * 0.6, x1 = hi + span * 0.6;
  const x = (v) => pad + ((v - x0) / (x1 - x0)) * (W - 2 * pad);
  const y = (p) => base - p * (base - top);
  const yes = side === "yes";
  const path = `M${pad},${y(yes ? 0 : 1)} L${x(lo)},${y(yes ? 0 : 1)} L${x(hi)},${y(yes ? 1 : 0)} L${W - pad},${y(yes ? 1 : 0)}`;
  const now = index != null && index > x0 && index < x1 ? x(index) : null;
  const label = yes ? `Pays $1 from ${money(hi)}, nothing at or below ${money(lo)}, part of it in between`
    : `Pays $1 at or below ${money(lo)}, nothing from ${money(hi)}, part of it in between`;
  const mx = mark != null ? x(Math.min(x1, Math.max(x0, mark))) : null;
  if (compact) {
    return (
      <svg className="payzone mini" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <path d={path} className="pz-line" />
        {now != null && <line x1={now} x2={now} y1={0} y2={H} className="pz-now" />}
      </svg>
    );
  }
  return (
    <figure className="payzone-fig" ref={box}>
      <svg className="payzone" width={measured ? W : undefined} height={measured ? H : undefined} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="pz-axis" />
        <line x1={pad} x2={W - pad} y1={y(1)} y2={y(1)} className="pz-axis faint" />
        <rect x={x(lo)} y={top} width={x(hi) - x(lo)} height={base - top} className="pz-zone" />
        <path d={path} className="pz-line" />
        {now != null && <line x1={now} x2={now} y1={top - 6} y2={base + 4} className="pz-now" />}
        {mx != null && <><line x1={mx} x2={mx} y1={top} y2={base} className="pz-mark-line" /><circle cx={mx} cy={y(payAt(mark, lo, hi, side))} r={5} className="pz-mark" /></>}
        <text x={pad} y={y(1) + 4} className="pz-t" textAnchor="start" dy="-6">$1</text>
        <text x={pad} y={y(0) - 4} className="pz-t" textAnchor="start">0</text>
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <text key={v} x={x(v)} y={H - 8} className="pz-t mono" textAnchor="middle">{money(v)}</text>
        ))}
      </svg>
      {!plain && <figcaption className="pz-cap">
        <span>At {money((lo + hi) / 2)}: <b className="mono">{cents(Math.round(payAt((lo + hi) / 2, lo, hi, side) * 100))}</b></span>
        <span>{yes ? <>$1 from <b className="mono">{money(hi)}</b></> : <>$1 at or below <b className="mono">{money(lo)}</b></>}</span>
        <span>{yes ? <>Nothing at or below <b className="mono">{money(lo)}</b></> : <>Nothing from <b className="mono">{money(hi)}</b></>}</span>
      </figcaption>}
    </figure>
  );
}
