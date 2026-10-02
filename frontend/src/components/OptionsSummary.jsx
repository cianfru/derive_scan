import { pct, price } from "../lib/format.js";
import { Info } from "./ui.jsx";
export default function OptionsSummary({ features, index, compact = false }) {
  const f = features || {},
    rr = f.rr25_30d,
    iv = f.atm_iv_30d;
  const hasSkew = Number.isFinite(rr),
    move =
      Number.isFinite(iv) && Number.isFinite(index) && index > 0
        ? index * iv * Math.sqrt(30 / 365)
        : null;
  const headline = !hasSkew
    ? "Skew is unavailable"
    : Math.abs(rr) < 0.001
      ? "Calls and puts are priced similarly"
      : rr < 0
        ? "Downside protection is priced richer"
        : "Upside calls are priced richer";
  return (
    <div className={`options-observation ${compact ? "compact" : ""}`}>
      <div>
        <span className="label">
          What the surface says{" "}
          <Info label="Explain options surface reading">
            Compares 30-day 25-delta call and put implied volatilities,
            interpolated across expiries. Richer means higher implied volatility
            for comparable delta, not a higher dollar premium. A higher price of
            protection does not tell us whether the next price move is up or
            down.
          </Info>
        </span>
        <h3>{headline}</h3>
        <p>
          {hasSkew
            ? `${Math.abs(rr * 100).toFixed(2)} volatility points between 25-delta calls and puts.`
            : "This snapshot has no usable 30-day risk reversal."}
        </p>
      </div>
      {!compact && (
        <div>
          <span className="label">
            30-day move scale{" "}
            <Info label="Explain the 30-day move scale">
              Index × annualised ATM implied volatility × √(30/365). This
              approximate one-standard-deviation scale describes the size of
              movement priced into options. It is symmetric and separate from
              the strike-aware ranges on the chart. Both describe current market
              pricing.
            </Info>
          </span>
          <strong>{move == null ? "Unavailable" : `±$${price(move)}`}</strong>
          <p>
            {Number.isFinite(iv)
              ? `${pct(iv)} annualised at-the-money volatility`
              : "ATM volatility unavailable"}
          </p>
        </div>
      )}
    </div>
  );
}
