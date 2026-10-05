import { useEffect, useId, useState } from "react";
import { Info } from "../ui.jsx";
import { money } from "../../lib/questions.js";
import { DEPOSIT_SUGGESTED, NETWORK } from "../../lib/trade/config.js";
import { depositCheck } from "../../lib/trade/account.js";
import { acceptTerms, connect, deposit, depositGasUsd, holdSend, pickAccount, refreshFunding, useSeat } from "../../lib/trade/seat.js";
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

/** A Derive subaccount as the user sees it: "#90212". */
export const accountName = (sub) => (sub ? `#${sub.id}` : "");

/**
 * "Use another account" / "Change account": with several funded Derive accounts, an inline list of
 * them with their USDC, as underlined text. Picking one asks the wallet nothing and moves no funds.
 */
export function AccountChoice({ label = "Use another account", className = "" }) {
  const seat = useSeat();
  const [open, setOpen] = useState(false);
  const id = useId();
  const list = seat.choices || [];
  if (list.length < 2) return null;
  return (
    <div className={`tr-accounts ${className}`.trim()}>
      <button type="button" className="text-control" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && (
        <ul id={id} className="tr-account-list" aria-label="Your funded Derive accounts">
          {list.map((c) => (
            <li key={c.id}>
              {c.id === seat.saloon?.id
                ? <span aria-current="true"><span className="mono">{accountName(c)}</span> <b className="mono">{money(c.usdc, { cents: true })}</b> · in use</span>
                : <button type="button" className="text-control" disabled={seat.busy} onClick={() => { pickAccount(c.id); setOpen(false); }}>
                  <span className="mono">{accountName(c)}</span> <span className="mono">{money(c.usdc, { cents: true })}</span>
                </button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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

/** Step 3, only when no Derive account of the wallet holds USDC: a deposit address on the settlement chain. */
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
          <Info label="Why you can't send again yet">Your first deposit opens your Derive account. Sending again before it lands would open a second account, so add more once this one is ready.</Info>
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
      <p className="tr-lead">{isNew ? "Add USDC to start trading" : `Add USDC to your Derive account ${accountName(seat.saloon)}`}
        <Info label="About your Derive account">Cowboy trades from one Derive account owned by your wallet. Money already on Derive works too: once a Derive account holds USDC, Cowboy offers it, and nothing moves. Withdraw any time on Derive.</Info>
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
        {seat.saloon && <div><dt>In account {accountName(seat.saloon)}</dt><dd className="mono">{money(seat.saloon.usdc, { cents: true })}</dd></div>}
      </dl>
      {(seat.arriving > 0 || seat.sentTx) && <p className="tr-note">Derive credits a deposit after about 2 minutes of confirmations.</p>}
      <div className="tr-actions">
        <button className="text-control" onClick={refreshFunding} disabled={seat.busy}>Check again</button>
        <a className="text-link" href={NETWORK.appUrl} target="_blank" rel="noreferrer">Fund it on Derive instead ↗</a>
      </div>
      <p className="tr-note">Test USDC comes from Derive's testnet app. Funded there, it shows here after Check again.</p>
      {seat.message && <p className="tr-msg">{seat.message}<ErrorDetail detail={seat.detail} /></p>}
    </div>
  );
}
