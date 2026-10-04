import { useId, useState } from "react";
import { Info } from "./ui.jsx";
import "../saloon-demo.css";

// Unitless examples keep the lesson separate from the market's quotes.
const LOW = 35;
const HIGH = 65;
const COST = 0.38;
const x = (price) => 42 + price * 4.96;
const y = (payout) => 150 - payout * 122;
const ramp = (price, direction) => {
  const higher = Math.max(0, Math.min(1, (price - LOW) / (HIGH - LOW)));
  return direction === "higher" ? higher : 1 - higher;
};
const payoutName = (payout) => payout === 0 ? "No payout" : payout === 1 ? "Full payout" : "Partial payout";
const priceName = (price) => price <= LOW ? "Below the payout zone" : price >= HIGH ? "Above the payout zone" : "Inside the payout zone";
const resultName = (payout) => payout === 0 ? "Loss: full entry cost" : Math.abs(payout - COST) < 0.0001 ? "Entry cost recovered" : payout < COST ? "Less back than you paid" : "More back than you paid";

export default function SaloonDemo() {
  const [direction, setDirection] = useState(null);
  const [price, setPrice] = useState(50);
  const id = useId();
  const payout = direction ? ramp(price, direction) : null;
  const resultTone = payout == null || Math.abs(payout - COST) < 0.0001 ? "neutral" : payout < COST ? "down" : "up";
  const line = (side) => `M ${x(0)} ${y(ramp(0, side))} L ${x(LOW)} ${y(ramp(LOW, side))} L ${x(HIGH)} ${y(ramp(HIGH, side))} L ${x(100)} ${y(ramp(100, side))}`;
  const choose = (side) => { setDirection(side); setPrice(50); };

  return (
    <section className={`saloon-demo${direction ? " is-selected" : ""}`} aria-labelledby={`${id}-title`}>
      <div className="sd-heading">
        <h3 id={`${id}-title`}>See what it pays</h3>
        <span className="sd-illustration">Illustration</span>
      </div>
      <div className="sd-direction" role="group" aria-label="Choose an illustrative direction">
        <button type="button" aria-pressed={direction === "higher"} onClick={() => choose("higher")}>
          Higher <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12 12 3M4 3h8v8" /></svg>
        </button>
        <button type="button" aria-pressed={direction === "lower"} onClick={() => choose("lower")}>
          Lower <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 4 9 9M4 13h8V5" /></svg>
        </button>
        <span>{direction ? "Then move the settlement price" : "Choose a direction to begin"}</span>
      </div>

      <div className="sd-plot">
        <div className="sd-plot-title"><span>Settlement payout</span><span>Most it pays</span></div>
        <div className="sd-chart-wrap">
        <svg className="sd-chart" viewBox="0 0 580 176" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-wash`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--up)" stopOpacity=".17" />
              <stop offset="1" stopColor="var(--up)" stopOpacity=".01" />
            </linearGradient>
          </defs>
          <rect className="sd-zone" x={x(LOW)} y="14" width={x(HIGH) - x(LOW)} height="137" />
          {[0, 0.5, 1].map((level) => <line key={level} className="sd-grid" x1={x(0)} x2={x(100)} y1={y(level)} y2={y(level)} />)}
          {[LOW, HIGH].map((bound) => <line key={bound} className="sd-bound" x1={x(bound)} x2={x(bound)} y1="14" y2="151" />)}
          <line className="sd-cost" x1={x(0)} x2={x(100)} y1={y(COST)} y2={y(COST)} />
          {direction ? <>
            <path d={`${line(direction)} L ${x(100)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill={`url(#${id}-wash)`} />
            <path className="sd-payoff" d={line(direction)} />
            <line className="sd-cursor" x1={x(price)} x2={x(price)} y1="14" y2="151" />
          </> : <>
            <path className="sd-ghost" d={line("higher")} />
            <path className="sd-ghost" d={line("lower")} />
          </>}
        </svg>
        <span className="sd-cost-label">Entry cost</span>
        <span className="sd-zero-label">Nothing back</span>
        <span className="sd-zone-label">Pays in part</span>
        {direction && <span aria-hidden="true" className="sd-plot-marker" style={{ left: `${x(price) / 580 * 100}%`, top: `${y(payout) / 176 * 100}%` }} />}
        </div>
      </div>

      <div className="sd-slider">
        <label htmlFor={`${id}-price`}>Price at settlement</label>
        <input id={`${id}-price`} type="range" min="0" max="100" step="0.1" value={price} disabled={!direction}
          aria-valuetext={direction ? `${priceName(price)}: ${payoutName(payout)}. ${resultName(payout)}.` : "Choose Higher or Lower first"}
          onChange={(event) => setPrice(Number(event.target.value))} />
        <div className="sd-price-ends" aria-hidden="true"><span>Lower price</span><span>Higher price</span></div>
      </div>

      <div className={`sd-result sd-result-${resultTone}`} role="status" aria-live="polite" aria-atomic="true">
        <span className="sd-result-label">At this settlement price</span>
        <strong>{direction ? payoutName(payout) : "Your choice, made visible."}</strong>
        <span>{direction ? resultName(payout) : "Explore the payout before the trade."}</span>
      </div>
      <div className="sd-foot">
        <span>Payout is the total back, before subtracting cost.</span>
        <Info label="How this payout illustration works">This shape is an illustration, not a market quote. The dashed line is a fixed total entry cost, including fees. Payout above that line is profit; below it is a loss. The most you can lose is that total cost only when both options of the debit package are filled and held to settlement. The first order on its own can need more cash and lose more than the completed package. Selling back early uses the prices then, rather than this settlement curve.</Info>
      </div>
    </section>
  );
}
