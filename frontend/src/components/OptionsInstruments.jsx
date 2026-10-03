import { Info } from "./ui.jsx";
import { pct, price, sig3, DASH } from "../lib/format.js";
import { moveScale } from "../lib/research.js";
/** Board cell: the priced move as a band on a scale shared by every row (scaleMax, e.g. 0.4 = +-40%). */
function MoveCell({ index, scale, scaleMax }) {
  if (!scale) return <span className="empty-dash" aria-label="Unavailable">—</span>;
  const half = Math.min(1, scale.fraction / scaleMax) * 50;
  const ticks = [];
  for (let t = 0.1; t < scaleMax - 1e-9; t += 0.1) ticks.push(t);
  return (
    <span className="move-cell" title={`±$${sig3(scale.move)} · $${price(scale.lower)} – $${price(scale.upper)} around $${price(index)}`}>
      <b>±{pct(scale.fraction)}</b>
      <span className="move-track" aria-hidden="true">
        {ticks.flatMap((t) => [50 - (t / scaleMax) * 50, 50 + (t / scaleMax) * 50]).map((x) => <i key={x} style={{ left: `${x}%` }} />)}
        <span className="move-fill" style={{ left: `${50 - half}%`, right: `${50 - half}%` }} />
        <em />
      </span>
    </span>
  );
}
export function MoveBand({ index, iv, days = 30, compact = false, bare = false, scale: scaleMax }) {
  const scale = moveScale(index, iv, days);
  if (scaleMax) return <MoveCell index={index} scale={scale} scaleMax={scaleMax} />;
  return (
    <div className={`move-instrument ${compact ? "compact" : ""}`}>
      {!bare && <span className="label">
        {days}-day priced movement{" "}
        <Info label={`Explain ${days}-day priced movement`}>
          Index × annualised ATM implied volatility × √({days}/365). This
          arithmetic one-standard-deviation scale describes the size of movement
          priced into options. It is symmetric, ignores strike skew and is what
          option prices imply, not our view. The centre is the quoted index, not a model median.
        </Info>
      </span>}
      <div className="move-reading">
        <strong>{scale ? `±${pct(scale.fraction)}` : "—"}</strong>
        {scale && <span>±${sig3(scale.move)}</span>}
      </div>
      {scale && (
        <>
          <div className="move-axis" aria-hidden="true">
            <i className="lo" />
            <i className="hi" />
            <b />
          </div>
          <div className="move-labels">
            <span className="down">${price(scale.lower)}</span>
            <span>${price(index)}</span>
            <span className="up">${price(scale.upper)}</span>
          </div>
        </>
      )}
    </div>
  );
}
/** Board cell: signed 25-delta risk reversal in vol points on a clamp shared by every row. */
function SkewCell({ rr, clamp }) {
  if (!Number.isFinite(rr)) return <span className="empty-dash" aria-label="Unavailable">—</span>;
  const pts = rr * 100, clipped = Math.abs(pts) > clamp;
  const pos = 50 + (Math.max(-clamp, Math.min(clamp, pts)) / clamp) * 50;
  const side = Math.abs(pts) < 0.05 ? "even" : pts < 0 ? "put" : "call";
  return (
    <span className="skew-cell" title={side === "even" ? "Even pricing" : `${side === "put" ? "Puts" : "Calls"} richer by ${Math.abs(pts).toFixed(2)} pts`}>
      <b className={`skew-${side}`}>{pts > 0 ? "+" : pts < 0 ? "−" : ""}{Math.abs(pts).toFixed(1)}</b>
      <span className="skew-track" aria-hidden="true">
        <i />
        <em className={`skew-${side}${clipped ? (pts < 0 ? " clip-lo" : " clip-hi") : ""}`} style={{ left: `${pos}%` }} />
      </span>
    </span>
  );
}
export function SkewInstrument({ rr, bare = false, clamp }) {
  if (clamp) return <SkewCell rr={rr} clamp={clamp} />;
  const valid = Number.isFinite(rr);
  return (
    <div className="skew-instrument">
      {!bare && <span className="label">
        30d protection premium{" "}
        <Info>
          25-delta call IV minus put IV, in volatility points, interpolated to
          30 days. Negative means puts are priced richer for comparable delta;
          positive means calls are richer. This does not identify trade
          direction or trader intent.
        </Info>
      </span>}
      <strong>
        {!valid
          ? "—"
          : Math.abs(rr) < 0.001
            ? "Even pricing"
            : rr < 0
              ? "Puts richer"
              : "Calls richer"}
        <b className={rr < 0 ? "down" : "up"}>
          {valid ? `${Math.abs(rr * 100).toFixed(2)} pts` : "—"}
        </b>
      </strong>
      <div className="skew-axis" aria-hidden="true">
        <i />
        <b
          style={{
            left: `${50 + Math.max(-1, Math.min(1, (rr || 0) / 0.1)) * 45}%`,
          }}
        />
      </div>
      <div className="instrument-extents">
        <span>Puts</span>
        <span>Equal IV</span>
        <span>Calls</span>
      </div>
    </div>
  );
}
/** Board cell: 7/30/90-day ATM IV as a 60x20 line on an IV scale shared by every row ([lo, hi]). */
function TenorCell({ items, ivScale }) {
  const [lo, hi] = ivScale, span = Math.max(1e-6, hi - lo);
  const pts = items.map(({ d, iv }, i) => Number.isFinite(iv) ? { d, iv, x: 4 + i * 26, y: 17 - ((iv - lo) / span) * 14 } : null);
  const mid = items[1].iv;
  if (!pts.some(Boolean)) return <span className="empty-dash" aria-label="Unavailable">—</span>;
  const runs = [];
  pts.forEach((p, i) => { if (p && pts[i - 1]) runs.push(`${pts[i - 1].x},${pts[i - 1].y} ${p.x},${p.y}`); });
  return (
    <span className="tenor-cell" title={items.map(({ d, iv }) => `${d}D ${pct(iv)}`).join(" · ")}>
      <svg width="60" height="20" viewBox="0 0 60 20" aria-hidden="true">
        {runs.map((r) => <polyline key={r} points={r} />)}
        {pts.filter(Boolean).map((p) => <circle key={p.d} cx={p.x} cy={p.y} r="2" />)}
      </svg>
      <b>{Number.isFinite(mid) ? pct(mid) : DASH}</b>
    </span>
  );
}
export function VolatilityTenors({ features, bare = false, ivScale }) {
  const items = [7, 30, 90].map((d) => ({ d, iv: features?.[`atm_iv_${d}d`] }));
  if (ivScale) return <TenorCell items={items} ivScale={ivScale} />;
  const max = Math.max(
    0.01,
    ...items.map((i) => (Number.isFinite(i.iv) ? i.iv : 0)),
  );
  return (
    <div className="tenor-instrument">
      {!bare && <span className="label">
        Volatility term structure{" "}
        <Info>
          Annualised ATM implied volatility at fixed tenors, interpolated across
          available expiries. Compare the labelled percentages; bars share a
          scale within this market. Longer tenors above shorter ones form an
          upward curve. Missing tenors are not estimated here.
        </Info>
      </span>}
      <div className="tenor-bars">
        {items.map(({ d, iv }) => (
          <div key={d}>
            <span>{d}D</span>
            <i>
              {Number.isFinite(iv) && (
                <b style={{ width: `${(iv / max) * 100}%` }} />
              )}
            </i>
            <strong>{pct(iv)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
