import { Component, Suspense, lazy, useState } from "react";
import { Link } from "react-router-dom";
import { Info } from "./ui.jsx";
import OutcomePreview from "./OutcomePreview.jsx";
import { TRADE_ON } from "../lib/flags.js";
import { amountText, closeTicket, copyText, deriveLink, fullPay, handRisk, limitText, money, orderedLegs, parseId, signed } from "../lib/questions.js";
import { closeSummary } from "../lib/positions.js";
import JournalPlaced, { parseUtc } from "./JournalPlaced.jsx";

const tone = (v) => (v > 0.004 ? "up" : v < -0.004 ? "down" : "");

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

// While the trade chunk loads, a short line, never the manual ticket (it read as the one-tap screen).
// If the chunk fails to load (a page left open across a deploy asks for files that are gone), the
// boundary offers a reload, with the manual ticket one tap away. Written behind TRADE_ON so other
// builds carry none of it.
const TradeLoading = TRADE_ON ? () => <p className="status q-trade-loading" role="status">Loading one-tap…</p> : null;

function TradeLoadFailed({ hand }) {
  const [byHand, setByHand] = useState(false);
  if (byHand) return hand;
  return (
    <section className="q-ticket q-trade-failed" aria-label="One-tap did not load">
      <p className="q-trade-failed-line">Reload to trade in one tap</p>
      <div className="q-ticket-actions">
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        <button type="button" className="text-control q-trade-hand" onClick={() => setByHand(true)}>Place by hand</button>
      </div>
    </section>
  );
}

const TradeBoundary = TRADE_ON ? class extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn("One-tap did not load", error); }
  render() { return this.state.failed ? <TradeLoadFailed hand={this.props.hand} /> : this.props.children; }
} : null;

function WithTrade(props) {
  const hand = <QuestionTicket {...props} />;
  return (
    <TradeBoundary hand={hand}>
      <Suspense fallback={<TradeLoading />}><TradePanel {...props} fallback={hand} /></Suspense>
    </TradeBoundary>
  );
}
export default TRADE_ON ? WithTrade : QuestionTicket;

/** "I sold it back" (journal J2): what sold, entered by the user. The contracts sold back (all of them
 * by default; fewer leaves the rest open), when, what the options brought before Derive's fees and
 * the fees apart (unknown fees are estimated from Derive's schedule and marked). The board's figure
 * is shown as an estimate, never filled in as the sale. */
function Sold({ t, paid, feesFor, onSave }) {
  const [both, setBoth] = useState(false);
  const [qty, setQty] = useState(amountText(t.contracts));
  const [when, setWhen] = useState("");
  const [whenUnknown, setWhenUnknown] = useState(false);
  const [gross, setGross] = useState("");
  const [fees, setFees] = useState("");
  const [feesUnknown, setFeesUnknown] = useState(false);
  const [error, setError] = useState(null);
  const q = Number(qty);
  const qOk = qty !== "" && q > 0 && q <= t.contracts + 1e-9;
  const g = gross === "" ? NaN : Number(gross);
  const fee = feesUnknown ? (qOk ? feesFor(q) : null) : fees === "" ? NaN : Number(fees);
  const share = qOk && paid != null ? paid * (q / t.contracts) : null;
  const net = Number.isFinite(g) && Number.isFinite(fee) ? g - fee : null;
  const submit = (e) => {
    e.preventDefault();
    if (!both) return setError("Tick that both orders filled; if only one did, keep the position open and finish on Derive first.");
    if (!qOk) return setError(`Enter the contracts sold back, at most ${amountText(t.contracts)}.`);
    const ts = whenUnknown ? null : parseUtc(when);
    if (!whenUnknown && (ts == null || ts > Date.now() / 1000 + 60)) return setError("Enter when it sold, in UTC, no later than now, or tick that you do not know.");
    if (!Number.isFinite(g) || g < 0) return setError("Enter what the options brought, before fees.");
    if (!Number.isFinite(fee) || fee < 0) return setError("Enter Derive's fees, or tick that you do not know them.");
    setError(null);
    onSave({ qty: Math.min(q, t.contracts), ts, gross: g, fees: fee, feesKnown: !feesUnknown });
  };
  return (
    <form className="q-placed q-journal-form" onSubmit={submit} noValidate>
      <label className="q-choice"><input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} />Both orders filled</label>
      <p className="q-note">Everything below is entered by you<Info label="Why Cowboy asks">Cowboy cannot see your Derive account. Copy these from Derive's trade history; they are kept as entered by you.</Info></p>
      <div className="q-jf-when">
        <label className="q-paid"><span>Contracts sold back</span>
          <input className="q-jf-input mono" inputMode="decimal" value={qty} aria-label="Contracts sold back" onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} /></label>
        <label className="q-paid"><span>When it sold, UTC</span>
          <input type="datetime-local" step="60" className="q-jf-input" value={when} disabled={whenUnknown} aria-label="When it sold, UTC" onChange={(e) => setWhen(e.target.value)} /></label>
        <label className="q-choice"><input type="checkbox" checked={whenUnknown} onChange={(e) => setWhenUnknown(e.target.checked)} />I don't know when</label>
      </div>
      <div className="q-jf-when">
        <label className="q-paid"><span>What the options brought, before fees</span>
          <span className="q-dollar-field"><span>$</span><input inputMode="decimal" value={gross} aria-label="What the options brought, before fees"
            onChange={(e) => setGross(e.target.value.replace(/[^\d.]/g, ""))} /></span></label>
        <label className="q-paid"><span>Derive's fees to sell back</span>
          <span className="q-dollar-field"><span>$</span><input inputMode="decimal" value={feesUnknown ? "" : fees} disabled={feesUnknown} aria-label="Derive's fees to sell back"
            onChange={(e) => setFees(e.target.value.replace(/[^\d.]/g, ""))} /></span></label>
        <label className="q-choice"><input type="checkbox" checked={feesUnknown} onChange={(e) => setFeesUnknown(e.target.checked)} />I don't know the fees</label>
      </div>
      <dl className="q-money">
        <div><dt>Board estimate, before fees<small>from this screen, not your sale</small></dt><dd className="mono">{qOk ? money(t.premium * (q / t.contracts), { cents: true }) : "Not available yet"}</dd></div>
        {net != null && <div className="q-lose"><dt>You got, after fees{feesUnknown ? <small>fees estimated</small> : null}</dt><dd className="mono">{money(net, { cents: true })}</dd></div>}
        {net != null && share != null && <div><dt>Realized P/L<small>after the {money(share, { cents: true })} paid for these</small></dt><dd className={`mono ${tone(net - share)}`}>{signed(net - share)}</dd></div>}
      </dl>
      {qOk && q < t.contracts - 1e-9 && <p className="q-note">The other {amountText(t.contracts - q)} contracts stay open.</p>}
      {error && <p className="q-note warn" role="alert">{error}</p>}
      <button type="submit" className="btn">{qOk && q < t.contracts - 1e-9 ? "Save the sell-back" : "Close the position"}</button>
    </form>
  );
}

/** Stage 1: a summary of the answer, the orders to place on Derive by hand inside Order details
 * (the bought leg first, or, selling back, the short leg bought back first), Open Derive, and then
 * "I placed it", which asks what filled. */
function QuestionTicket({ und, question, answer, level, sideKey, t, board, pricesTs, settleTs, stale, closing = false, onPlaced, onSold, expiry, paid = null, holdPayout = null, oneTapComing = false }) {
  const feesFor = (q) => closeTicket(level, sideKey, q, board)?.fees ?? null;
  const [step, setStep] = useState(null);
  const close = closing && paid != null ? closeSummary(t, paid, holdPayout) : null;
  const side = level?.[sideKey];
  const legs = orderedLegs(side, closing);
  const risk = closing ? null : handRisk(t, level, sideKey, board);
  if (!t || !legs.length) return <p className="status">No price on Derive's screen for this right now.</p>;
  const tick = board.spec?.tick;
  const text = copyText({ question, answer, legs, contracts: t.contracts, tick, settleTs });
  return (
    <section className="q-ticket" aria-label={closing ? "Sell back on Derive" : "Place on Derive"}>
      {(!TRADE_ON || oneTapComing) && !closing && (
        // Builds without one-tap (production today): say once, plainly, why there are two orders to place.
        <p className="q-onetap-note">One-tap trading is coming to Cowboy. For now, place the two orders on Derive yourself.
          <Info label="Why two orders">A Higher or Lower answer is two options traded together: one bought and one sold, across the zone where it pays in part. Derive's order book takes each option as its own order, so by hand you place both, one after the other.</Info>
        </p>
      )}
      <h3>{question} <span className="q-ticket-side">{closing ? `Sell back ${answer}` : <>{answer} · {fullPay(level, sideKey)}</>}</span></h3>
      {closing ? (
        <dl className="q-money q-close-sum">
          <div><dt>Sell-back price, about</dt><dd className="mono">{money(t.premium, { cents: true })}</dd></div>
          <div><dt>Derive fees, about</dt><dd className="mono">-{money(t.fees, { cents: true })}</dd></div>
          <div className="q-lose"><dt>You get, after fees</dt><dd className="mono">{money(t.proceeds, { cents: true })}</dd></div>
          {close && <div><dt>Profit / loss if closed now<small>after the {money(paid, { cents: true })} you paid</small></dt><dd className={`mono ${tone(close.pl)}`}>{signed(close.pl)}</dd></div>}
          {close?.holdPl != null && <div><dt>If held to 08:00 UTC instead<small>{und} settling at today's price</small></dt><dd className={`mono ${tone(close.holdPl)}`}>{signed(close.holdPl)}</dd></div>}
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
      {!closing && step === "asking" && <JournalPlaced und={und} level={level} sideKey={sideKey} t={t} board={board} legs={legs} settleTs={settleTs}
        pricesTs={pricesTs} question={question} answer={answer} onSaved={() => { setStep("saved"); onPlaced?.(); }} />}
      {closing && step === "asking" && <Sold t={t} paid={paid} feesFor={feesFor} onSave={(sale) => { setStep("saved"); onSold?.(sale); }} />}
      {step === "saved" && !closing && <p className="q-note">Saved to <Link className="text-link" to="/saloon/mine">Positions</Link>.</p>}
    </section>
  );
}
