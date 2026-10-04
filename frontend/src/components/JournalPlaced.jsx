import { useId, useState } from "react";
import { Info } from "./ui.jsx";
import "../journal.css";
import { useData } from "../lib/data.js";
import { amountText, fullPay, money, parseId } from "../lib/questions.js";
import { addPosition, persistent } from "../lib/positions.js";
import { captureContext, fillFacts, journalEntry, markBenchmark } from "../lib/journal.js";

const usd = (v) => money(v, { cents: true });
const num = (s) => (s === "" || s == null ? NaN : Number(s));
const clean = (v) => v.replace(/[^\d.]/g, "");

/** "2026-10-09T14:05" read as UTC, in seconds; null when empty or not a time. */
export function parseUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || "");
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000;
}

const ERR = {
  fill: "Pick what filled.", when: "Enter when it filled, in UTC, no later than now, or tick that you do not know.",
  qty: "Enter the amount that filled on line 1.", price: "Enter the price per contract for each line that filled.",
  premium: "Enter the premium you paid for the package.", fees: "Enter Derive's fees, or tick that you do not know them.",
};

/**
 * "I placed it" (journal J1): what actually filled on Derive, entered by the user. Fill time, the
 * amounts and prices (one package total when the leg prices are not to hand) and Derive's fees apart
 * from the premium. Saving keeps the exact package, the board's estimate (marked as an estimate),
 * Derive's mark at the time and the three readings with their own times. Not yet saves nothing.
 */
export default function JournalPlaced({ und, level, sideKey, t, board, legs, settleTs, pricesTs, question, answer, onSaved }) {
  const { data: markets } = useData("markets.json");
  const [fill, setFill] = useState(null);
  const [when, setWhen] = useState("");
  const [whenUnknown, setWhenUnknown] = useState(false);
  const [mode, setMode] = useState("total");
  const [premium, setPremium] = useState("");
  const [rows, setRows] = useState(() => legs.map(() => ({ qty: amountText(t.contracts), price: "" })));
  const [fees, setFees] = useState("");
  const [feesUnknown, setFeesUnknown] = useState(false);
  const [error, setError] = useState(null);
  const name = useId();
  const modeName = useId();
  const expiry = parseId(level.id)?.expiry;

  const facts = fill === "both" || fill === "first" ? fillFacts({
    choice: fill, mode, board, side: sideKey, lo: level.lo, hi: level.hi, plannedContracts: t.contracts,
    legs: legs.map((l, i) => ({ name: l.name, act: l.act, limit: l.limit, planned: t.contracts, qty: num(rows[i].qty), price: num(rows[i].price) })),
    premiumTotal: num(premium), fees: num(fees), feesKnown: !feesUnknown,
  }) : null;

  const submit = (e) => {
    e.preventDefault();
    if (!facts) return setError("fill");
    const savedTs = Math.floor(Date.now() / 1000);
    const fillTs = whenUnknown ? null : parseUtc(when);
    if (!whenUnknown && (fillTs == null || fillTs > savedTs + 60)) return setError("when");
    if (facts.error) return setError(facts.error);
    const context = captureContext({ markets, und, settleTs, fillTs, savedTs });
    const mark = markBenchmark({ level, side: sideKey, contracts: facts.contracts, pricesTs, fillTs });
    const pkg = {
      network: "mainnet", venue: "Derive", id: level.id, und, side: sideKey, direction: answer, expiry, settle_ts: settleTs,
      lo: level.lo, hi: level.hi, zone: fullPay(level, sideKey), contracts: t.contracts,
      legs: legs.map((l) => ({ name: l.name, act: l.act, signed_qty: (l.act === "buy" ? 1 : -1) * t.contracts })),
    };
    const estimate = { premium: t.premium, fees: t.fees, total: t.mostLose, contracts: t.contracts, ts: pricesTs ?? null };
    const journal = journalEntry({ facts, context, mark, estimate, pkg, savedTs });
    addPosition({
      id: level.id, und, side: sideKey, lo: level.lo, hi: level.hi, contracts: facts.contracts,
      paid: facts.cost.total ?? facts.cost.premium, estimate: t.mostLose, exec: facts.complete ? "hand_both" : "hand_partial",
      legs: legs.map((l) => l.name), question, answer, settle_ts: settleTs, v: 2, network: "mainnet", journal,
    }, savedTs * 1000);
    setError(null);
    onSaved?.();
  };

  const cost = facts && !facts.error ? facts.cost : null;
  return (
    <form className="q-placed q-journal-form" onSubmit={submit} noValidate>
      <fieldset>
        <legend>Did both orders fill on Derive?</legend>
        {[["both", "Both filled"], ["first", "Only the first"], ["none", "Not yet"]].map(([k, label]) => (
          <label key={k} className="q-choice"><input type="radio" name={name} value={k} checked={fill === k} onChange={() => { setFill(k); setError(null); }} />{label}</label>
        ))}
      </fieldset>
      {fill === "none" && <p className="q-note">Nothing saved. Come back to this question once they fill.</p>}
      {(fill === "both" || fill === "first") && (
        <>
          <p className="q-note">Everything below is entered by you<Info label="Why Cowboy asks">Cowboy cannot see your Derive account. Copy these from Derive's trade history. They are kept as entered by you, apart from the board's estimate.</Info></p>
          <div className="q-jf-when">
            <label className="q-paid">
              <span>When it filled, UTC</span>
              <input type="datetime-local" step="60" className="q-jf-input" value={when} disabled={whenUnknown}
                aria-label="When it filled, UTC" onChange={(e) => setWhen(e.target.value)} />
            </label>
            <label className="q-choice"><input type="checkbox" checked={whenUnknown} onChange={(e) => setWhenUnknown(e.target.checked)} />I don't know when</label>
          </div>
          <fieldset className="q-jf-mode">
            <legend>What you paid</legend>
            {[["total", "One total for the package"], ["legs", "A price per option"]].map(([k, label]) => (
              <label key={k} className="q-choice"><input type="radio" name={modeName} value={k} checked={mode === k} onChange={() => setMode(k)} />{label}</label>
            ))}
          </fieldset>
          <div className="q-jf-legs">
            {legs.map((l, i) => {
              const off = fill === "first" && i > 0;
              return (
                <div key={l.name} className="q-jf-leg">
                  <span className="q-jf-leg-name"><span className="mono">{i + 1}</span> <span className={`q-leg-act ${l.act}`}>{l.act === "buy" ? "Buy" : "Sell"}</span> <span className="mono">{l.name}</span></span>
                  <label><small>Amount filled</small>
                    <input className="q-jf-input mono" inputMode="decimal" aria-label={`Amount filled, line ${i + 1}`} disabled={off}
                      value={off ? "0" : rows[i].qty} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, qty: clean(e.target.value) } : x)))} /></label>
                  {mode === "legs" && (
                    <label><small>Price per contract, $</small>
                      <input className="q-jf-input mono" inputMode="decimal" aria-label={`Price per contract, line ${i + 1}`} disabled={off}
                        value={off ? "" : rows[i].price} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, price: clean(e.target.value) } : x)))} /></label>
                  )}
                </div>
              );
            })}
          </div>
          {mode === "total" && (
            <label className="q-paid">
              <span>Premium for the package, before fees<Info label="About a package total">With one total, Cowboy keeps that the leg prices were not entered.</Info></span>
              <span className="q-dollar-field"><span>$</span><input inputMode="decimal" value={premium} aria-label="Premium paid, before fees"
                onChange={(e) => setPremium(clean(e.target.value))} /></span>
            </label>
          )}
          <div className="q-jf-when">
            <label className="q-paid">
              <span>Derive's fees</span>
              <span className="q-dollar-field"><span>$</span><input inputMode="decimal" value={feesUnknown ? "" : fees} disabled={feesUnknown} aria-label="Derive's fees"
                onChange={(e) => setFees(clean(e.target.value))} /></span>
            </label>
            <label className="q-choice"><input type="checkbox" checked={feesUnknown} onChange={(e) => setFeesUnknown(e.target.checked)} />I don't know the fees</label>
          </div>
          <dl className="q-money">
            <div><dt>Board estimate, with fees<small>an estimate from this screen, not your fill</small></dt><dd className="mono">{usd(t.mostLose)}</dd></div>
            {cost && <div className="q-lose"><dt>Your total cost{cost.fees_basis === "estimated" ? <small>fees estimated</small> : cost.fees_basis === "unknown" ? <small>fees not included</small> : null}</dt>
              <dd className="mono">{usd(cost.total ?? cost.premium)}</dd></div>}
            {cost && fill === "both" && facts.complete && <div><dt>Breakeven at settlement{cost.breakeven_basis !== "exact" && cost.breakeven != null ? <small>estimated</small> : null}</dt>
              <dd className="mono">{cost.breakeven != null ? money(cost.breakeven) : "Not available yet"}</dd></div>}
          </dl>
          {error && <p className="q-note warn" role="alert">{ERR[error]}</p>}
          {!persistent() && <p className="q-note warn">This browser is not saving data: Positions last only for this visit.</p>}
          <button type="submit" className="btn">Save to Positions</button>
        </>
      )}
    </form>
  );
}
