import { useId } from "react";
import { Info } from "./ui.jsx";
import {
  ANSWER, SETTLING_SEC, breakeven, budgetTicket, dayLabel, live, money,
  noPriceReason, parseId, priceAge, settlingNow, signed,
} from "../lib/questions.js";
import "../outcome-comparison.css";

const usd = (value) => money(value, { cents: true });
const finite = (value) => Number.isFinite(value);
const validBudget = (value) => finite(value) && value > 0;
const selectionKey = (selection) => `${selection.id}:${selection.side}`;

function selectionFacts(selection, budget, now) {
  const { board, level, side } = selection;
  const parsed = parseId(selection.id);
  const expiry = selection.expiry || parsed?.expiry;
  const settleTs = finite(selection.settleTs) ? selection.settleTs
    : parsed ? Date.UTC(+parsed.expiry.slice(0, 4), +parsed.expiry.slice(4, 6) - 1, +parsed.expiry.slice(6, 8), 8) / 1000 : null;
  const age = priceAge(board?.prices_ts, now, board?.paused);
  const geometry = level && finite(level.lo) && finite(level.hi) && finite(level.k) && level.hi > level.lo;
  const aligned = (!level?.id || level.id === selection.id) && (!board?.und || board.und === selection.und)
    && (!parsed || (level?.lo === parsed.lo && level?.hi === parsed.hi));
  const base = { expiry, settleTs, age, level: geometry && aligned ? level : parsed };
  if ((settleTs != null && now >= settleTs) || level?.state === "settled") {
    return { ...base, state: "unavailable", reason: "Settled" };
  }
  if ((settleTs != null && now >= settleTs - SETTLING_SEC) || settlingNow(level, now)) {
    return { ...base, state: "unavailable", reason: "Settling · average from 07:30 to 08:00 UTC" };
  }
  if (!geometry || !board || !aligned || !["yes", "no"].includes(side)) {
    return { ...base, state: "unavailable", reason: "Outcome data unavailable" };
  }
  if (age.state === "paused") return { ...base, state: "unavailable", reason: "Prices paused" };
  if (!live(level, side, false, now)) {
    return { ...base, state: "unavailable", reason: "No price now", detail: noPriceReason(level, side) };
  }
  if (!(board.index > 0) || !finite(board.index) || !["base", "taker", "cap"].every((key) => finite(board.spec?.[key]) && board.spec[key] >= 0)) {
    return { ...base, state: "unavailable", reason: "Fee data unavailable" };
  }
  if (!validBudget(budget)) return { ...base, state: "unavailable", reason: "Enter an amount greater than $0" };
  const t = budgetTicket(level, side, budget, board);
  if (!t || ![t.mostLose, t.payout, t.fees].every(finite)) {
    return { ...base, state: "unavailable", reason: "Price data unavailable" };
  }
  if (t.belowMin || !(t.payout > 0)) {
    return { ...base, state: "unavailable", reason: `Smallest amount: ${usd(t.minTotal)}`, detail: "Derive's fees included." };
  }
  return { ...base, t, state: age.state, reason: age.state === "stale" ? `Estimate · prices ${age.minutes} min old` : null };
}

function Breakeven({ t, level, side }) {
  const point = breakeven(t, level, side);
  if (point != null) return money(point);
  // At an equal cost and maximum payout, the full-payout region breaks even. Only allow
  // machine-precision arithmetic noise here, never a real loss hidden by money formatting.
  const equal = Math.abs(t.mostLose - t.payout) <= Number.EPSILON * Math.max(1, t.mostLose, t.payout) * 8;
  return equal ? `${money(side === "yes" ? level.hi : level.lo)} or ${side === "yes" ? "above" : "below"}` : "None at this price";
}

function ComparisonItem({ selection, budget, now, onRemove, onSelect }) {
  const id = useId();
  const facts = selectionFacts(selection, budget, now);
  const { t, level, state, reason, detail, expiry } = facts;
  const side = selection.side;
  const name = `${selection.und} ${ANSWER[side] || "outcome"} ${money(level?.k)}`;
  const expiryValid = /^\d{8}$/.test(expiry || "");
  return (
    <article className={`oc-item oc-${state}`} aria-labelledby={id}>
      <header className="oc-item-head">
        <div>
          <h3 id={id}>{selection.und} <span className={side === "yes" ? "up" : side === "no" ? "down" : ""}>{ANSWER[side] || "Outcome"}</span> <b className="mono">{money(level?.k)}</b></h3>
          <p>{expiryValid ? `${dayLabel(expiry)}, 08:00 UTC` : "Settlement unavailable"}</p>
        </div>
        {onRemove && <button type="button" className="text-control oc-remove" aria-label={`Remove ${name} from comparison`} onClick={() => onRemove(selectionKey(selection))}>Remove</button>}
      </header>
      <div className="oc-state" role={reason ? "status" : undefined}>
        {reason ? <span>{reason}{detail && <Info label={`About ${name} availability`}>{detail}</Info>}</span>
          : <span>Derive prices {new Date(selection.board.prices_ts * 1000).toISOString().slice(11, 16)} UTC</span>}
      </div>
      {t ? <dl className="oc-facts">
        <div><dt>You pay / most you can lose</dt><dd className="mono">{usd(t.mostLose)}<small>incl. {usd(t.fees)} fees</small></dd></div>
        <div><dt>Most you can make</dt><dd className={t.payout > t.mostLose ? "mono up" : "mono"}>{t.payout > t.mostLose ? signed(t.payout - t.mostLose) : "None at this price"}</dd></div>
        <div><dt>Most it pays</dt><dd className="mono">{usd(t.payout)}</dd></div>
        <div><dt>Breakeven</dt><dd className="mono"><Breakeven t={t} level={level} side={side} /></dd></div>
        <div><dt>Pays in full</dt><dd className="mono">{money(side === "yes" ? level.hi : level.lo)} or {side === "yes" ? "above" : "below"}</dd></div>
        <div><dt>Pays in part</dt><dd className="mono">{money(level.lo)}–{money(level.hi)}</dd></div>
      </dl> : <p className="oc-no-figures">Cost and payout unavailable.</p>}
      {t?.capped && <p className="oc-size">Larger than the order book at this price; the firm quote prices it.</p>}
      {onSelect && <button type="button" className="text-control oc-open" onClick={() => onSelect(selection)}>Open details</button>}
    </article>
  );
}

/** Up to three explicitly chosen outcomes, kept in the user's order. Prices and fees come only
 * from the current published boards supplied by the caller; the common budget is not split. */
export default function OutcomeComparison({ selections = [], budget, onRemove, onSelect, now = Date.now() / 1000 }) {
  const seen = new Set();
  const choices = (Array.isArray(selections) ? selections : []).filter((selection) => {
    if (!selection?.id || seen.has(selectionKey(selection))) return false;
    seen.add(selectionKey(selection));
    return true;
  }).slice(0, 3);
  if (!choices.length) return null;
  return (
    <section className="outcome-comparison" aria-label="Compare outcomes">
      <header className="oc-heading">
        <h2>Compare outcomes<Info label="About comparing outcomes">Each outcome uses the same total amount, including Derive's published fees. The amount is not split between outcomes. Figures describe settlement payouts; selling back early is valued differently. These are published price estimates, not firm trade quotes.</Info></h2>
        <p>{validBudget(budget) ? <>For <span className="mono">{usd(budget)}</span> each · fees included</> : "Enter an amount to compare"}</p>
      </header>
      <div className="oc-grid" style={{ "--oc-count": choices.length }}>
        {choices.map((selection) => <ComparisonItem key={selectionKey(selection)} selection={selection} budget={budget} now={now} onRemove={onRemove} onSelect={onSelect} />)}
      </div>
    </section>
  );
}
