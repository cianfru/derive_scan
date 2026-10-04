import { Suspense, lazy, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Info } from "./ui.jsx";
import OutcomePreview from "./OutcomePreview.jsx";
import { TRADE_ON } from "../lib/flags.js";
import { amountText, copyText, deriveLink, fullPay, handRisk, limitText, money, orderedLegs, parseId } from "../lib/questions.js";
import { addPosition } from "../lib/positions.js";

const clock = (t) => `${new Date(t * 1000).toISOString().slice(11, 16)} UTC`;

function Copy({ text, label }) {
  const [done, setDone] = useState(false);
  const go = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1000);
    } catch {
      /* clipboard blocked: the text stays selectable */
    }
  };
  return <button className="text-control q-copy" onClick={go} aria-label={label}>{done ? "Copied" : "Copy"}</button>;
}

// Stage 2 (one tap through Derive RFQ) only in builds with VITE_SALOON_TRADE on; otherwise this is
// stage 1 alone and the build carries no trading code.
const TradePanel = TRADE_ON ? lazy(() => import("./trade/TradePanel.jsx")) : null;

function WithTrade(props) {
  const hand = <QuestionTicket {...props} />;
  return <Suspense fallback={hand}><TradePanel {...props} fallback={hand} /></Suspense>;
}
export default TRADE_ON ? WithTrade : QuestionTicket;

/** "I placed it": what actually filled and what was paid, so Positions never shows more than the
 * user confirmed. Not yet saves nothing. */
function Placed({ estimate, onSave }) {
  const [fill, setFill] = useState(null);
  const [paid, setPaid] = useState(estimate.toFixed(2));
  const name = useId();
  const amount = Number(paid);
  const can = (fill === "both" || fill === "first") && amount > 0;
  return (
    <form className="q-placed" onSubmit={(e) => { e.preventDefault(); if (can) onSave(fill, amount); }}>
      <fieldset>
        <legend>Did both orders fill on Derive?</legend>
        {[["both", "Both filled"], ["first", "Only the first"], ["none", "Not yet"]].map(([k, label]) => (
          <label key={k} className="q-choice"><input type="radio" name={name} value={k} checked={fill === k} onChange={() => setFill(k)} />{label}</label>
        ))}
      </fieldset>
      {fill === "none" ? <p className="q-note">Nothing saved. Come back to this question once they fill.</p> : (
        <>
          <label className="q-paid">
            <span>What you paid in total, fees included<Info label="Why Cowboy asks">Cowboy cannot see your Derive account. Enter what Derive charged for the {fill === "first" ? "option that filled" : "two options"}, fees included; the estimate from this screen is filled in.</Info></span>
            <span className="q-dollar-field"><span>$</span><input inputMode="decimal" value={paid} aria-label="What you paid in total"
              onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ""))} /></span>
          </label>
          <button type="submit" className="btn" disabled={!can}>Save to Positions</button>
        </>
      )}
    </form>
  );
}

/** "I sold it back": both orders filled and what came back after Derive's fees, so the position closes
 * with what the user actually got. */
function Sold({ estimate, onSave }) {
  const [both, setBoth] = useState(false);
  const [got, setGot] = useState(Math.max(0, estimate).toFixed(2));
  const amount = Number(got);
  return (
    <form className="q-placed" onSubmit={(e) => { e.preventDefault(); if (both && amount >= 0) onSave(amount); }}>
      <label className="q-choice"><input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} />Both orders filled</label>
      <label className="q-paid">
        <span>What you got back, after fees</span>
        <span className="q-dollar-field"><span>$</span><input inputMode="decimal" value={got} aria-label="What you got back, after fees"
          onChange={(e) => setGot(e.target.value.replace(/[^\d.]/g, ""))} /></span>
      </label>
      {!both && <p className="q-note">If only one order filled, keep the position open and finish on Derive first.</p>}
      <button type="submit" className="btn" disabled={!both || got === ""}>Close the position</button>
    </form>
  );
}

/** Stage 1: a summary of the answer, the orders to place on Derive by hand inside Order details
 * (the bought leg first, or, selling back, the short leg bought back first), Open Derive, and then
 * "I placed it", which asks what filled. */
function QuestionTicket({ und, question, answer, level, sideKey, t, board, pricesTs, settleTs, stale, closing = false, onPlaced, onSold, expiry }) {
  const [step, setStep] = useState(null);
  const side = level?.[sideKey];
  const legs = orderedLegs(side, closing);
  const risk = closing ? null : handRisk(t, level, sideKey, board);
  if (!t || !legs.length) return <p className="status">No price on Derive's screen for this right now.</p>;
  const tick = board.spec?.tick;
  const text = copyText({ question, answer, legs, contracts: t.contracts, tick, settleTs });
  const save = (fill, paid) => {
    addPosition({ id: level.id, und, side: sideKey, lo: level.lo, hi: level.hi, contracts: t.contracts,
      paid, estimate: t.mostLose, exec: fill === "both" ? "hand_both" : "hand_partial",
      legs: legs.map((l) => l.name), question, answer, settle_ts: settleTs });
    setStep("saved");
    onPlaced?.();
  };
  return (
    <section className="q-ticket" aria-label={closing ? "Sell back on Derive" : "Place on Derive"}>
      <h3>{question} <span className="q-ticket-side">{closing ? `Sell back ${answer}` : <>{answer} · {fullPay(level, sideKey)}</>}</span></h3>
      {closing ? (
        <dl className="q-money">
          <div><dt>Sell-back price, about</dt><dd className="mono">{money(t.premium, { cents: true })}</dd></div>
          <div><dt>Derive fees, about</dt><dd className="mono">-{money(t.fees, { cents: true })}</dd></div>
          <div className="q-lose"><dt>You get, after fees</dt><dd className="mono">{money(t.proceeds, { cents: true })}</dd></div>
        </dl>
      ) : (
        <OutcomePreview und={und} level={level} side={sideKey} t={t} expiry={expiry || parseId(level.id)?.expiry} settleTs={settleTs} summary />
      )}
      {t.capped && <p className="q-note">Up to {money(t.capPayout)} of payout at this price; more costs more.</p>}
      {risk && (
        <div className="q-hand" aria-label="Placing by hand">
          <p className="q-hand-head">By hand, the two orders fill one at a time
            <Info label="Why line 1 needs more cash">Derive fills the two orders separately. Line 1 buys one option on its own, so it needs its full price up front; line 2 then sells the other option and brings the net cost down to the spread's. Until line 2 fills, line 1 alone is at risk.</Info>
          </p>
          <dl className="q-money">
            <div><dt>Cash needed for line 1</dt><dd className="mono">{money(risk.upfront, { cents: true })}</dd></div>
            <div><dt>If only line 1 fills, most you can lose</dt><dd className="mono">{money(risk.firstLose, { cents: true })}</dd></div>
            <div className="q-lose"><dt>Once both fill, most you can lose</dt><dd className="mono">{money(risk.both, { cents: true })}</dd></div>
          </dl>
        </div>
      )}
      <details className="q-details">
        <summary>Order details</summary>
        <p className="q-ticket-lead">{closing ? "Place these two orders on Derive, in this order, to sell back." : "Place these two orders on Derive, in this order."}</p>
        <ol className="q-legs">
          {legs.map((l, i) => (
            <li key={l.name}>
              <span className="q-leg-n mono">{i + 1}</span>
              <span className={`q-leg-act ${l.act}`}>{closing && l.act === "buy" ? "Buy back" : l.act === "buy" ? "Buy" : "Sell"}</span>
              <span className="q-leg-name mono">{l.name}</span>
              <span className="q-leg-fig"><small>Amount</small><b className="mono">{amountText(t.contracts)}</b></span>
              <span className="q-leg-fig"><small>Limit</small><b className="mono">{limitText(l.limit, tick)}</b></span>
            </li>
          ))}
        </ol>
        <p className="q-note">Place line 2 only after line 1 has filled.
          <Info label="If only one line fills">Derive's book takes the two orders separately; it has no net limit. If the price moves before line 2 fills, you hold the option from line 1 alone. {closing ? "Buying back first means you never hold a lone short." : "It needs no margin and the most it can lose is what you paid for it."} You can wait, move the line 2 limit and accept a different net, or {closing ? "sell the remaining option at Derive's bid" : "sell that option back"}.</Info>
        </p>
        <dl className="q-money">
          <div><dt>If both fill at these limits</dt><dd className="mono">net {limitText(Math.abs(t.net), tick)} per contract, {money(t.premium, { cents: true })}</dd></div>
        </dl>
        <Copy text={text} label="Copy both orders" />
        <pre className="sr-only" aria-label="Text that Copy puts on the clipboard">{text}</pre>
      </details>
      <p className={`q-note${stale ? " warn" : ""}`}>Prices from {clock(pricesTs)}.{stale ? " Check Derive's screen first." : " Derive's screen may differ."}</p>
      <div className="q-ticket-actions">
        <a className="btn primary" href={deriveLink()} target="_blank" rel="noreferrer" onClick={() => !closing && setStep((x) => x || "opened")}>Open Derive ↗</a>
        {step !== "saved" && step !== "asking" && <button className="text-control" onClick={() => setStep("asking")}>{closing ? "I sold it back" : "I placed it"}</button>}
      </div>
      {!closing && step === "asking" && <Placed estimate={t.mostLose} onSave={save} />}
      {closing && step === "asking" && <Sold estimate={t.proceeds} onSave={(got) => { setStep("saved"); onSold?.(got); }} />}
      {step === "saved" && !closing && <p className="q-note">Saved to <Link className="text-link" to="/saloon/mine">Positions</Link>.</p>}
    </section>
  );
}
