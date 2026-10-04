import { useState } from "react";
import { Info } from "./ui.jsx";
import { amountText, copyText, deriveLink, limitText, money, orderedLegs } from "../lib/questions.js";
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

/** Stage 1: the legs to place on Derive by hand, the bought leg first (or, selling back, the short
 * leg bought back first), per-leg limits on the tick, and what both fills mean in dollars. */
export default function QuestionTicket({ und, question, answer, level, sideKey, t, board, pricesTs, settleTs, stale, closing = false, onPlaced }) {
  const [saved, setSaved] = useState(false);
  const side = level?.[sideKey];
  const legs = orderedLegs(side, closing);
  if (!t || !legs.length) return <p className="status">No price on Derive's screen for this right now.</p>;
  const tick = board.spec?.tick;
  const text = copyText({ question, answer, legs, contracts: t.contracts, tick, settleTs });
  const credit = side.form === "credit" && !closing;
  const place = () => {
    addPosition({ id: level.id, und, side: sideKey, lo: level.lo, hi: level.hi, contracts: t.contracts,
      paid: t.mostLose, question, answer, settle_ts: settleTs });
    setSaved(true);
    onPlaced?.();
  };
  return (
    <section className="q-ticket" aria-label={closing ? "Sell back on Derive" : "Place on Derive"}>
      <h3>{question} <span className="q-ticket-side">{closing ? `Sell back ${answer}` : answer}</span></h3>
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
        {credit ? (
          <>
            <div><dt>You receive now</dt><dd className="mono">{money(t.credit, { cents: true })}</dd></div>
            <div><dt>Derive holds against it<Info label="Why Derive holds cash">This answer is cheaper built as a credit spread: you sell one option and buy the other. Derive holds the zone's width as margin until settlement or sell-back. The cash at risk is the width minus what you receive.</Info></dt><dd className="mono">{money(t.held, { cents: true })}</dd></div>
          </>
        ) : (
          <div><dt>If both fill at these limits</dt><dd className="mono">net {limitText(Math.abs(t.net), tick)} per contract, {money(t.premium, { cents: true })}</dd></div>
        )}
        <div><dt>Derive fees, about<Info label="About Derive's fees">Derive charges a fee per option: $0.50 plus a small share of the coin's price, at most an eighth of the option's price. Two options means two fees. These are Derive's published rates; fills often pay less.</Info></dt><dd className="mono">{money(t.fees, { cents: true })}</dd></div>
        {!closing && <div className="q-lose"><dt>Most you can lose</dt><dd className="mono">{money(t.mostLose, { cents: true })}</dd></div>}
        {!closing && <div><dt>Pays up to</dt><dd className="mono">{money(t.payout, { cents: true })}</dd></div>}
      </dl>
      {t.capped && <p className="q-note">Up to {money(t.capPayout)} of payout at this price; more costs more.</p>}
      <p className={`q-note${stale ? " warn" : ""}`}>Prices from {clock(pricesTs)}.{stale ? " Check Derive's screen first." : " Derive's screen may differ."}</p>
      <div className="q-ticket-actions">
        <Copy text={text} label="Copy both orders" />
        <a className="btn" href={deriveLink()} target="_blank" rel="noreferrer">Open Derive ↗</a>
        {!closing && <button className="btn primary" onClick={place} disabled={saved}>{saved ? "Saved to My questions" : "I placed it"}</button>}
      </div>
      <pre className="sr-only" aria-label="Text that Copy puts on the clipboard">{text}</pre>
    </section>
  );
}
