import { useEffect, useState } from "react";
import { Info } from "../ui.jsx";
import { useData } from "../../lib/data.js";
import { money } from "../../lib/questions.js";
import { addPosition, closePosition, loadPositions, settlePosition } from "../../lib/positions.js";
import { remainingQty } from "../../lib/realized.js";
import { MODE } from "../../lib/trade/config.js";
import { plainError } from "../../lib/trade/derive.js";
import { TRADING_NOTICE, tradingState } from "../../lib/trade/limits.js";
import { buyRecord, exitFromFill, knownRfqs } from "../../lib/trade/record.js";
import { canTrade, connect, useSeat } from "../../lib/trade/seat.js";
import { fillsByRfq, legStatus, readSaloon, recoverFills, settlementPrice, unexplained } from "../../lib/trade/sync.js";
import { ConnectStep, FundStep, TermsStep } from "./SeatSetup.jsx";
import ApproveCowboy, { SeatLine } from "./ApproveCowboy.jsx";
import TradeTicket, { sellPlan, ticketPlan } from "./TradeTicket.jsx";
import "../../trade.css";

/** The header's wallet (testnet builds), exported here so all trading code stays in this one lazy chunk. */
export { default as WalletMenu } from "./WalletMenu.jsx";

const NETWORK_NOTE = "Prices on the Saloon board come from Derive's live market, recorded every 15 minutes. One-tap trades in this build go to Derive's testnet with test USDC, so the firm price you are offered comes from the testnet and can differ from the board.";

/** The "Testnet" badge every trade screen carries, with what it means in an (i). */
export function TestnetTag() {
  if (MODE !== "testnet") return <span className="tr-tag mono">Testnet · dry run</span>;
  return <span className="tr-tag tr-testnet mono">Testnet<Info label="About testnet">{NETWORK_NOTE}</Info></span>;
}

/** The setup steps before the ticket: connect, Derive's terms, add USDC, approve Cowboy. */
function useStep(ticket) {
  const seat = useSeat();
  const { data: index } = useData("questions/index.json");
  const ethUsd = index?.coins?.find((c) => c.und === "ETH")?.index;
  return {
    no_wallet: <ConnectStep />, disconnected: <ConnectStep />, terms: <TermsStep />,
    fund: <FundStep ethUsd={ethUsd} />, approve: <ApproveCowboy />, ready: ticket,
  }[seat.stage] || <ConnectStep />;
}

/**
 * Saloon stage 2 beside stage 1: connect, agree to Derive's terms, fund the Saloon account, approve
 * Cowboy, then the one-tap ticket. "Place by hand" always shows stage 1's ticket. With `sell` (a
 * one-tap position on Positions), the ticket sells it back. Loaded only in builds with
 * VITE_SALOON_TRADE on.
 */
export default function TradePanel({ und, question, answer, level, sideKey, board, t, pricesTs, closing = false, fallback = null, sell = null }) {
  const seat = useSeat();
  const [byHand, setByHand] = useState(false);
  const { data: index } = useData("questions/index.json");
  const { data: markets } = useData("markets.json");
  const trading = tradingState(index);
  const plan = sell
    ? sellPlan({ position: sell.position, level, board, paused: sell.paused })
    : t?.contracts > 0 && level && board ? ticketPlan({ und, level, sideKey, board, contracts: t.contracts }) : null;

  const onFill = (fill) => {
    if (MODE !== "testnet") return;
    const savedTs = Math.floor(Date.now() / 1000);
    if (knownRfqs(loadPositions("testnet")).has(fill.rfq_id)) return;
    if (sell) {
      const lv = level, p = sell.position;
      const fair = lv && Number.isFinite(lv.fair) ? (p.side === "yes" ? lv.fair : 1 - lv.fair) : null;
      const mark = fair == null ? null : { value: fair * (p.hi - p.lo) * fill.legs[0].qty, ts: board?.prices_ts ?? null };
      sell.onExit?.(exitFromFill(fill, { mark, savedTs }));
      return;
    }
    const estimate = t ? { premium: t.premium, fees: t.fees, total: t.mostLose, contracts: t.contracts, ts: pricesTs ?? null } : null;
    const rec = buyRecord({ fill, id: level.id, side: sideKey, network: "testnet", requested: plan?.contracts, level, board, markets, pricesTs, estimate, question, savedTs });
    if (rec) addPosition(rec, savedTs * 1000);
  };

  const ticket = <TradeTicket plan={plan} trading={trading} onFill={onFill} onByHand={sell ? null : () => setByHand(true)} />;
  const step = useStep(ticket);
  if ((closing && !sell) || !canTrade(und)) return fallback;
  return (
    <section className="q-ticket tr" aria-label={sell ? `Sell back ${answer} through Derive` : `${answer} through Derive`}>
      <header className="tr-head">
        <h3>{question} <span className="q-ticket-side">{sell ? `Sell back · ${answer}` : answer}</span></h3>
        <TestnetTag />
      </header>
      {trading !== "on" && trading !== "loading" && <p className="tr-msg" role="status">{TRADING_NOTICE[trading]}</p>}
      {!byHand && seat.stage === "ready" && <SeatLine />}
      {byHand ? <div className="tr-hand">{fallback}</div> : step}
      {!sell && fallback && (
        <div className="tr-switch">
          <button className="text-control" onClick={() => setByHand((b) => !b)} aria-pressed={byHand}>{byHand ? "Back to one tap" : "Place by hand"}</button>
        </div>
      )}
    </section>
  );
}

const short = (n) => n.replace(/^([A-Z0-9]+)-(\d{4})(\d{2})(\d{2})-/, "$1 $4/$3 ");

/**
 * Positions on a testnet build: reads the Saloon account on Derive (open positions and trades) over
 * the user's own connection, adds one-tap fills and sell backs this browser missed, records
 * settlement at the testnet's own settlement price, and says for each record whether Derive holds its
 * legs. `onSynced({ list, statuses, extra, at })` gets the result.
 */
export function DeriveSync({ onSynced }) {
  const seat = useSeat();
  const [st, setSt] = useState({ phase: "idle" });
  const canRead = !!seat.client && !!seat.saloon && ["ready", "approve", "fund"].includes(seat.stage);

  async function run() {
    setSt({ phase: "reading" });
    const now = Math.floor(Date.now() / 1000);
    try {
      let list = loadPositions("testnet");
      const firsts = list.map((p) => p.journal?.fill?.ts ?? p.at).filter(Number.isFinite);
      const sinceSec = Math.max(0, (firsts.length ? Math.min(...firsts) : now - 30 * 86400) - 3600);
      const { trades, held } = await readSaloon(seat.client, seat.saloon.id, { sinceSec });
      const fills = fillsByRfq(trades);
      const { added } = recoverFills(list, fills, now);
      for (const r of added) list = addPosition(r, Date.now());
      const { exits } = recoverFills(list, fills, now);
      for (const { key, exit } of exits) list = closePosition(key, exit, now, "testnet");
      const prices = new Map();
      for (const p of list) {
        if (p.closed_at || !(p.settle_ts && now >= p.settle_ts) || !(remainingQty(p) > 0) || (p.exits || []).some((e) => e.kind === "settle")) continue;
        const expiry = p.id.split("-")[1];
        const k = `${p.und}|${expiry}`;
        if (!prices.has(k)) prices.set(k, await settlementPrice(seat.client, p.und, expiry).catch(() => null));
        const price = prices.get(k);
        if (Number.isFinite(price)) list = settlePosition(p.key, price, now, "testnet");
      }
      const statuses = legStatus(list, held, now);
      const extra = unexplained(list, held, now);
      onSynced?.({ list, statuses, extra, at: now, added: added.length });
      setSt({ phase: "done", at: now, added: added.length });
    } catch (e) {
      setSt({ phase: "error", message: plainError(e) });
    }
  }
  useEffect(() => { if (canRead) run(); }, [canRead, seat.saloon?.id]);

  const at = st.at ? `${new Date(st.at * 1000).toISOString().slice(11, 16)} UTC` : null;
  return (
    <section className="tr tr-sync" aria-label="Your Saloon account on Derive">
      <header className="tr-head">
        <p className="tr-lead">Your Saloon account on Derive
          <Info label="About this check">On this testnet build Positions reads your Saloon account on Derive over your own connection: its open positions and its trades. Derive's records are the reference; one-tap trades this browser missed are added from them, and each card says whether Derive holds its options. {NETWORK_NOTE}</Info>
        </p>
        <TestnetTag />
      </header>
      {!canRead ? (seat.stage === "terms" ? <TermsStep /> : seat.stage === "no_wallet" ? (
        <p className="tr-note">Checking these against Derive needs a browser wallet such as MetaMask or Rabby.</p>
      ) : seat.wallet && !seat.saloon && seat.stage === "fund" ? (
        <p className="tr-note">This wallet has no Saloon account on Derive yet. It starts with the first deposit from a ticket.</p>
      ) : (
        <div className="tr-actions">
          <span className="tr-note">Connect your wallet to check these against your Saloon account.</span>
          <button className="btn" onClick={connect} disabled={seat.busy}>{seat.busy ? "Connecting…" : "Connect wallet"}</button>
          {seat.message && <span className="tr-msg">{seat.message}</span>}
        </div>
      )) : (
        <div className="tr-actions">
          {st.phase === "reading" ? <span className="tr-wait"><span className="spin" aria-hidden="true" />Reading Derive…</span>
            : <span className="tr-note">{st.phase === "done" ? <>Checked with Derive at {at}{st.added ? ` · ${st.added} added from Derive's records` : ""}</> : st.phase === "error" ? st.message : "Not checked yet"}</span>}
          <span className="tr-note">Saloon account <b className="mono">{money(seat.saloon?.usdc, { cents: true })}</b> USDC</span>
          <button className="text-control" onClick={run} disabled={st.phase === "reading"}>Check again</button>
        </div>
      )}
    </section>
  );
}

/** Derive's positions that no Saloon record explains, in plain words. */
export function AlsoOnDerive({ extra }) {
  if (!extra || (!extra.answers.length && !extra.rest.length)) return null;
  return (
    <section className="tr tr-sync" aria-label="Also on Derive">
      <p className="tr-lead">Also in your Saloon account on Derive
        <Info label="About these">Options Derive holds in your Saloon account that no record in this browser accounts for, for example trades placed on another device or on Derive itself. Paired options are shown as the answer they make.</Info></p>
      <ul className="tr-also">
        {extra.answers.map((a, i) => (
          <li key={`a${i}`} className="mono">{a.und} {a.side === "yes" ? "Higher" : "Lower"} {money(a.lo)}–{money(a.hi)} · {a.expiry.slice(6, 8)}/{a.expiry.slice(4, 6)} · {String(a.contracts)} contracts</li>
        ))}
        {extra.rest.map((l) => <li key={l.name} className="mono">{l.amount > 0 ? "+" : ""}{l.amount} {short(l.name)}</li>)}
      </ul>
    </section>
  );
}
