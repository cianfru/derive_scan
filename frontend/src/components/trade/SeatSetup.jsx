import { useEffect, useState } from "react";
import { Info } from "../ui.jsx";
import { money } from "../../lib/questions.js";
import { DEPOSIT_SUGGESTED, NETWORK } from "../../lib/trade/config.js";
import { depositCheck } from "../../lib/trade/account.js";
import { acceptTerms, connect, deposit, depositGasUsd, holdSend, refreshFunding, useSeat } from "../../lib/trade/seat.js";
import ErrorDetail from "./ErrorDetail.jsx";

export const DERIVE_TERMS_URL = "https://www.derive.xyz/terms-of-use";
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export function Copy({ text }) {
  const [done, setDone] = useState(false);
  const go = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1000); } catch { /* the address stays selectable */ }
  };
  return <button className="text-control" onClick={go}>{done ? "Copied" : "Copy"}</button>;
}

/** Step 1: connect an ordinary browser wallet. */
export function ConnectStep() {
  const seat = useSeat();
  if (seat.stage === "no_wallet") {
    return (
      <div className="tr-step">
        <p className="tr-lead">One tap needs a browser wallet.</p>
        <p className="tr-note">Open Cowboy in a browser with a wallet such as MetaMask or Rabby, or place the two orders by hand below.</p>
      </div>
    );
  }
  return (
    <div className="tr-step">
      <p className="tr-lead">Buy this answer in one tap with your own Derive account.
        <Info label="How one tap works">Your wallet owns the account; Cowboy never holds your money or your keys. Derive fills both options of the answer at once, at one firm price you see first. This build runs on Derive's testnet with test USDC.</Info>
      </p>
      <button className="btn primary lg" onClick={connect} disabled={seat.busy}>{seat.busy ? "Connecting…" : "Connect wallet"}</button>
      {seat.message && <p className="tr-msg">{seat.message}<ErrorDetail detail={seat.detail} /></p>}
    </div>
  );
}

/** Step 2: who may use Derive, once per browser. */
export function TermsStep() {
  const seat = useSeat();
  const [ok, setOk] = useState(false);
  return (
    <div className="tr-step">
      <p className="tr-lead">Derive is not open to everyone.</p>
      <p className="tr-note">Its terms exclude, among others, US persons, residents of Canada and Ontario, Australian tax residents, residents of Panama and sanctioned regions, and limit access in the UK.</p>
      <label className="tr-check">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>I may use Derive under its <a className="text-link" href={DERIVE_TERMS_URL} target="_blank" rel="noreferrer">terms of use ↗</a></span>
      </label>
      <button className="btn primary lg" onClick={acceptTerms} disabled={!ok || seat.busy}>{seat.busy ? "Signing in…" : "Continue"}</button>
      <p className="tr-note">Continuing asks your wallet to sign a sign-in message. It costs nothing.</p>
      {seat.message && <p className="tr-msg">{seat.message}<ErrorDetail detail={seat.detail} /></p>}
    </div>
  );
}

/** Step 3: fund the Saloon account with USDC (a deposit address on the settlement chain). */
export function FundStep({ ethUsd }) {
  const seat = useSeat();
  const [dollars, setDollars] = useState(100);
  const [gasUsd, setGasUsd] = useState(null);
  useEffect(() => {
    let live = true;
    depositGasUsd(dollars, ethUsd).then((g) => { if (live) setGasUsd(g); });
    return () => { live = false; };
  }, [dollars, ethUsd, seat.depositAddress]);
  const chk = depositCheck(dollars, gasUsd);
  const isNew = !seat.saloon;
  const onWay = seat.arriving || seat.sentAmount || 0;
  if (holdSend(seat)) {
    // One deposit to the new-account address opens the account; a second would open another.
    return (
      <div className="tr-step">
        <p className="tr-lead">Your deposit is on its way
          <Info label="Why you can't send again yet">Your first deposit opens your Saloon account on Derive. Sending again before it lands would open a second account, so add more once this one is ready.</Info>
        </p>
        <dl className="tr-figs">
          <div><dt>Arriving</dt><dd className="mono">{onWay > 0 ? money(onWay, { cents: true }) : "Not available yet"}</dd></div>
        </dl>
        <p className="tr-note">Derive credits a deposit after about 2 minutes of confirmations.</p>
        <button className="btn primary lg" disabled>Send USDC</button>
        <div className="tr-actions">
          <button className="text-control" onClick={refreshFunding} disabled={seat.busy}>{seat.busy ? "Checking…" : "Check again"}</button>
        </div>
        {seat.message && <p className="tr-msg">{seat.message}<ErrorDetail detail={seat.detail} /></p>}
      </div>
    );
  }
  return (
    <div className="tr-step">
      <p className="tr-lead">{isNew ? "Add USDC to start your Saloon account" : "Add USDC to your Saloon account"}
        <Info label="About the Saloon account">A separate account on Derive, owned by your wallet and labelled Cowboy, for Saloon answers only. It keeps Saloon money apart from anything else you hold on Derive. Withdraw any time on Derive.</Info>
      </p>
      {seat.newAccount && <p className="tr-note">Your first deposit opens your Derive account.</p>}
      <div className="tr-amount">
        <span className="q-dollar-field"><span>$</span>
          <input aria-label="Deposit amount" inputMode="decimal" value={dollars} onChange={(e) => setDollars(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0))} />
        </span>
        <span className="tr-note">${DEPOSIT_SUGGESTED} or more suits the smallest answers.</span>
      </div>
      {!chk.ok && chk.reason === "min" && <p className="tr-msg">The smallest deposit is {money(chk.min)}.</p>}
      {chk.ok && chk.gasWarn && <p className="tr-msg">{NETWORK.chainName} fee about {money(chk.gasUsd, { cents: true })}, {Math.round(chk.share * 100)}% of this deposit.</p>}
      <button className="btn primary lg" disabled={!chk.ok || seat.busy || !seat.depositAddress} onClick={() => deposit(dollars)}>
        {seat.busy ? "Waiting for your wallet…" : `Send ${money(dollars, { cents: dollars % 1 !== 0 })} USDC`}
      </button>
      <dl className="tr-figs">
        <div><dt>Or send USDC on {NETWORK.chainName} to</dt><dd className="mono tr-addr">{seat.depositAddress ? <>{short(seat.depositAddress)} <Copy text={seat.depositAddress} /></> : "—"}</dd></div>
        {(seat.arriving > 0 || seat.sentAmount) && <div><dt>Arriving</dt><dd className="mono">{money(seat.arriving || seat.sentAmount, { cents: true })}</dd></div>}
        {seat.saloon && <div><dt>In your Saloon account</dt><dd className="mono">{money(seat.saloon.usdc, { cents: true })}</dd></div>}
      </dl>
      {(seat.arriving > 0 || seat.sentTx) && <p className="tr-note">Derive credits a deposit after about 2 minutes of confirmations.</p>}
      <div className="tr-actions">
        <button className="text-control" onClick={refreshFunding} disabled={seat.busy}>Check again</button>
        <a className="text-link" href={NETWORK.appUrl} target="_blank" rel="noreferrer">Test USDC: Mint on Derive's testnet app ↗</a>
      </div>
      <p className="tr-note">From another chain, use Derive's own deposit screen.</p>
      {seat.message && <p className="tr-msg">{seat.message}<ErrorDetail detail={seat.detail} /></p>}
    </div>
  );
}
