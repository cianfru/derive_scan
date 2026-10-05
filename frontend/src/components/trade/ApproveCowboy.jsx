import { Info } from "../ui.jsx";
import { money } from "../../lib/questions.js";
import { KEY_DAYS } from "../../lib/trade/config.js";
import { approve, switchOff, useSeat } from "../../lib/trade/seat.js";
import ErrorDetail from "./ErrorDetail.jsx";
import { AccountChoice, accountName } from "./SeatSetup.jsx";

/** The approval's end, in UTC: "Sat 10 Oct, 14:00 UTC". */
export const until = (sec) => {
  const d = new Date(sec * 1000);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}, ${d.toISOString().slice(11, 16)} UTC`;
};

/** Step 4: approve Cowboy once. The panel spells out the grant before the wallet is asked to sign. */
export default function ApproveCowboy() {
  const seat = useSeat();
  return (
    <div className="tr-step" aria-label="Approve Cowboy">
      <p className="tr-lead">Cowboy trades from your Derive account <span className="mono">{accountName(seat.saloon)}</span> (<span className="mono">{money(seat.saloon?.usdc, { cents: true })}</span>).</p>
      <ul className="tr-grant">
        <li><b>Buy and sell Saloon answers</b> in this account</li>
        <li><b>For {KEY_DAYS} days</b></li>
        <li><b>Nothing else.</b> Cowboy cannot withdraw, transfer, or touch your other Derive accounts.</li>
      </ul>
      <p className="tr-note">You can switch this off at any time. No funds move. Reloading the page requires a new approval.
        <Info label="What approving does">Your wallet signs one approval for a small key that this browser makes and keeps. Derive lets that key trade options by request for quote, in this account only, until the approval ends. It can never withdraw or move money. Anything able to run inside this page could still trade the account's balance until then, so keep in this account only what you use in the Saloon. Once approved, Cowboy labels the account "Cowboy" on Derive.</Info>
      </p>
      <button className="btn primary lg" onClick={approve} disabled={seat.busy || !seat.saloon}>{seat.busy ? "Waiting for your wallet…" : "Approve Cowboy"}</button>
      <AccountChoice />
      {seat.message && <p className="tr-msg">{seat.message}<ErrorDetail detail={seat.detail} /></p>}
    </div>
  );
}

/** The approval as a one-line status above the ticket, with Switch off. */
export function SeatLine() {
  const seat = useSeat();
  if (!seat.key) return null;
  return (
    <div className="tr-seat">
      <span>Derive account <span className="mono">{accountName(seat.saloon)}</span> <b className="mono">{money(seat.saloon?.usdc, { cents: true })}</b></span>
      <span>Cowboy approved until {until(seat.key.expiry_sec)}</span>
      <AccountChoice label="Change account" className="tr-seat-change" />
      <button className="text-control" onClick={switchOff} disabled={seat.busy}>Switch off</button>
    </div>
  );
}
