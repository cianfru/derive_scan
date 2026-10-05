// Testnet builds: the wallet in the header. It is the same seat as every ticket (lib/trade/seat.js),
// so connecting here or in a ticket shows in both. Styles: src/hdr-wallet.css, inlined by the Shell.
import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { money } from "../../lib/questions.js";
import { connect, disconnect, resume, seatState, switchOff, useSeat } from "../../lib/trade/seat.js";
import { WalletEmblem } from "../WalletTag.jsx";
import { AccountChoice, Copy, TermsStep, accountName } from "./SeatSetup.jsx";
import { until } from "./ApproveCowboy.jsx";
import ErrorDetail from "./ErrorDetail.jsx";

/** Stages in which the wallet is connected (signed in or about to be). */
const CONNECTED = new Set(["terms", "fund", "approve", "ready"]);
export const tinyAddr = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-2)}` : "");
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const isConnected = (seat) => !!seat.wallet && CONNECTED.has(seat.stage);

/** The Saloon account in a few plain words: ready, funding needed or approval needed. */
export function accountStatus(seat) {
  const usdc = Number.isFinite(seat.saloon?.usdc) ? money(seat.saloon.usdc, { cents: true }) : null;
  switch (seat.stage) {
    case "ready": return { key: "ready", label: "Ready", usdc, note: seat.key ? `Cowboy approved until ${until(seat.key.expiry_sec)}` : null };
    case "approve": return { key: "approve", label: "Approval needed", usdc, note: "Cowboy trades from this account once you approve it, from the ticket of any answer." };
    case "fund": return { key: "fund", label: "Funding needed", usdc: seat.saloon ? usdc : null,
      note: seat.saloon ? "Add USDC from the ticket of any answer."
        : seat.newAccount ? "Your first deposit opens your Derive account. Add USDC from the ticket of any answer."
          : "It starts with your first deposit, from the ticket of any answer." };
    default: return { key: "terms", label: "Sign-in needed", usdc: null, note: null };
  }
}

/** Other Derive accounts holding USDC beside the one Cowboy uses (Cowboy moves no funds). */
export function otherNote(seat) {
  const o = seat.saloon && seat.others;
  if (!o || !(o.usdc > 0)) return null;
  const amt = money(o.usdc, { cents: true });
  return o.count > 1 ? `You have ${o.count} other Derive accounts with ${amt}; Cowboy uses this one.`
    : `You have another Derive account with ${amt}; Cowboy uses this one.`;
}

const Chevron = () => (
  <svg className="hw-chev" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
);

/**
 * Not connected: "Connect wallet", the same connect and sign-in as a ticket's first step. Connected:
 * the short address, opening a small menu with the Saloon account's status (a link to Positions),
 * Switch off Cowboy (when approved) and Disconnect. `early` is a tap the Shell caught before this
 * code had loaded.
 */
export default function WalletMenu({ early = null }) {
  const seat = useSeat();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);
  const panel = useRef(null);
  const id = useId();
  const { pathname } = useLocation();
  const connected = isConnected(seat);

  async function go() {
    if (seatState().busy) return;
    setOpen(false);
    await connect();
    const s = seatState();
    if (s.stage === "terms" || s.stage === "no_wallet" || s.message) setOpen(true);
  }
  // A tap before the chunk arrived connects now; otherwise pick the remembered wallet back up quietly.
  useEffect(() => { if (early?.current) { early.current = false; go(); } else resume(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOpen(false); }, [pathname]);

  const showing = open && (connected || seat.stage === "no_wallet" || !!seat.message);
  useEffect(() => {
    if (!showing) return undefined;
    const p = panel.current;
    if (connected) (p?.querySelector("input") || p?.querySelector(".hw-account") || p?.querySelector("button"))?.focus();
    // Escape closes this menu only (it sits on top), not a ticket sheet open beneath it.
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", away); };
  }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps
  // Signing in from the menu replaces the terms step: keep focus in the menu, on the Saloon account.
  useEffect(() => {
    if (showing && connected && seat.stage !== "terms" && !wrap.current?.contains(document.activeElement)) {
      panel.current?.querySelector(".hw-account")?.focus();
    }
  }, [seat.stage]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tabbing out closes the menu; focus leaving the page (a wallet window opening) does not.
  const blur = (e) => { if (e.relatedTarget && !wrap.current?.contains(e.relatedTarget)) setOpen(false); };

  const off = async () => {
    if (seatState().busy) return;
    await switchOff();
    panel.current?.querySelector("a, button")?.focus();
  };
  const leave = () => { disconnect(); setOpen(false); btn.current?.focus(); };

  if (!connected) {
    // A wallet this browser connected before: "Reconnect" with its short address (a click, so any
    // wallet prompt comes from the user), or "Reconnecting…" while the page resumes it quietly.
    const again = seat.remembered && seat.stage === "disconnected";
    const label = seat.resuming ? "Reconnecting" : seat.busy ? "Connecting" : again ? `Reconnect wallet ${shortAddr(seat.remembered)}` : "Connect wallet";
    return (
      <div className="hw" ref={wrap} onBlur={blur}>
        <button ref={btn} type="button" className={`btn hw-btn${again && !seat.busy ? " hw-on" : ""}`} data-ready="1" aria-label={label}
          aria-disabled={seat.busy || undefined} onClick={go}>
          {seat.resuming ? "Reconnecting…" : seat.busy ? "Connecting…" : again
            ? <><WalletEmblem address={seat.remembered} size={18} /><span className="mono hw-long">{tinyAddr(seat.remembered)}</span><span>Reconnect</span></>
            : <><span className="hw-long">Connect wallet</span><span className="hw-short" aria-hidden="true">Connect</span></>}
        </button>
        {showing && (
          <div id={id} ref={panel} className="hw-menu hw-say" role="status">
            {seat.stage === "no_wallet"
              ? <p className="hw-note">Connecting needs a browser wallet such as MetaMask or Rabby. On a phone, open Cowboy in your wallet's own browser.</p>
              : <p className="tr-msg">{seat.message}<ErrorDetail detail={seat.detail} /></p>}
          </div>
        )}
      </div>
    );
  }

  const st = accountStatus(seat);
  return (
    <div className="hw" ref={wrap} onBlur={blur}>
      <button ref={btn} type="button" className="btn hw-btn hw-on" data-ready="1" aria-label={`Wallet ${shortAddr(seat.wallet)}`}
        aria-expanded={showing} aria-controls={showing ? id : undefined} onClick={() => setOpen((o) => !o)}>
        <WalletEmblem address={seat.wallet} size={18} />
        <span className="mono">{tinyAddr(seat.wallet)}</span>
        <Chevron />
      </button>
      {showing && (
        <div id={id} ref={panel} className="hw-menu" role="group" aria-label="Your wallet">
          <div className="hw-who">
            <WalletEmblem address={seat.wallet} size={28} />
            <span className="hw-addr"><b className="mono" title={seat.wallet}>{shortAddr(seat.wallet)}</b><small>Derive testnet · test USDC</small></span>
            <Copy text={seat.wallet} />
          </div>
          {seat.stage === "terms" ? <div className="hw-terms tr"><TermsStep /></div> : (
            <>
              <Link to="/saloon/mine" className="hw-item hw-account">
                <span>{seat.saloon ? <>Derive account <span className="mono">{accountName(seat.saloon)}</span></> : "Derive account"}</span>
                <span className={`hw-status hw-${st.key}`}>{st.label}{st.usdc && <b className="mono">{st.usdc}</b>}</span>
              </Link>
              {st.note && <p className="hw-note">{st.note}</p>}
              {otherNote(seat) && <p className="hw-note">{otherNote(seat)}</p>}
              {(seat.stage === "ready" || seat.stage === "approve") && <AccountChoice label="Change account" className="hw-accounts" />}
            </>
          )}
          <div className="hw-sep" role="presentation" />
          {seat.key && (
            <button type="button" className="hw-item" onClick={off} aria-disabled={seat.busy || undefined}>
              {seat.busy ? "Waiting for your wallet…" : "Switch off Cowboy"}
            </button>
          )}
          <button type="button" className="hw-item" onClick={leave}>Disconnect</button>
          {seat.message && seat.stage !== "terms" && <p className="tr-msg hw-msg" role="status">{seat.message}<ErrorDetail detail={seat.detail} /></p>}
        </div>
      )}
    </div>
  );
}
