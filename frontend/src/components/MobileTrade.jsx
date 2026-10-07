import { useEffect, useState } from "react";
import { Info } from "./ui.jsx";
import { OutcomeFigures } from "./OutcomePreview.jsx";
import { breakeven, dayLabel, fullPay, money, signed } from "../lib/questions.js";
import "../mobile-trade.css";

const PHONE = "(max-width: 700px)";
export function usePhoneTrade() {
  const [phone, setPhone] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(PHONE), update = () => setPhone(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return phone;
}

/** The desktop figures stay unchanged; phones put the three decision figures first. */
export function TradeFigures(props) {
  const phone = usePhoneTrade();
  if (!phone) return <OutcomeFigures {...props} />;
  const { t } = props, profit = t.payout - t.mostLose;
  return <dl className="mt-figures">
    <div className="mt-cost"><dt>You pay<Info label="What you pay">{money(t.premium, { cents: true })} for the two options plus Derive's fees, about {money(t.fees, { cents: true })}. Fees are included. This cost is the most you can lose.</Info></dt><dd className="mono">{money(t.mostLose, { cents: true })}<small>incl. fees · max. loss</small></dd></div>
    <div><dt>Most it pays<Info label="About maximum payout">The total back at settlement when the answer pays in full: {fullPay(props.level, props.side)}. Your profit is this payout minus what you pay.</Info></dt><dd className="mono">{money(t.payout, { cents: true })}</dd></div>
    <div><dt>Most you can make</dt><dd className={`mono ${profit > 0 ? "up" : profit < 0 ? "down" : ""}`}>{profit > 0 ? signed(profit) : "None at this price"}</dd></div>
  </dl>;
}

/** Secondary facts remain directly reachable, with every dollar and settlement boundary intact. */
export function TradeFacts({ und, level, side, t, expiry, children }) {
  const phone = usePhoneTrade();
  if (!phone || !t) return null;
  const be = breakeven(t, level, side);
  return <details className="mt-facts">
    <summary>Fees, breakeven and settlement</summary>
    <dl>
      <div><dt>The two options</dt><dd className="mono">{money(t.premium, { cents: true })}</dd></div>
      <div><dt>Derive fees, about</dt><dd className="mono">{money(t.fees, { cents: true })}</dd></div>
      <div><dt>Most you can lose</dt><dd className="mono">{money(t.mostLose, { cents: true })}</dd></div>
      <div><dt>Breakeven</dt><dd className="mono">{be == null ? "None at this price" : `${und} at ${money(be)}`}</dd></div>
      <div><dt>Higher pays in full</dt><dd className="mono">{money(level.hi)} or above</dd></div>
      <div><dt>Lower pays in full</dt><dd className="mono">{money(level.lo)} or below</dd></div>
      <div><dt>Pays in part</dt><dd className="mono">{money(level.lo)}–{money(level.hi)}</dd></div>
      {expiry && <div><dt>Settles</dt><dd>{dayLabel(expiry)}, 08:00 UTC</dd></div>}
    </dl>
    {children}
    <p>The settlement average sets the payout. Selling back early uses Derive's sell-back price then and fees apply again.</p>
  </details>;
}

/** A phone disclosure changes no desktop markup or geometry. */
export function PhoneFold({ title, children, className = "" }) {
  const phone = usePhoneTrade();
  return phone ? <details className={`mt-fold ${className}`}><summary>{title}</summary>{children}</details> : <>{children}</>;
}
