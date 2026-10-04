import { useEffect, useMemo, useRef, useState } from "react";
import { Info } from "../ui.jsx";
import { cents, centsUp, money, parseId } from "../../lib/questions.js";
import {
  capCheck, maxTotalCost, minTotalCost, packageLegs, rfqFee, toleranceFor, wireLegs,
} from "../../lib/trade/package.js";
import { createDryRun } from "../../lib/trade/rfq.js";
import { instrumentCache } from "../../lib/trade/derive.js";
import { keySigner } from "../../lib/trade/sessionKey.js";
import { useSeat } from "../../lib/trade/seat.js";

const perDollar = (x) => cents(Math.round(x * 100));

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
    legs, wire: wireLegs(legs, contracts), payout, fee, limit, board: board$, T,
    aboutLose: direction === "buy" && board$ != null ? payout * board$ + fee : null,
    label: `${level.id}:${sideKey}`,
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

/** The stage 2 ticket: a firm RFQ price for the whole package, and in this build a dry run of the fill. */
export default function TradeTicket({ und, level, sideKey, board, contracts, onByHand, direction = "buy" }) {
  const seat = useSeat();
  const plan = useMemo(() => ticketPlan({ und, level, sideKey, board, contracts, direction }), [und, level, sideKey, board, contracts, direction]);
  const [st, setSt] = useState({ phase: "idle" });
  const run = useRef(null);
  const getInstrument = useMemo(() => (seat.client ? instrumentCache(seat.client) : null), [seat.client]);
  const now = useNow(st.phase === "quoted");
  useEffect(() => () => { run.current?.close(); }, []);
  useEffect(() => { run.current?.close(); run.current = null; setSt({ phase: "idle" }); }, [plan?.label, contracts]);

  if (!plan) return <p className="status">No price on Derive's screen for this right now.</p>;
  const ask = () => {
    run.current?.close();
    run.current = createDryRun({
      client: seat.client, getInstrument, subaccountId: seat.saloon.id, owner: seat.wallet, key: keySigner(seat.key),
      legs: plan.wire, direction, limit: plan.limit, payout: plan.payout, feeEstimate: plan.fee, label: plan.label,
      onChange: (s) => setSt({ ...s }),
    });
    run.current.start();
  };
  const c = st.check;
  const firmLeft = st.firmUntil ? Math.max(0, Math.ceil((st.firmUntil - now) / 1000)) : 0;
  const quoted = st.phase === "quoted";
  const firm = !!c?.ok && ["quoted", "checking", "checked"].includes(st.phase); // figures from Derive's firm quote
  const cap = quoted ? capCheck(c.mostLose, { testnet: true }) : { ok: true };
  const busy = st.phase === "asking" || st.phase === "checking";

  return (
    <div className="tr-ticket" aria-live="polite">
      <dl className="q-money tr-money">
        <div className="q-lose"><dt>Most you can lose</dt><dd className="mono">{firm ? money(c.mostLose, { cents: true }) : <>about {money(plan.aboutLose, { cents: true })}</>}</dd></div>
        <div><dt>Price</dt><dd className="mono">{firm ? <>{perDollar(c.perDollar)} per $1{quoted && <> · <span className="tr-firm">firm for {firmLeft} s</span></>}</> : <>about {cents(centsUp(plan.board))} per $1</>}</dd></div>
        <div><dt>Pays up to</dt><dd className="mono">{money(plan.payout, { cents: true })}</dd></div>
        <div><dt>Derive fees
          <Info label="About Derive's fees">Derive charges one $0.50 base fee per answer plus a small share of the coin's price on the costliest option; both options fill as one package. Cowboy adds no fee.</Info></dt>
          <dd className="mono">{firm ? money(c.fee, { cents: true }) : <>about {money(plan.fee, { cents: true })}</>}</dd></div>
      </dl>

      {st.phase === "idle" && <button className="btn primary lg tr-go" onClick={ask}>Get price</button>}
      {busy && <p className="tr-wait"><span className="spin" aria-hidden="true" />{st.phase === "asking" ? "Asking Derive for a firm price…" : "Checking with Derive…"}</p>}
      {quoted && (
        <>
          {st.changed && <p className="tr-msg">Derive's price moved. Check the new number.</p>}
          {!cap.ok && <p className="tr-msg">Most you can lose is over the {money(cap.cap)} limit per answer.</p>}
          <button className="btn primary lg tr-go" disabled={!cap.ok} onClick={() => run.current.confirm(c.total)}>
            Dry run: buy for {money(c.mostLose, { cents: true })}
          </button>
          <p className="tr-note">Testnet dry run. Cowboy signs the trade and Derive checks the signature; nothing fills.</p>
        </>
      )}
      {st.phase === "lapsed" && <><p className="tr-note">That price has lapsed.</p><button className="btn lg tr-go" onClick={ask}>Get a new price</button></>}
      {st.phase === "beyond" && (
        <>
          <p className="tr-msg">Derive's price is {perDollar(c.perDollar)} now; the board showed {cents(centsUp(plan.board))}.</p>
          <button className="btn lg tr-go" onClick={ask}>Ask again</button>
        </>
      )}
      {st.phase === "blocked" && (
        <>
          <p className="tr-msg">{c?.reason === "fee" ? "Derive's fee is higher than usual right now."
            : c?.reason === "margin" ? "On Derive this package would hold more than its price, so Cowboy does not offer it."
              : "Derive did not accept this package."}</p>
          <button className="btn lg tr-go" onClick={ask}>Ask again</button>
        </>
      )}
      {st.phase === "no_quote" && (
        <>
          <p className="tr-msg">No price from Derive right now.</p>
          <div className="tr-actions"><button className="btn lg" onClick={ask}>Try again</button><button className="text-control" onClick={onByHand}>Place by hand</button></div>
        </>
      )}
      {st.phase === "down" && <p className="tr-msg">Derive isn't taking orders right now. <span className="mono">—</span></p>}
      {st.phase === "checked" && (
        <>
          <p className={`tr-done${st.debug?.ok ? "" : " warn"}`}>{st.debug?.ok
            ? "Derive checked the signed trade and it matches, byte for byte. Nothing filled."
            : "Derive's check did not match this browser's signature. Nothing filled."}</p>
          <button className="btn lg tr-go" onClick={ask}>Get a new price</button>
        </>
      )}
      {st.phase === "error" && <><p className="tr-msg">{st.message}</p><button className="btn lg tr-go" onClick={ask}>Try again</button></>}
    </div>
  );
}
