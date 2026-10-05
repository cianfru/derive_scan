import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Info } from "../ui.jsx";
import { cents, centsUp, money, parseId, sameLegs } from "../../lib/questions.js";
import {
  maxTotalCost, minTotalCost, packageLegs, rfqFee, toleranceFor, wireLegs,
} from "../../lib/trade/package.js";
import { createTicket } from "../../lib/trade/rfq.js";
import { instrumentCache } from "../../lib/trade/derive.js";
import { keySigner } from "../../lib/trade/sessionKey.js";
import { dropKey, seatState, useSeat } from "../../lib/trade/seat.js";
import { MODE } from "../../lib/trade/config.js";
import { capGate, capMessage, tradingAllows, TRADING_NOTICE } from "../../lib/trade/limits.js";
import { buyLabel, closeLabel } from "../../lib/trade/record.js";
import { remainingQty } from "../../lib/realized.js";
import { partial } from "../../lib/positions.js";
import ErrorDetail from "./ErrorDetail.jsx";

const perDollar = (x) => cents(Math.round(x * 100));
const qty = (v) => String(Number((v ?? 0).toFixed(8)));

/** What the ticket shows for an amount before asking Derive: the board's numbers, marked "about". */
export function ticketPlan({ und, level, sideKey, board, contracts, direction = "buy" }) {
  const p = parseId(level.id);
  const side = level[sideKey];
  if (!p || !side || !(contracts > 0)) return null;
  const legs = packageLegs({ und, expiry: p.expiry, kind: sideKey, lo: level.lo, hi: level.hi });
  const payout = contracts * (level.hi - level.lo);
  const T = toleranceFor(board.thin);
  const spec = board.spec || {};
  const prices = Object.fromEntries((side.legs || []).map(([n, , px]) => [n, px]));
  const fee = rfqFee(legs, contracts, { index: board.index, taker: spec.taker, cap: spec.cap, base: spec.base }, prices);
  const board$ = direction === "buy" ? side.buy : side.sell;
  const limit = direction === "buy" ? maxTotalCost(payout, side.buy, T) : minTotalCost(payout, side.sell, T);
  return {
    legs, wire: wireLegs(legs, contracts), payout, fee, limit, board: board$, T, direction, contracts,
    aboutLose: direction === "buy" && board$ != null ? payout * board$ + fee : null,
    label: direction === "buy" ? buyLabel(level.id, sideKey) : closeLabel(level.id, sideKey),
  };
}

/**
 * Selling back a one-tap position: the same package, every contract still open, direction "sell".
 * The floor comes from the board's sell-back price when it has one, else from Derive's mark (set by
 * the ticket). Only the instruments actually held can be sold back.
 */
export function sellPlan({ position, level = null, board = null, paused = false }) {
  const q = parseId(position?.id);
  const contracts = position ? remainingQty(position) : 0;
  if (!q || !(contracts > 0) || partial(position)) return null;
  const legs = packageLegs({ und: q.und, expiry: q.expiry, kind: position.side, lo: position.lo, hi: position.hi });
  if (position.legs && !sameLegs(position.legs, legs.map((l) => [l.instrument_name]))) return null;
  const payout = contracts * (position.hi - position.lo);
  const T = toleranceFor(board?.thin);
  const side = level?.[position.side];
  const spec = board?.spec || {};
  const prices = Object.fromEntries((side?.close || side?.legs || []).map(([n, , px]) => [n, px]));
  const fee = Number.isFinite(board?.index) ? rfqFee(legs, contracts, { index: board.index, taker: spec.taker, cap: spec.cap, base: spec.base }, prices) : null;
  const sell = !paused && Number.isFinite(side?.sell) ? side.sell : null;
  return {
    legs, wire: wireLegs(legs, contracts), payout, fee, T, direction: "sell", contracts, board: sell,
    limit: sell != null ? minTotalCost(payout, sell, T) : null,
    aboutNet: sell != null && fee != null ? payout * sell - fee : null,
    label: closeLabel(position.id, position.side),
  };
}

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** One sentence on what filled, from Derive's own records. */
function Filled({ fill, buy }) {
  const total = fill.fees != null ? Math.abs(fill.premium) + (buy ? fill.fees : -fill.fees) : null;
  const c = qty(fill.legs[0]?.qty);
  return (
    <div className="tr-done" role="status">
      <p>{fill.complete === false ? <>Trade sent. Derive's trade records are still being checked.</> : fill.fees == null
        ? <>{buy ? "Bought" : "Sold back"} {c} contracts. Premium {buy ? "paid" : "received"} before Derive fees: <b className="mono">{money(buy ? fill.premium : -fill.premium, { cents: true })}</b>.</>
        : buy ? <>Bought {c} contracts for <b className="mono">{money(total, { cents: true })}</b>, Derive fees {money(fill.fees, { cents: true })} included.</>
        : <>Sold back {c} contracts. Got <b className="mono">{money(total ?? -fill.premium, { cents: true })}</b>{fill.fees != null && <> after Derive fees of {money(fill.fees, { cents: true })}</>}.</>}</p>
      {fill.complete === false && <p>Derive's records don't show every option of this trade yet. Positions checks it again with Derive.</p>}
      {fill.complete !== false && fill.fees == null && <p>Derive's fees are not available yet. {buy ? "Total cost stays unknown." : "Proceeds after fees stay unknown."}</p>}
      {fill.partial && <p>Derive filled {Math.round(fill.pct * 100)}% of the package; the rest is cancelled and not sent again.</p>}
      <p className="tr-note">From Derive's trade records{fill.trade_ids?.length ? <> · {fill.trade_ids.length} {fill.trade_ids.length === 1 ? "trade" : "trades"}</> : null}. <Link className="text-link" to="/saloon/mine">See it in Positions</Link></p>
    </div>
  );
}

/**
 * The stage 2 ticket: a firm RFQ price for the whole package. In a dry-run build the fill is signed
 * and checked by Derive, nothing fills; in a testnet build the user's tap fills it on Derive's testnet.
 */
export default function TradeTicket({ plan, onFill, trading = "on", mode = MODE }) {
  const seat = useSeat();
  const [st, setSt] = useState({ phase: "idle" });
  const run = useRef(null);
  const request = useRef(null);
  const generation = useRef(0);
  const getInstrument = useMemo(() => (seat.client ? instrumentCache(seat.client) : null), [seat.client]);
  const now = useNow(st.phase === "quoted");
  const tradingRef = useRef(trading);
  tradingRef.current = trading;
  useLayoutEffect(() => {
    generation.current += 1;
    run.current?.close(); run.current = null; request.current = null;
    setSt({ phase: "idle" });
    return () => { generation.current += 1; run.current?.close(); run.current = null; request.current = null; };
  }, [plan?.label, plan?.contracts, seat.wallet, seat.saloon?.id, seat.client, seat.key, seat.stage, mode]);

  const sameSeat = (scope) => {
    const live = seatState();
    return live.stage === "ready" && live.client === scope.client && live.key === scope.key
      && live.saloon?.id === scope.subaccountId && live.wallet === scope.wallet;
  };

  if (!plan) return <p className="status">No price on Derive's screen for this right now.</p>;
  const buy = plan.direction === "buy";
  const fills = mode === "testnet";
  const allowed = tradingAllows(trading, plan.direction);
  const preCap = buy ? capGate(plan.aboutLose, seat.wallet) : { ok: true };
  const ask = () => {
    const scope = { wallet: seat.wallet, subaccountId: seat.saloon?.id, client: seat.client, key: seat.key };
    if (!sameSeat(scope) || !tradingAllows(tradingRef.current, plan.direction)) return;
    run.current?.close();
    const token = ++generation.current;
    request.current = { scope, token };
    const current = () => token === generation.current && sameSeat(scope);
    run.current = createTicket({
      client: seat.client, getInstrument, subaccountId: seat.saloon.id, owner: seat.wallet, key: keySigner(seat.key),
      legs: plan.wire, direction: plan.direction, limit: plan.limit, payout: plan.payout, feeEstimate: plan.fee, label: plan.label,
      estimate: buy ? plan.aboutLose : null, tolerance: plan.T, mode, trading: () => current() ? tradingRef.current : "off",
      onFill: (f) => onFill?.(f, { wallet: scope.wallet, subaccountId: scope.subaccountId }),
      onChange: (s) => { if (current()) setSt({ ...s }); }, onKeyRejected: () => { if (current()) dropKey(); },
    });
    run.current.start();
  };
  const confirm = () => {
    const active = request.current;
    if (active && active.token === generation.current && sameSeat(active.scope)) run.current?.confirm(st.check.total);
  };
  const c = st.check;
  const firmLeft = st.firmUntil ? Math.max(0, Math.ceil((st.firmUntil - now) / 1000)) : 0;
  const quoted = st.phase === "quoted";
  const firm = !!c?.ok && ["quoted", "checking", "checked", "executing"].includes(st.phase); // figures from Derive's firm quote
  const cap = quoted && buy ? capGate(c.mostLose, seat.wallet) : { ok: true };
  const busy = ["asking", "checking", "executing", "confirming"].includes(st.phase);
  const waitText = { asking: "Asking Derive for a firm price…", checking: "Checking with Derive…", executing: "Filling on Derive…", confirming: "Checking your fill…" }[st.phase];
  const again = (label = "Get a new price") => allowed && <button className="btn lg tr-go" onClick={ask}>{label}</button>;
  const tap = buy ? `Buy for ${money(c?.mostLose, { cents: true })}` : `Sell for ${money(c?.net, { cents: true })}`;

  return (
    <div className="tr-ticket" aria-live="polite">
      <dl className="q-money tr-money">
        {buy ? (
          <div className="q-lose"><dt>Most you can lose</dt><dd className="mono">{firm ? money(c.mostLose, { cents: true }) : <>about {money(plan.aboutLose, { cents: true })}</>}</dd></div>
        ) : (
          <div className="q-lose"><dt>You get</dt><dd className="mono">{firm ? money(c.net, { cents: true }) : plan.aboutNet != null ? <>about {money(plan.aboutNet, { cents: true })}</> : "At Derive's price"}</dd></div>
        )}
        <div><dt>Price</dt><dd className="mono">{firm ? <>{perDollar(c.perDollar)} per $1{quoted && <> · <span className="tr-firm">firm for {firmLeft} s</span></>}</> : plan.board != null ? <>about {cents(centsUp(plan.board))} per $1</> : "Ask Derive"}</dd></div>
        <div><dt>{buy ? "Pays up to" : "Contracts"}</dt><dd className="mono">{buy ? money(plan.payout, { cents: true }) : qty(plan.contracts)}</dd></div>
        <div><dt>Derive fees
          <Info label="About Derive's fees">Derive charges one $0.50 base fee per answer plus a small share of the coin's price on the costliest option; both options fill as one package. Cowboy adds no fee.</Info></dt>
          <dd className="mono">{firm ? money(c.fee, { cents: true }) : plan.fee != null ? <>about {money(plan.fee, { cents: true })}</> : "From Derive"}</dd></div>
      </dl>

      {!allowed && <p className="tr-msg" role="status">{TRADING_NOTICE[trading] || TRADING_NOTICE.off}</p>}
      {allowed && st.phase === "idle" && (preCap.ok
        ? <button className="btn primary lg tr-go" onClick={ask}>{buy ? "Get price" : "Get sell-back price"}</button>
        : <p className="tr-msg">{capMessage(preCap)}</p>)}
      {busy && <p className="tr-wait"><span className="spin" aria-hidden="true" />{waitText}</p>}
      {quoted && (
        <>
          {st.changed && <p className="tr-msg">Derive's price moved. Check the new number.</p>}
          {!cap.ok && <p className="tr-msg">{capMessage(cap)}</p>}
          <button className="btn primary lg tr-go" disabled={!cap.ok || !allowed} onClick={confirm}>
            {fills ? tap : `Dry run: ${tap.toLowerCase()}`}
          </button>
          <p className="tr-note">{fills
            ? <>Derive testnet, test USDC. One tap fills every option of the answer at this price.</>
            : "Testnet dry run. Cowboy signs the trade and Derive checks the signature; nothing fills."}</p>
        </>
      )}
      {st.phase === "lapsed" && <><p className="tr-note">That price has lapsed.</p>{again()}</>}
      {st.phase === "beyond" && (
        <>
          <p className="tr-msg">{plan.board != null
            ? <>Derive's price is {perDollar(c.perDollar)} now; the board showed {cents(centsUp(plan.board))}.</>
            : <>Derive's price is {perDollar(c.perDollar)} now, too far from its mark.</>}</p>
          {again("Ask again")}
        </>
      )}
      {st.phase === "blocked" && (
        <>
          <p className="tr-msg">{c?.reason === "fee" ? "Derive's fee is higher than usual right now."
            : c?.reason === "margin" ? "On Derive this package would hold more than its price, so Cowboy does not offer it."
              : "Derive did not accept this package."}</p>
          {again("Ask again")}
        </>
      )}
      {st.phase === "no_quote" && (
        <>
          <p className="tr-msg">No price from Derive right now.<ErrorDetail detail={st.detail} /></p>
          {allowed && <div className="tr-actions"><button className="btn lg" onClick={ask}>Try again</button></div>}
        </>
      )}
      {st.phase === "not_listed" && <p className="tr-msg" role="status">{st.message}<ErrorDetail detail={st.detail} /></p>}
      {st.phase === "down" && <p className="tr-msg">Derive isn't taking orders right now.</p>}
      {(st.phase === "paused" || st.phase === "capped") && <p className="tr-msg" role="status">{st.message}</p>}
      {st.phase === "checked" && (
        <>
          <p className={`tr-done${st.debug?.ok ? "" : " warn"}`}>{st.debug?.ok
            ? "Derive checked the signed trade and it matches, byte for byte. Nothing filled."
            : "Derive's check did not match this browser's signature. Nothing filled."}</p>
          {again()}
        </>
      )}
      {st.phase === "filled" && <Filled fill={st.fill} buy={buy} />}
      {["expired", "busy", "rejected", "not_filled"].includes(st.phase) && <><p className="tr-msg" role="alert">{st.message}<ErrorDetail detail={st.detail} /></p>{again(st.phase === "busy" ? "Try again" : "Get a new price")}</>}
      {st.phase === "unknown" && (
        <>
          <p className="tr-msg warn" role="alert">{st.message}</p>
          <button className="btn lg tr-go" onClick={() => run.current?.recheck()}>Check again</button>
        </>
      )}
      {st.phase === "error" && <><p className="tr-msg">{st.message}<ErrorDetail detail={st.detail} /></p>{again("Try again")}</>}
    </div>
  );
}
