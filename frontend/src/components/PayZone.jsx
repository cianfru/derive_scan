import { money, cents, payAt } from "../lib/questions.js";

/** The 0-to-$1 ramp over the settlement price: nothing on one side of the zone, $1 on the other,
 * a straight line between. It falls for No. The price now is the orange hairline. */
export default function PayZone({ lo, hi, side = "yes", index = null, compact = false }) {
  const W = compact ? 64 : 320, H = compact ? 18 : 92;
  const pad = compact ? 2 : 14, top = compact ? 2 : 10, base = compact ? H - 2 : H - 26;
  const span = hi - lo;
  const x0 = lo - span * 0.6, x1 = hi + span * 0.6;
  const x = (v) => pad + ((v - x0) / (x1 - x0)) * (W - 2 * pad);
  const y = (p) => base - p * (base - top);
  const yes = side === "yes";
  const path = `M${pad},${y(yes ? 0 : 1)} L${x(lo)},${y(yes ? 0 : 1)} L${x(hi)},${y(yes ? 1 : 0)} L${W - pad},${y(yes ? 1 : 0)}`;
  const now = index != null && index > x0 && index < x1 ? x(index) : null;
  const label = yes ? `Pays $1 from ${money(hi)}, nothing at or below ${money(lo)}, part of it in between`
    : `Pays $1 at or below ${money(lo)}, nothing from ${money(hi)}, part of it in between`;
  if (compact) {
    return (
      <svg className="payzone mini" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <path d={path} className="pz-line" />
        {now != null && <line x1={now} x2={now} y1={0} y2={H} className="pz-now" />}
      </svg>
    );
  }
  return (
    <figure className="payzone-fig">
      <svg className="payzone" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="pz-axis" />
        <line x1={pad} x2={W - pad} y1={y(1)} y2={y(1)} className="pz-axis faint" />
        <rect x={x(lo)} y={top} width={x(hi) - x(lo)} height={base - top} className="pz-zone" />
        <path d={path} className="pz-line" />
        {now != null && <line x1={now} x2={now} y1={top - 6} y2={base + 4} className="pz-now" />}
        <text x={pad} y={y(1) + 4} className="pz-t" textAnchor="start" dy="-6">$1</text>
        <text x={pad} y={y(0) - 4} className="pz-t" textAnchor="start">0</text>
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <text key={v} x={x(v)} y={H - 8} className="pz-t mono" textAnchor="middle">{money(v)}</text>
        ))}
      </svg>
      <figcaption className="pz-cap">
        <span>At {money((lo + hi) / 2)}: <b className="mono">{cents(Math.round(payAt((lo + hi) / 2, lo, hi, side) * 100))}</b></span>
        <span>{yes ? <>$1 from <b className="mono">{money(hi)}</b></> : <>$1 at or below <b className="mono">{money(lo)}</b></>}</span>
        <span>{yes ? <>Nothing at or below <b className="mono">{money(lo)}</b></> : <>Nothing from <b className="mono">{money(hi)}</b></>}</span>
      </figcaption>
    </figure>
  );
}
