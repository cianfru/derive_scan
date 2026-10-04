import { useEffect, useId, useRef, useState } from "react";
import { Info } from "./ui.jsx";
import { budgetTicket, outcome, breakeven, money, signed } from "../lib/questions.js";
import "../saloon-demo.css";

// One worked example with fixed, made-up numbers (never a live quote): BTC higher or lower than
// $85,000 on a Friday, paying in part between $82,000 and $88,000. The figures come from the
// Saloon's own maths (budgetTicket sizes $100 including Derive's fee schedule; outcome() gives the
// payout and profit or loss at a settlement price), so the lesson matches what the board shows.
const LO = 82000, HI = 88000, K = 85000;
const W = HI - LO;
const EXAMPLE = {
  id: "EXAMPLE", k: K, lo: LO, hi: HI,
  // Higher 55c and Lower 48c per $1 paid out, as two-option debit packages across the zone.
  yes: { state: "open", buy: 0.55, size: 1e6, form: "debit", legs: [["BTC-EX-82000-C", "buy", 4300], ["BTC-EX-88000-C", "sell", 1000]] },
  no: { state: "open", buy: 0.48, size: 1e6, form: "debit", legs: [["BTC-EX-88000-P", "buy", 3600], ["BTC-EX-82000-P", "sell", 720]] },
};
const BOARD = { index: K, spec: { tick: 1, min: 0.01, step: 0.00001, taker: 0.0003, base: 0.5, cap: 0.125 } };
const BUDGET = 100;
const TICKETS = { yes: budgetTicket(EXAMPLE, "yes", BUDGET, BOARD), no: budgetTicket(EXAMPLE, "no", BUDGET, BOARD) };
const SIDES = [
  { key: "yes", name: "Higher", cents: 55, full: `full $1 from ${money(HI)}` },
  { key: "no", name: "Lower", cents: 48, full: `full $1 at or below ${money(LO)}` },
];
const START = { yes: 87000, no: 83000 };

// Chart geometry in CSS pixels: the viewBox follows the plot's width, so labels stay 12px on a phone.
// Prices run from $79,000 to $91,000.
const MIN = 79000, MAX = 91000, STEP = 250;
const VH = 200, L = 50, R = 12, T = 12, B = 30;
const top = Math.max(TICKETS.yes.payout, TICKETS.no.payout);
const py = (v) => T + (1 - v / top) * (VH - T - B);
const usd = (v) => money(v, { cents: true });
const whole = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const clamp = (p) => Math.min(MAX, Math.max(MIN, Math.round(p / STEP) * STEP));

function payoffPath(side, px) {
  const t = TICKETS[side];
  return [MIN, LO, HI, MAX].map((p, i) => `${i ? "L" : "M"}${px(p).toFixed(1)},${py(outcome(t, EXAMPLE, side, p).payout).toFixed(1)}`).join(" ");
}
const zoneText = (side, p) => {
  const f = outcome(TICKETS[side], EXAMPLE, side, p).payout / TICKETS[side].payout;
  return f <= 1e-9 ? "Pays nothing" : f >= 1 - 1e-9 ? "Pays in full" : "Pays in part";
};

export default function SaloonDemo() {
  const [side, setSide] = useState(null);
  const [price, setPrice] = useState(K);
  const id = useId();
  const svg = useRef(null);
  const plot = useRef(null);
  const [VW, setVW] = useState(560);
  useEffect(() => {
    const node = plot.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => { const w = Math.round(entry.contentRect.width); if (w > 0) setVW(Math.max(280, w)); });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const px = (p) => L + (p - MIN) / (MAX - MIN) * (VW - L - R);
  const t = side ? TICKETS[side] : null;
  const o = t ? outcome(t, EXAMPLE, side, price) : null;
  const tone = !o ? "neutral" : o.pl > 0.004 ? "up" : o.pl < -0.004 ? "down" : "neutral";
  const be = t ? breakeven(t, EXAMPLE, side) : null;
  const choose = (key) => { setSide(key); setPrice(START[key]); };

  // Dragging on the chart moves the settlement price, like the slider below it.
  const fromPointer = (event) => {
    const box = svg.current.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width * VW;
    setPrice(clamp(MIN + (x - L) / (VW - L - R) * (MAX - MIN)));
  };
  const down = (event) => { if (!side) return; event.currentTarget.setPointerCapture?.(event.pointerId); fromPointer(event); };
  const move = (event) => { if (side && event.buttons) fromPointer(event); };

  return (
    <section className={`saloon-demo${side ? ` is-${side}` : ""}`} aria-labelledby={`${id}-title`}>
      <div className="sd-heading">
        <h3 id={`${id}-title`}>See what it pays</h3>
        <span className="sd-illustration">Illustration</span>
      </div>

      <div className="sd-card">
        <p className="sd-example">Example: pick Higher or Lower</p>
        <p className="sd-question">BTC higher or lower than {money(K)} on a Friday, 08:00 UTC?</p>
        <div className="sd-choices" role="group" aria-label="Pick an example answer">
          {SIDES.map((s) => (
            <button key={s.key} type="button" className={`sd-choice ${s.key}`} aria-pressed={side === s.key} aria-label={s.name} onClick={() => choose(s.key)}>
              <span className="sd-choice-top"><span><i className={`sd-arrow ${s.key}`} aria-hidden="true" />{s.name}</span><b>{s.cents}<small>¢</small></b></span>
              <small>{s.full}</small>
            </button>))}
        </div>
        <p className="sd-per">Price per $1 it pays at settlement, before fees.</p>
      </div>

      {t && <dl className="sd-figs">
        <div><dt>You put in</dt><dd>{usd(t.mostLose)}</dd></div>
        <div><dt>Fees included</dt><dd>{usd(t.fees)}</dd></div>
        <div><dt>Most it pays</dt><dd>{usd(t.payout)}</dd></div>
      </dl>}

      <div className="sd-plot" ref={plot}>
        <svg ref={svg} className="sd-chart" viewBox={`0 0 ${VW} ${VH}`} role="img"
          aria-label={t ? `Payout line for ${side === "yes" ? "Higher" : "Lower"}: nothing ${side === "yes" ? "below" : "above"} ${money(side === "yes" ? LO : HI)}, in part between ${money(LO)} and ${money(HI)}, ${usd(t.payout)} ${side === "yes" ? "from" : "at or below"} ${money(side === "yes" ? HI : LO)}` : "Payout chart, empty until you pick Higher or Lower"}
          onPointerDown={down} onPointerMove={move} style={{ touchAction: side ? "pan-y" : "auto" }}>
          <rect className="sd-zone" x={px(LO)} y={T} width={px(HI) - px(LO)} height={VH - T - B} />
          <text className="sd-zone-label" x={(px(LO) + px(HI)) / 2} y={T + 14} textAnchor="middle">Pays in part</text>
          <line className="sd-axis" x1={L} x2={VW - R} y1={py(0)} y2={py(0)} />
          {[LO, K, HI].map((p) => <g key={p}>
            <line className="sd-tick" x1={px(p)} x2={px(p)} y1={py(0)} y2={py(0) + 5} />
            <text className="sd-x" x={px(p)} y={VH - 10} textAnchor="middle">{whole(p)}</text>
          </g>)}
          <text className="sd-y" x={L - 8} y={py(0) + 4} textAnchor="end">$0</text>
          {t && <>
            <line className="sd-grid" x1={L} x2={VW - R} y1={py(t.payout)} y2={py(t.payout)} />
            <text className="sd-y" x={L - 8} y={py(t.payout) + 4} textAnchor="end">{whole(t.payout)}</text>
            <line className="sd-cost" x1={L} x2={VW - R} y1={py(t.mostLose)} y2={py(t.mostLose)} />
            <text className="sd-y" x={L - 8} y={py(t.mostLose) + 4} textAnchor="end">{whole(t.mostLose)}</text>
            <text className="sd-cost-label" x={side === "yes" ? L + 6 : VW - R - 6} y={py(t.mostLose) - 6} textAnchor={side === "yes" ? "start" : "end"}>You put in</text>
            <path className={`sd-payoff ${side}`} d={payoffPath(side, px)} />
            <line className="sd-cursor" x1={px(price)} x2={px(price)} y1={T} y2={py(0)} />
            <circle className={`sd-dot ${side}`} cx={px(price)} cy={py(o.payout)} r="6" />
          </>}
          {!t && <text className="sd-empty" x={(L + VW - R) / 2} y={py(0) - 46} textAnchor="middle">Pick Higher or Lower to draw its payout</text>}
        </svg>
      </div>

      <div className="sd-slider">
        <label htmlFor={`${id}-price`}>Settlement price{t && <b>{money(price)}</b>}</label>
        <input id={`${id}-price`} type="range" min={MIN} max={MAX} step={STEP} value={price} disabled={!side}
          aria-valuetext={o ? `${money(price)}: you get ${usd(o.payout)}, ${signed(o.pl)}` : "Pick Higher or Lower first"}
          onChange={(event) => setPrice(Number(event.target.value))} />
      </div>

      <div className={`sd-result sd-result-${tone}`} role="status" aria-live="polite" aria-atomic="true">
        {o ? <>
          <span className="sd-result-line">If BTC settles at {money(price)}: you get <b>{usd(o.payout)}</b></span>
          <strong>{signed(o.pl)}</strong>
          <span className="sd-result-note">{zoneText(side, price)}{be != null ? `. Breakeven ${money(be)}` : ""}</span>
        </> : <span className="sd-result-line">Pick an answer, then drag the settlement price.</span>}
      </div>

      <div className="sd-foot">
        <span>Made-up example prices, not a live quote.</span>
        <Info label="How this payout illustration works">These numbers are an illustration, not a market quote. You put in $100 in total, including fees. The payout is what comes back at settlement; profit or loss is that payout minus the $100. The most you can lose is that total cost only when both options of the debit package are filled and held to settlement. The first order on its own can need more cash and lose more than the completed package. Selling back early uses the prices then, rather than this settlement line.</Info>
      </div>
    </section>
  );
}
