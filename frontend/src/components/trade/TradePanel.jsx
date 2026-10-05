import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Info } from "../ui.jsx";
import { DATA_URL, useData } from "../../lib/data.js";
import { money } from "../../lib/questions.js";
import { addPosition, closePosition, incompleteReceipt, loadPositions, patchPosition, replacePosition, settlePosition } from "../../lib/positions.js";
import { remainingQty } from "../../lib/realized.js";
import { MODE, NETWORK } from "../../lib/trade/config.js";
import { setMainnetSwitch } from "../../lib/trade/live.js";
import { notePilotInvite, oneTapOffered } from "../../lib/pilot.js";
import { MAINNET_FILLS, TESTNET_FILLS } from "../../lib/flags.js";
import { failure } from "../../lib/trade/derive.js";
import { TRADING_NOTICE, tradingState } from "../../lib/trade/limits.js";
import { buyRecord, exitFromFill, knownRfqs } from "../../lib/trade/record.js";
import { canTrade, connect, seatState, useSeat } from "../../lib/trade/seat.js";
import { accountRecords, fillsByRfq, legStatus, readSaloon, recoverFills, settlementPrice, unexplained } from "../../lib/trade/sync.js";
import { ConnectStep, FundStep, TermsStep } from "./SeatSetup.jsx";
import ApproveCowboy, { SeatLine } from "./ApproveCowboy.jsx";
import TradeTicket, { sellPlan, ticketPlan } from "./TradeTicket.jsx";
import ErrorDetail from "./ErrorDetail.jsx";
import { NOT_LISTED } from "../../lib/trade/rfq.js";
import { missingLegs, useTestnetListing } from "../../lib/testnetLevels.js";
import "../../trade.css";

/** The testnet's instrument list per coin, read once per page (lib/testnetLevels.js loads it from here). */
export { testnetListing } from "../../lib/trade/listing.js";

/** A level whose options the testnet does not list: said plainly, the names in the (i). */
function NotListed({ missing }) {
  if (!TESTNET_FILLS) return <p className="tr-msg" role="status">{NOT_LISTED}</p>;
  return <p className="tr-msg" role="status">{NOT_LISTED}<ErrorDetail detail={{ step: "listing", source: "Derive", code: "", message: `Not listed on testnet: ${missing.join(", ")}`, data: "" }} /></p>;
}

/** The header's wallet (testnet builds), exported here so all trading code stays in this one lazy chunk. */
export { default as WalletMenu } from "./WalletMenu.jsx";

// Network words are chosen with the build flags, which the build folds, so a mainnet build carries
// none of the testnet's wording and the reverse.
const NETWORK_NOTE = MAINNET_FILLS
  ? "Prices on the Saloon board come from Derive's live market, recorded every 15 minutes. One-tap trades are real: they use the USDC in your own Derive account, at the firm price Derive gives when you ask, which can differ from the board."
  : "Prices on the Saloon board come from Derive's live market, recorded every 15 minutes. One-tap trades in this build go to Derive's testnet with test USDC, so the firm price you are offered comes from the testnet and can differ from the board.";

/** Builds where a tap fills (testnet, or real money on mainnet). */
const FILLS = MODE === "testnet" || MODE === "mainnet";

/** The badge every trade screen carries, with what it means in an (i): "Real money" on mainnet,
 * "Testnet" on the testnet. */
export function TestnetTag() {
  if (MAINNET_FILLS) return <span className="tr-tag tr-real mono">Real money<Info label="About real money">{NETWORK_NOTE}</Info></span>;
  if (MODE !== "testnet") return <span className="tr-tag mono">Testnet · dry run</span>;
  return <span className="tr-tag tr-testnet mono">Testnet<Info label="About testnet">{NETWORK_NOTE}</Info></span>;
}

/** Real money: the published mainnet switch, read afresh (no cache) right before a fill. */
async function readMainnetSwitch() {
  const r = await fetch(`${DATA_URL}questions/index.json`, { cache: "no-store" });
  if (!r.ok) return "off";
  return r.json();
}

/** The stage 1 ticket for a browser outside the mainnet pilot, told one tap is on its way
 * (QuestionTicket reads `oneTapComing`). */
const handWithNote = (fallback) => (isValidElement(fallback) ? cloneElement(fallback, { oneTapComing: true }) : fallback);

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
  const listed = useTestnetListing(MODE === "testnet" && !sell ? und : null);
  const { data: index } = useData("questions/index.json");
  const { data: markets } = useData("markets.json");
  const trading = tradingState(index);
  // Real money: the page's copy of the mainnet switch, which the client checks before any fill.
  useEffect(() => { if (MODE === "mainnet") setMainnetSwitch(index); }, [index]);
  if (MODE === "mainnet") notePilotInvite();
  const plan = sell
    ? sellPlan({ position: sell.position, level, board, paused: sell.paused })
    : t?.contracts > 0 && level && board ? ticketPlan({ und, level, sideKey, board, contracts: t.contracts }) : null;

  const onFill = (fill, filledScope) => {
    if (!FILLS) return;
    const savedTs = Math.floor(Date.now() / 1000);
    if (knownRfqs(loadPositions(NETWORK.name)).has(fill.rfq_id)) return;
    if (sell) {
      const lv = level, p = sell.position;
      const fair = lv && Number.isFinite(lv.fair) ? (p.side === "yes" ? lv.fair : 1 - lv.fair) : null;
      const mark = fair == null ? null : { value: fair * (p.hi - p.lo) * fill.legs[0].qty, ts: board?.prices_ts ?? null };
      sell.onExit?.(exitFromFill(fill, { mark, savedTs }));
      return;
    }
    const estimate = t ? { premium: t.premium, fees: t.fees, total: t.mostLose, contracts: t.contracts, ts: pricesTs ?? null } : null;
    const rec = buyRecord({ fill, id: level.id, side: sideKey, network: NETWORK.name, requested: plan?.contracts, level, board, markets, pricesTs, estimate, question, savedTs,
      wallet: filledScope.wallet, subaccountId: filledScope.subaccountId });
    if (rec) addPosition(rec, savedTs * 1000);
  };

  // Testnet builds: a level the testnet does not list never opens the one-tap ticket.
  const missing = MODE === "testnet" && !sell && level ? missingLegs(level.id, sideKey, listed) : [];
  // A one-tap position sells back only from the Derive account it was bought in.
  const from = sell?.position?.subaccount_id;
  const owner = sell?.position?.wallet;
  const unclaimed = sell && (!owner || from == null);
  const elsewhere = sell && !unclaimed && (from !== seat.saloon?.id || String(owner).toLowerCase() !== String(seat.wallet || "").toLowerCase());
  const ticket = sell && incompleteReceipt(sell.position)
    ? <p className="tr-msg" role="status">Derive's trade records are still being checked. Selling back needs a complete fill.</p>
    : unclaimed
    ? <p className="tr-msg" role="status">Check this position with Derive to confirm its wallet and account before selling it back.</p>
    : elsewhere
    ? <p className="tr-msg" role="status">This position is in Derive account #{from}. Connect its wallet and choose that account to sell it back in one tap.</p>
    : <TradeTicket plan={plan} trading={trading} onFill={onFill} {...(MODE === "mainnet" ? { readSwitch: readMainnetSwitch } : {})} />;
  const step = useStep(ticket);
  // Real money: only a pilot browser gets one tap; everyone else places the orders by hand, with the
  // note that one tap is on its way.
  if (MODE === "mainnet" && !oneTapOffered()) return sell ? fallback : handWithNote(fallback);
  if ((closing && !sell) || !canTrade(und)) return fallback;
  return (
    <section className="q-ticket tr" aria-label={sell ? `Sell back ${answer} through Derive` : `${answer} through Derive`}>
      <header className="tr-head">
        <h3>{question} <span className="q-ticket-side">{sell ? `Sell back · ${answer}` : answer}</span></h3>
        <TestnetTag />
      </header>
      {trading !== "on" && trading !== "loading" && <p className="tr-msg" role="status">{TRADING_NOTICE[trading]}</p>}
      {!byHand && !missing.length && seat.stage === "ready" && <SeatLine />}
      {byHand ? <div className="tr-hand">{fallback}</div> : missing.length ? <NotListed missing={missing} /> : step}
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
export function DeriveSync({ onSynced, onScope }) {
  const seat = useSeat();
  const [st, setSt] = useState({ phase: "idle" });
  const canRead = !!seat.client && !!seat.saloon && ["ready", "approve", "fund"].includes(seat.stage);
  const generation = useRef(0);
  const callbacks = useRef({ onSynced, onScope });
  callbacks.current = { onSynced, onScope };

  async function run() {
    if (!canRead) return;
    const token = ++generation.current;
    const client = seat.client;
    const scope = { wallet: seat.wallet, subaccountId: seat.saloon.id };
    const current = () => {
      const live = seatState();
      return token === generation.current && live.client === client && live.saloon?.id === scope.subaccountId
        && String(live.wallet || "").toLowerCase() === String(scope.wallet || "").toLowerCase()
        && ["ready", "approve", "fund"].includes(live.stage);
    };
    setSt({ phase: "reading" });
    const now = Math.floor(Date.now() / 1000);
    // Only this wallet's records on this Derive account are matched; others stay as they are.
    try {
      let list = loadPositions(NETWORK.name);
      const sinceSec = 0;
      const { trades, held } = await readSaloon(client, scope.subaccountId, { sinceSec });
      if (!current()) return;
      list = loadPositions(NETWORK.name);
      const fills = fillsByRfq(trades);
      const { added, repairs, claims } = recoverFills(list, fills, now, scope);
      const repairedKeys = new Set(repairs.map((r) => r.key));
      for (const c of claims) { if (!current()) return; list = patchPosition(c.key, { wallet: c.wallet, subaccount_id: c.subaccount_id }, NETWORK.name); }
      for (const { key, record } of repairs) { if (!current()) return; list = replacePosition(key, record, NETWORK.name); }
      for (const r of added) { if (!current()) return; list = addPosition(r, Date.now()); }
      const { exits, repairs: laterRepairs, claims: laterClaims, unmatched = [] } = recoverFills(list, fills, now, scope);
      for (const c of laterClaims) { if (!current()) return; list = patchPosition(c.key, { wallet: c.wallet, subaccount_id: c.subaccount_id }, NETWORK.name); }
      for (const { key, record } of laterRepairs) { if (!current()) return; list = replacePosition(key, record, NETWORK.name); repairedKeys.add(key); }
      for (const { key, exit } of exits) { if (!current()) return; list = closePosition(key, exit, now, NETWORK.name); }
      const prices = new Map();
      const { mine: settlingRecords } = accountRecords(list, fills, scope);
      for (const p of settlingRecords) {
        if (incompleteReceipt(p) || p.closed_at || !(p.settle_ts && now >= p.settle_ts) || !(remainingQty(p) > 0) || (p.exits || []).some((e) => e.kind === "settle")) continue;
        const expiry = p.id.split("-")[1];
        const k = `${p.und}|${expiry}`;
        if (!prices.has(k)) prices.set(k, await settlementPrice(client, p.und, expiry).catch(() => null));
        if (!current()) return;
        const price = prices.get(k);
        if (Number.isFinite(price)) list = settlePosition(p.key, price, now, NETWORK.name);
      }
      const { mine } = accountRecords(list, fills, scope);
      const ours = new Set(mine.map((p) => p.key));
      const statuses = legStatus(mine, held, now);
      for (const p of list) if (p.exec === "rfq" && !ours.has(p.key)) statuses[p.key] = { state: "other_account", subaccount_id: p.subaccount_id ?? null };
      const extra = unexplained(mine, held, now);
      if (!current()) return;
      callbacks.current.onSynced?.({ list, statuses, extra, unmatched, at: now, added: added.length, repaired: repairedKeys.size, ...scope });
      setSt({ phase: "done", at: now, added: added.length, repaired: repairedKeys.size, unmatched });
    } catch (e) {
      if (current()) setSt({ phase: "error", ...failure(e, "sync") });
    }
  }
  useLayoutEffect(() => {
    generation.current += 1;
    setSt({ phase: "idle" });
    callbacks.current.onScope?.({ wallet: seat.wallet ?? null, subaccountId: seat.saloon?.id ?? null });
    if (canRead) run();
    return () => { generation.current += 1; };
  }, [canRead, seat.client, seat.saloon?.id, seat.wallet]);

  const at = st.at ? `${new Date(st.at * 1000).toISOString().slice(11, 16)} UTC` : null;
  return (
    <section className="tr tr-sync" aria-label="Your Saloon account on Derive">
      <header className="tr-head">
        <p className="tr-lead">Your Saloon account on Derive
          <Info label="About this check">On this build Positions reads your Saloon account on Derive over your own connection: its open positions and its trades. Derive's records are the reference; one-tap trades this browser missed are added from them, and each card says whether Derive holds its options. {NETWORK_NOTE}</Info>
        </p>
        <TestnetTag />
      </header>
      {!canRead ? (seat.stage === "terms" ? <TermsStep /> : seat.stage === "no_wallet" ? (
        <p className="tr-note">Checking these against Derive needs a browser wallet such as MetaMask or Rabby.</p>
      ) : seat.wallet && !seat.saloon && seat.stage === "fund" ? (
        <p className="tr-note">This wallet has no Derive account yet. It starts with the first deposit from a ticket.</p>
      ) : (
        <div className="tr-actions">
          <span className="tr-note">Connect your wallet to check these against your Saloon account.</span>
          <button className="btn" onClick={connect} disabled={seat.busy}>{seat.busy ? "Connecting…" : "Connect wallet"}</button>
          {seat.message && <span className="tr-msg">{seat.message}<ErrorDetail detail={seat.detail} /></span>}
        </div>
      )) : (
        <div className="tr-actions">
          {st.phase === "reading" ? <span className="tr-wait"><span className="spin" aria-hidden="true" />Reading Derive…</span>
            : <span className="tr-note">{st.phase === "done" ? <>Checked with Derive at {at}{st.added ? ` · ${st.added} added from Derive's records` : ""}{st.repaired ? ` · ${st.repaired} corrected from Derive's records` : ""}</> : st.phase === "error" ? <>{st.message}<ErrorDetail detail={st.detail} /></> : "Not checked yet"}</span>}
          <span className="tr-note">Derive account <span className="mono">#{seat.saloon?.id}</span> <b className="mono">{money(seat.saloon?.usdc, { cents: true })}</b> USDC</span>
          <button className="text-control" onClick={run} disabled={st.phase === "reading"}>Check again</button>
        </div>
      )}
      {st.phase === "done" && st.unmatched?.length > 0 && <p className="tr-note" role="status">
        {st.unmatched.length} {st.unmatched.length === 1 ? "sell-back receipt needs" : "sell-back receipts need"} matching entry records.
        {st.unmatched.every((u) => Number.isFinite(u.exit.net)) && <> Derive recorded {money(st.unmatched.reduce((a, u) => a + u.exit.net, 0), { cents: true })} received after fees.</>} This stays out of profit and loss until the entries are found.
      </p>}
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
