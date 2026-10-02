import { Info } from "./ui.jsx";
import { pct, price } from "../lib/format.js";
import { moveScale } from "../lib/research.js";
export function MoveBand({ index, iv, days = 30, compact = false }) {
  const scale = moveScale(index, iv, days);
  return (
    <div className={`move-instrument ${compact ? "compact" : ""}`}>
      <span className="label">
        {days}-day priced movement{" "}
        <Info label={`Explain ${days}-day priced movement`}>
          Index × annualised ATM implied volatility × √({days}/365). This
          arithmetic one-standard-deviation scale describes the size of movement
          priced into options. It is symmetric, ignores strike skew and is not a
          price forecast. The centre is the quoted index, not a model median.
        </Info>
      </span>
      <div className="move-reading">
        <strong>{scale ? `±${pct(scale.fraction)}` : "Unavailable"}</strong>
        {scale && <span>±${price(scale.move)}</span>}
      </div>
      {scale && (
        <>
          <div className="move-axis" aria-hidden="true">
            <span />
            <i />
            <b />
            <i />
            <span />
          </div>
          <div className="move-labels">
            <span>
              ${price(scale.lower)}
              <small>Lower scale</small>
            </span>
            <span>
              ${price(index)}
              <small>Index</small>
            </span>
            <span>
              ${price(scale.upper)}
              <small>Upper scale</small>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
export function SkewInstrument({ rr }) {
  const valid = Number.isFinite(rr);
  return (
    <div className="skew-instrument">
      <span className="label">
        30d protection premium{" "}
        <Info>
          25-delta call IV minus put IV, in volatility points, interpolated to
          30 days. Negative means puts are priced richer for comparable delta;
          positive means calls are richer. This does not identify trade
          direction or trader intent.
        </Info>
      </span>
      <strong>
        {!valid
          ? "Unavailable"
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
export function VolatilityTenors({ features }) {
  const items = [7, 30, 90].map((d) => ({ d, iv: features?.[`atm_iv_${d}d`] }));
  const max = Math.max(
    0.01,
    ...items.map((i) => (Number.isFinite(i.iv) ? i.iv : 0)),
  );
  return (
    <div className="tenor-instrument">
      <span className="label">
        Volatility term structure{" "}
        <Info>
          Annualised ATM implied volatility at fixed tenors, interpolated across
          available expiries. Compare the labelled percentages; bars share a
          scale within this market. Longer tenors above shorter ones form an
          upward curve. Missing tenors are not estimated here.
        </Info>
      </span>
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
