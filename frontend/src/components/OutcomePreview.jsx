import { useId, useMemo, useState } from "react";
import PayZone from "./PayZone.jsx";
import { ExposureChart, amount, breakevenText } from "./Exposure.jsx";
import "../journal.css";
import { loadPositions } from "../lib/positions.js";
import { exposureGroups, proposalLegs, withTrade } from "../lib/exposure.js";
import { Info } from "./ui.jsx";
import { breakeven, countdown, dayLabel, fullPay, money, outcome, payAt, signed, sliderStep } from "../lib/questions.js";

const usd = (v) => money(v, { cents: true });
const plWord = (v) => (v > 0.004 ? "profit" : v < -0.004 ? "loss" : "even");
const plText = (v) => (plWord(v) === "even" ? "$0.00" : `${plWord(v)} ${usd(Math.abs(v))}`);
const tone = (v) => (v > 0.004 ? "up" : v < -0.004 ? "down" : "");

/** The figures every preview and ticket shares: what you pay, what it pays, what you can make,
 * breakeven and settlement. Total payout and profit are always two separate lines. */
export function OutcomeFigures({ und, level, side, t, expiry, settleTs, summary, compact = false }) {
  const be = breakeven(t, level, side);
  const most = t.payout - t.mostLose;
  return (
    <dl className={`op-figs${summary ? " summary" : ""}`}>
      {summary ? (
        <div className="op-total"><dt>You pay<Info label="What you pay">{usd(t.premium)} for the two options plus Derive's fees, about {usd(t.fees)}. It is the most you can lose once both orders fill.</Info></dt>
          <dd className="mono">{usd(t.mostLose)} <small>incl. fees</small></dd></div>
      ) : (
        <>
          <div><dt>The two options</dt><dd className="mono">{usd(t.premium)}</dd></div>
          <div><dt>Derive fees, about<Info label="About Derive's fees">Derive charges a fee per option: $0.50 plus a small share of the coin's price, at most an eighth of the option's price. Two options means two fees. These are Derive's published rates; fills often pay less.</Info></dt>
            <dd className="mono">{usd(t.fees)}</dd></div>
          <div className="op-total q-lose"><dt>You pay, the most you can lose<small>fees included{t.budget != null ? `, within your ${usd(t.budget)}` : ""}</small></dt><dd className="mono">{usd(t.mostLose)}</dd></div>
        </>
      )}
      <div><dt>Most it pays<small>total back, {fullPay(level, side)}</small></dt><dd className="mono">{usd(t.payout)}</dd></div>
      <div className="op-make"><dt>Most you can make<small>after what you pay</small></dt>
        <dd className={`mono ${tone(most)}`}>{most > 0 ? signed(most) : "None at this price"}</dd></div>
      <div><dt>Breakeven<Info label="About breakeven">The settlement price where what it pays equals what you pay. {side === "yes" ? "Above it" : "Below it"} you end with more than you paid; {side === "yes" ? "below it" : "above it"}, less. It counts Derive's fees.</Info></dt>
        <dd className="mono">{be == null ? "None at this price" : <>{und} at {money(be)}</>}</dd></div>
      {!compact && <div><dt>Settles</dt><dd className="mono">{dayLabel(expiry)}, 08:00 UTC{countdown(settleTs) && <small> · {countdown(settleTs)}</small>}</dd></div>}
    </dl>
  );
}

/** The expiry-price slider over the ramp: drag or use the arrow keys to see the payout and the
 * profit or loss at any settlement price. */
function Slider({ und, level, side, t, index }) {
  const w = level.hi - level.lo;
  const step = sliderStep(w);
  const min = Math.floor((level.lo - 0.6 * w) / step) * step;
  const max = Math.ceil((level.hi + 0.6 * w) / step) * step;
  const start = Math.min(max, Math.max(min, Math.round((Number.isFinite(index) ? index : level.k) / step) * step));
  const [s, setS] = useState(start);
  const id = useId();
  const o = outcome(t, level, side, s);
  const perDollar = Math.round(payAt(s, level.lo, level.hi, side) * 100);
  const text = `${und} at ${money(s)}: pays ${perDollar}c per $1, you get ${usd(o.payout)}, ${plText(o.pl)}`;
  return (
    <div className="op-sim">
      <p className="op-read" id={`${id}-read`} aria-hidden="true">
        If {und} settles at <b className="mono">{money(s)}</b>, this pays <b className="mono">{perDollar}c</b> per $1: you get <b className="mono">{usd(o.payout)}</b>
        <span className="op-sep"> · </span><b className={`mono ${tone(o.pl)}`}>{plText(o.pl)}</b>
      </p>
      <div className="op-ramp">
        <PayZone lo={level.lo} hi={level.hi} side={side} index={index} mark={s} plain />
        <input type="range" className="op-range" min={min} max={max} step={step} value={s}
          aria-label={`${und} price at settlement`} aria-valuetext={text}
          onChange={(e) => setS(Number(e.target.value))} />
      </div>
    </div>
  );
}

/** Three dollar examples: below the zone, its middle, above it. */
function Examples({ und, level, side, t }) {
  const rows = [
    [`${money(level.lo)} or lower`, level.lo],
    [money(level.k), level.k],
    [`${money(level.hi)} or higher`, level.hi],
  ];
  return (
    <table className="op-ex">
      <thead><tr><th scope="col">If {und} settles at</th><th scope="col">You get</th><th scope="col">Profit / loss</th></tr></thead>
      <tbody>
        {rows.map(([label, v]) => {
          const o = outcome(t, level, side, v);
          return <tr key={label}><th scope="row" className="mono">{label}</th><td className="mono">{usd(o.payout)}</td><td className={`mono ${tone(o.pl)}`}>{signed(o.pl)}</td></tr>;
        })}
      </tbody>
    </table>
  );
}

/** When the user already holds positions on this coin and date: the held result at settlement
 * (dashed) with this trade drawn on top, and the combined figures before and with it. */
export function WithHeld({ und, level, side, t, expiry, index, positions = null }) {
  const group = useMemo(() => exposureGroups(positions ?? loadPositions()).find((g) => g.und === und && g.expiry === expiry) || null,
    [positions, und, expiry]);
  const w = group ? withTrade(group, proposalLegs(level, side, t)) : null;
  if (!w) return null;
  const n = group.items.length;
  return (
    <section className="op-held" aria-label="With what you hold">
      <h3>With what you hold on {dayLabel(expiry)}<Info label="About this view">
        Your {n} open {n === 1 ? "position" : "positions"} on {und} settling {dayLabel(expiry)} at 08:00 UTC, from Positions in this browser, combined with this trade. Both lines are the result at settlement for each price, after what was paid. Selling back early is valued differently.</Info></h3>
      <ExposureChart und={und} index={index} curves={[{ combo: w.held, label: "Now", kind: "held" }, { combo: w.after, label: "With this trade", kind: "with" }]} />
      <p className="op-held-key"><span className="op-key held">Now</span><span className="op-key with">With this trade</span></p>
      <table className="op-ex op-held-t">
        <thead><tr><th scope="col"><span className="sr-only">Figure</span></th><th scope="col">Now</th><th scope="col">With this trade</th></tr></thead>
        <tbody>
          <tr><th scope="row">Most you can lose</th><td className="mono">{amount(w.held.mostLose)}</td><td className="mono">{amount(w.after.mostLose)}</td></tr>
          <tr><th scope="row">Most it pays</th><td className="mono">{amount(w.held.mostPays)}</td><td className="mono">{amount(w.after.mostPays)}</td></tr>
          <tr><th scope="row">Breakeven</th><td className="mono">{breakevenText(w.held)}</td><td className="mono">{breakevenText(w.after)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

/**
 * The outcome preview shared by the question page and every ticket. `summary` keeps the figures
 * only (a ticket beside the full preview); the full one adds the slider, the dollar examples and
 * the line on selling back early.
 */
export function OutcomePayoffStudy({ und, level, side, t, index, expiry }) {
  if (!t) return null;
  return <>
    <Slider und={und} level={level} side={side} t={t} index={index} />
    <Examples und={und} level={level} side={side} t={t} />
    {expiry && <WithHeld und={und} level={level} side={side} t={t} expiry={expiry} index={index} />}
    <p className="op-note">Selling back before 08:00 UTC is valued at Derive's sell-back price then, not by this chart.
      <Info label="About selling back early">Until a minute before 08:00 UTC you can sell back on Derive. You then get what Derive's screen bids for the two options at that moment, which follows the coin's price and the time left, so it differs from this chart, and fees apply again. Holding to 08:00 UTC pays as this chart shows.</Info>
    </p>
  </>;
}

export default function OutcomePreview({ und, level, side, t, expiry, settleTs, index, summary = false }) {
  if (!t) return null;
  return (
    <section className={`op${summary ? " op-summary" : ""}`} aria-label="What you pay and what it pays">
      <OutcomeFigures und={und} level={level} side={side} t={t} expiry={expiry} settleTs={settleTs} summary={summary} />
      {!summary && <OutcomePayoffStudy und={und} level={level} side={side} t={t} index={index} expiry={expiry} />}
    </section>
  );
}
