import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { Info, Tabs } from "../components/ui.jsx";
import { Asset } from "../components/MarketVisuals.jsx";
import PayZone from "../components/PayZone.jsx";
import QuestionTicket from "../components/QuestionTicket.jsx";
import Exposure from "../components/Exposure.jsx";
import {
  ANSWER, cents, closeTicket, countdown, dayLabel, findLevel, fullPay, money, noPriceReason, parseId, priceAge, questionText, signed,
} from "../lib/questions.js";
import {
  closePosition, exportPositions, forWallet, importPositions, incompleteReceipt, loadPositions, openPart, partial, persistent, positionFigures, positionStatus, prune, removePosition,
  settlePosition,
} from "../lib/positions.js";
import { breakdownRows, closeEvent, incompleteEntryReceipt, realized, realizedSummary, remainingQty } from "../lib/realized.js";
import { exposureGroups } from "../lib/exposure.js";
import { compareReadings, hasJournal } from "../lib/journal.js";
import { TESTNET_FILLS } from "../lib/flags.js";
import "../questions.css";
import "../journal.css";
import "../marketplace-positions.css";

// Saloon stage 2 on testnet: Positions reads the testnet journal and the Saloon account on Derive,
// and one-tap positions sell back through Derive. Other builds carry none of this code.
const NET = TESTNET_FILLS ? "testnet" : "mainnet";
const OneTap = TESTNET_FILLS ? lazy(() => import("../components/trade/TradePanel.jsx")) : null;
const DeriveSync = TESTNET_FILLS ? lazy(() => import("../components/trade/TradePanel.jsx").then((m) => ({ default: m.DeriveSync }))) : null;
// Following: the Saloon board limited to followed answers, as a tab here.
const Board = lazy(() => import("./Board.jsx"));
const AlsoOnDerive = TESTNET_FILLS ? lazy(() => import("../components/trade/TradePanel.jsx").then((m) => ({ default: m.AlsoOnDerive }))) : null;

const usd = (v) => money(v, { cents: true });
const DERIVE_ENTRY_FEES = "Derive's entry fees are not available yet. Total cost and profit or loss need those fees.";
const sumNets = (r) => (r.portions.every((x) => x.exit.net != null) ? r.portions.reduce((a, x) => a + x.exit.net, 0) : null);

/** A value Cowboy cannot show, in words, with the reason in an (i). */
function Missing({ text, why, label }) {
  return <span className="q-noprice">{text}<Info label={label}>{why}</Info></span>;
}

const tone = (v) => (v > 0.004 ? "up" : v < -0.004 ? "down" : "");

/** One figure of a card: its label, its value, or "Not available yet" / "No price now" with the reason. */
function Fig({ label, info, sub, value, missing, className = "" }) {
  return (
    <div className={className}>
      <dt>{label}{info}{sub && <small>{sub}</small>}</dt>
      <dd className="mono">{value ?? missing}</dd>
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "3 Oct 14:05 UTC". */
function when(ts) {
  if (!Number.isFinite(ts)) return null;
  const d = new Date(ts * 1000);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)} UTC`;
}

const You = () => <small className="q-you">Entered by you</small>;
/** Who a journal figure comes from: the user, or Derive's own records for a one-tap fill. */
const By = ({ j }) => (TESTNET_FILLS && j?.source === "derive" ? <small className="q-you">From Derive</small> : <You />);

function Cell({ c, label }) {
  if (!c.show) return <Missing text={c.text} label={label} why={c.why} />;
  return <span className="q-since-v"><b className={c.state || ""}>{c.text}</b><small className="mono">{when(c.ts) || "time unknown"}</small></span>;
}

/** Since you entered: the three readings saved at entry beside the latest ones, each with its own
 * time. Saved-later, missing and differently calculated readings say so; no direction is picked. */
function SinceStrip({ p, markets, now }) {
  const rows = compareReadings(p, markets, now);
  const ctx = p.journal?.context;
  const status = !ctx ? "Saved before entry records" : ctx.status === "at_fill" ? "Saved at your fill" : "Saved later";
  const why = !ctx ? "This position was saved before Cowboy kept the readings at entry. They stay unknown; the latest readings show for reference."
    : `Filled ${ctx.fill_ts ? `${when(ctx.fill_ts)} (entered by you)` : "at a time not entered"}. Saved ${when(ctx.snapshot_ts)}. Readings published ${when(ctx.published_at) || "at an unknown time"}. ${ctx.status === "at_fill"
      ? "Every reading here was published at or before your fill; each shows its own time and can be older than the fill."
      : "A reading counts as entry context only when it was published at or before your fill. The others are kept as later context and are not shown as what you had at the fill."}`;
  return (
    <section className="q-since" aria-label="Since you entered">
      <div className="q-since-head">
        <h3>Since you entered</h3>
        <span className="q-since-status">{status}<Info label="About these readings">{why}</Info></span>
      </div>
      <table className="q-since-t">
        <thead><tr><th scope="col"><span className="sr-only">Reading</span></th><th scope="col">At entry</th><th scope="col">Latest</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind}>
              <th scope="row">{r.name}</th>
              <td><Cell c={r.entry} label={`${r.name} at entry`} /></td>
              <td><Cell c={r.latest} label={`${r.name} latest`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The entry record: the package as placed, what filled and what it cost, as entered by the user,
 * apart from the board's estimate and Derive's mark. Older entries show their unknowns. */
function EntryRecord({ p }) {
  const j = p.journal;
  if (!hasJournal(p)) {
    return (
      <details className="q-entry">
        <summary>Entry record</summary>
        <p className="q-note">Saved before Cowboy kept entry records: the fill time, fees, Derive's mark and the readings at entry are unknown.</p>
        <dl className="q-figs">
          <div><dt>Paid, fees included<You /></dt><dd className="mono">{usd(p.paid)}</dd></div>
          <div><dt>Options</dt><dd className="mono">{p.legs?.length ? p.legs.join(", ") : "Not recorded"}</dd></div>
          <div><dt>Saved</dt><dd className="mono">{when(p.at) || "Not recorded"}</dd></div>
        </dl>
      </details>
    );
  }
  const f = j.fill || {};
  const pendingEntry = incompleteEntryReceipt(p);
  const c = j.cost || {};
  const deriveReceipt = TESTNET_FILLS && j.source === "derive";
  const entryCostUnknown = deriveReceipt && !Number.isFinite(c.total);
  const feeWhy = DERIVE_ENTRY_FEES;
  const m = j.mark;
  const e = j.board_estimate;
  const nr = <span className="q-noprice">Not entered</span>;
  return (
    <details className="q-entry">
      <summary>Entry record</summary>
      <dl className="q-figs">
        <div><dt>Filled<By j={j} /></dt><dd className="mono">{when(f.ts) || nr}</dd></div>
        <div><dt>Saved by Cowboy</dt><dd className="mono">{when(j.saved_ts)}</dd></div>
        <div><dt>Where</dt><dd>{j.venue} · {j.network}</dd></div>
        <div className="q-entry-legs"><dt>Package<small>{j.package?.direction} · {j.package?.zone}</small></dt>
          <dd><ul>{(f.legs || []).map((l) => (
            <li key={l.name} className="mono">{l.signed_qty > 0 ? "+" : l.signed_qty < 0 ? "-" : ""}{Math.abs(l.signed_qty ?? 0)} {l.name}
              {l.qty < l.planned ? <small> of {l.planned}</small> : null}{l.price != null ? <small> at {usd(l.price)}</small> : null}</li>))}</ul></dd></div>
        <div><dt>Filled amounts<By j={j} /></dt><dd>{pendingEntry ? <span className="warn-text">Derive's records still being checked</span> : f.complete ? (f.filled_pct != null && f.filled_pct < 1 ? `Whole package, ${Math.round(f.filled_pct * 100)}% of the size asked` : "Whole package") : <span className="warn-text">Not fully filled</span>}</dd></div>
        {TESTNET_FILLS && f.trade_ids?.length > 0 && <div><dt>Derive trade ids</dt><dd className="mono q-trade-ids">{f.trade_ids.map((id) => <span key={id}>{id}</span>)}</dd></div>}
        <div><dt>Premium, before fees<By j={j} />{f.limitation === "package_total" && <small>one total; leg prices not entered</small>}</dt><dd className="mono">{usd(c.premium)}</dd></div>
        <div><dt>Derive's fees{c.fees_basis === "entered" ? <You /> : deriveReceipt ? <By j={j} /> : <small>{c.fees_basis === "estimated" ? "not entered · estimated" : "not entered"}</small>}</dt>
          <dd className="mono">{c.fees != null ? usd(c.fees) : deriveReceipt ? <Missing text="Not available yet" label="Why no entry fees" why={feeWhy} /> : nr}</dd></div>
        <div className="q-lose"><dt>Total cost{entryCostUnknown ? <small>Derive's fees unavailable</small> : c.fees_basis !== "entered" && c.fees_basis !== "exact" && <small>{c.fees_basis === "estimated" ? "with estimated fees" : "before fees"}</small>}</dt>
          <dd className="mono">{entryCostUnknown ? <Missing text="Not available yet" label="Why no total entry cost" why={feeWhy} /> : usd(c.total ?? c.premium)} {f.currency && <small>{f.currency}</small>}</dd></div>
        <div><dt>Breakeven at settlement{c.breakeven_basis !== "exact" && c.breakeven != null && <small>estimated</small>}</dt>
          <dd className="mono">{!entryCostUnknown && c.breakeven != null ? money(c.breakeven) : <Missing text="Not available yet" label="Why no breakeven"
            why={entryCostUnknown ? feeWhy : f.complete ? "The cost is at or above the most the answer pays, so it has no breakeven." : "The package did not fully fill, so the answer has no breakeven."} />}</dd></div>
        {e && <div><dt>Board estimate<small>from the Saloon's screen, not a fill</small></dt><dd className="mono">{usd(e.total)}{e.ts ? <small> · {when(e.ts)}</small> : null}</dd></div>}
        <div><dt>Derive's mark<Info label="About the mark">Derive's mark for the package from Cowboy's board: a valuation benchmark, separate from your fill prices and from the sell-back price.{m?.timing === "later" ? " Taken after your fill, or with no fill time entered." : ""}</Info></dt>
          <dd className="mono">{m ? <>{usd(m.value)}{m.ts ? <small> · {when(m.ts)}</small> : null}</> : <span className="q-noprice">Not available yet</span>}</dd></div>
      </dl>
    </details>
  );
}

const PART = {
  value_change: ["Package value change", "Derive's mark for the package when you sold (or what it paid at settlement) minus its mark when you entered. The options' value moves with the coin's price, volatility and time left; Derive's mark is a benchmark, not an exact fair value, and nothing here says what caused it."],
  entry_vs_mark: ["Entry cost versus mark", "What you paid before fees minus Derive's mark at entry, counted against you. It adds to the result when your fill was better than the mark."],
  exit_vs_mark: ["Exit cost versus mark", "Derive's mark when you sold minus what the options brought before fees, counted against you. It adds to the result when your sale was better than the mark."],
  fees: ["Derive's fees", "Entry and exit fees for these contracts, each counted once."],
  rounding: ["Rounding", "The parts are rounded to the cent; this line makes them add up to the result."],
};
const MISS = {
  fill_pending: "Derive's trade records are still being checked.",
  split: "How what you paid splits into premium and fees: saved before Cowboy kept entry records.",
  premium: "The premium you paid, before fees.",
  entry_fees: "Derive's fees at entry: not entered and not estimable.",
  entry_mark: "Derive's mark at entry: not saved with this position.",
  entry_mark_far: "Derive's mark at entry: taken more than 35 minutes from your fill, or no fill time entered, so it is not a fair benchmark.",
  mark_partial: "Derive's mark: it values the whole answer, not the one option that filled.",
  exit_split: "What the options brought before fees: only the amount after fees was saved.",
  exit_fees: "Derive's fees to sell back.",
  exit_mark: "Derive's mark when you sold: no board price was available.",
  exit_mark_far: "Derive's mark when you sold: more than 35 minutes from your sale time, or no sale time entered.",
};
const BASIS = { entered: "Entered by you", estimated: "Estimated", exact: "Exact", none: "None", included: "Included in what you paid", unknown: "Not entered" };

/** One realized portion: the amounts, each with how it is known, then the breakdown against
 * Derive's mark that adds up to the result, or what is missing for one. */
function Portion({ x, und, deriveReceipt = false }) {
  const checkingSettlement = x.kind === "settle" && x.missing.includes("fill_pending");
  const head = checkingSettlement ? <>Settlement records still being checked</> : x.kind === "settle"
    ? <>Settled at {money(x.settle_price)}<small className="mono">{amountTextQ(x.qty)} contracts</small></>
    : <>Sold back {amountTextQ(x.qty)} contracts<small className="mono">{when(x.ts) ? `${when(x.ts)} · ${TESTNET_FILLS && x.basis.exit === "exact" ? "from Derive" : "entered by you"}` : "time not entered"}</small></>;
  const rows = breakdownRows(x);
  const row = (label, sub, v, cls = "") => (
    <div className={cls}><dt>{label}{sub && <small>{sub}</small>}</dt><dd className="mono">{v}</dd></div>
  );
  const nr = <span className="q-noprice">{deriveReceipt ? "Not available yet" : "Not entered"}</span>;
  return (
    <div className="q-real-p">
      <h4>{head}</h4>
      <dl className="q-figs">
        {x.entry.premium != null
          ? row("Premium paid", deriveReceipt ? "From Derive" : BASIS.entered, usd(x.entry.premium))
          : row("Paid, fees included", deriveReceipt ? "From Derive" : BASIS.entered, x.entry.total != null ? usd(x.entry.total) : nr)}
        {x.entry.premium != null && row("Entry fees", deriveReceipt && x.basis.entry_fees === "unknown" ? "Derive's fee records unavailable" : BASIS[x.basis.entry_fees] || "", x.entry.fees != null ? usd(x.entry.fees) : nr)}
        {x.kind === "settle"
          ? row("Settlement payout", checkingSettlement ? MISS.fill_pending : `Exact, from Derive's settlement price for ${und}`, x.exit.gross != null ? usd(x.exit.gross) : <span className="q-noprice">Not available yet</span>)
          : x.exit.gross != null ? row("Sell-back proceeds, before fees", BASIS[x.basis.exit], usd(x.exit.gross))
            : row("Got back, after fees", BASIS.entered, x.exit.net != null ? usd(x.exit.net) : nr)}
        {x.kind === "settle" ? row("Exit fees", "Derive's fee schedule lists no settlement fee", usd(0))
          : x.exit.gross != null && row("Exit fees", BASIS[x.basis.exit_fees], x.exit.fees != null ? usd(x.exit.fees) : nr)}
        {row("Realized P/L", x.estimated ? "with estimated fees" : null, x.net != null ? <span className={tone(x.net)}>{signed(x.net)}</span> : <span className="q-noprice">Not available yet</span>, "q-real-total")}
      </dl>
      {rows ? (
        <dl className="q-figs" aria-label="Where it came from">
          {rows.map(([k, v]) => <Fragment key={k}>{row(<>{PART[k][0]}<Info label={PART[k][0]}>{PART[k][1]}</Info></>, null, <span className={tone(v)}>{signed(v)}</span>)}</Fragment>)}
        </dl>
      ) : (
        <>
          <p className="q-note">Not available yet: the split against Derive's mark needs<Info label="Why no breakdown">Cowboy does not invent the missing pieces; the result above uses only what is known.</Info></p>
          <ul className="q-real-miss">{x.missing.map((k) => <li key={k}>{deriveReceipt && k === "entry_fees" ? DERIVE_ENTRY_FEES : MISS[k]}</li>)}</ul>
        </>
      )}
    </div>
  );
}

const amountTextQ = (v) => String(Number((v ?? 0).toFixed(8)));

function Realized({ p, und }) {
  const r = realized(p);
  if (!r.portions.length) return null;
  return (
    <details className="q-real">
      <summary>Where the result came from</summary>
      {r.portions.map((x, i) => <Portion key={i} x={x} und={und} deriveReceipt={TESTNET_FILLS && p.journal?.source === "derive"} />)}
      {r.open > 0 && <p className="q-note">{amountTextQ(r.open)} contracts are still open and not counted here.</p>}
    </details>
  );
}

/** Records the settlement of a position past its date once Derive's settlement price is published,
 * whichever tab is open, so the realized summary counts it. Renders nothing. */
function SettleWatch({ p, onSettle }) {
  const q = parseId(p.id);
  const { data: board } = useData(q ? `questions/${q.und}.json` : null);
  const found = board ? findLevel(board, p.id) : null;
  const fromBoard = found?.settled ? found.date.settle_price : null;
  const { data: hist } = useData(fromBoard == null && q ? `questions/history/${q.und}-${q.expiry}.json` : null, 30 * 60_000);
  const price = fromBoard ?? hist?.settle_price ?? null;
  useEffect(() => { if (Number.isFinite(price)) onSettle(p.key, price); }, [price, p.key]);
  return null;
}

const SYNC = {
  matches: ["On Derive: held", "Derive's Saloon account holds the options of this answer, in the amounts recorded here."],
  differs: ["Differs from Derive", null],
  settled: ["Settled on Derive", "Past its settlement time; Derive pays the result into the Saloon account."],
  closed: ["Closed on Derive", "Nothing of this answer is open any more."],
  unknown: ["Not checked", "This record has no options to compare with Derive."],
  other_account: ["Another Derive account", null],
};
/** How a one-tap record stands against Derive's own positions (testnet builds). */
function SyncLine({ s }) {
  const [text, whyFixed] = SYNC[s.state] || SYNC.unknown;
  const why = s.state === "other_account"
    ? (s.subaccount_id != null
      ? `Recorded from Derive account #${s.subaccount_id}. It is checked against Derive only while that account is in use.`
      : "Not found in the trades of the Derive account in use. It is checked against Derive when its own account is in use.")
    : whyFixed;
  const diff = s.diff?.map((d) => `${d.name}: recorded ${d.expected}, Derive holds ${d.held}`).join("; ");
  return (
    <p className={`q-card-status q-sync${s.state === "differs" ? " warn" : ""}`}>{text}
      <Info label="Compared with Derive">{why || `Derive's positions do not match what this browser recorded, for example after a trade on another device or on Derive itself. ${diff}. Derive's records are the reference.`}</Info>
    </p>
  );
}

function Card({ p, onRemove, onClose, sync = null, scope = null }) {
  const q = parseId(p.id);
  const { data: board } = useData(q ? `questions/${q.und}.json` : null);
  const { data: markets } = useData("markets.json");
  const found = board ? findLevel(board, p.id) : null;
  const now = Date.now() / 1000;
  const settleTs = p.settle_ts || (q ? Date.UTC(+q.expiry.slice(0, 4), +q.expiry.slice(4, 6) - 1, +q.expiry.slice(6, 8), 8) / 1000 : 0);
  const after = now >= settleTs;
  const priceFromBoard = found?.settled ? found.date.settle_price : null;
  const { data: hist } = useData(after && priceFromBoard == null && q ? `questions/history/${q.und}-${q.expiry}.json` : null, 30 * 60_000);
  const settle = priceFromBoard ?? hist?.settle_price ?? null;
  const [closing, setClosing] = useState(false);
  const paused = board ? priceAge(board.prices_ts, now, board.paused).state === "paused" : true;
  const settling = (!after && now >= settleTs - 1800) || (after && settle == null);
  const half = partial(p);
  const oneTap = TESTNET_FILLS && p.exec === "rfq";
  const pendingReceipt = oneTap && incompleteReceipt(p);
  const pendingEntry = oneTap && incompleteEntryReceipt(p);
  const entryFeesUnknown = oneTap && !Number.isFinite(p.journal?.cost?.fees);
  const feeWhy = DERIVE_ENTRY_FEES;
  const ownAccount = !!p.wallet && p.subaccount_id != null && p.subaccount_id === scope?.subaccountId
    && String(p.wallet).toLowerCase() === String(scope?.wallet || "").toLowerCase();
  const canSell = oneTap && ownAccount && !half;
  useEffect(() => { if (!canSell && oneTap) setClosing(false); }, [canSell, oneTap]);
  const op = after || p.closed_at ? p : openPart(p);
  const t = found && !found.settled && !paused && !settling && !half && !p.closed_at
    ? closeTicket(found.level, p.side, op.contracts, board, p.legs) : null;
  const f = positionFigures(op, { found: paused ? null : found, settlePrice: settle, close: t, index: board?.index });
  const real = realized(p);
  const settleExit = pendingReceipt ? null : real.portions.find((x) => x.kind === "settle");
  const sold = (sale) => {
    const lv = found?.level;
    const fair = lv && Number.isFinite(lv.fair) ? (p.side === "yes" ? lv.fair : 1 - lv.fair) : null;
    const mark = fair == null ? null : { value: fair * (lv.hi - lv.lo) * sale.qty, ts: board?.prices_ts ?? null };
    onClose(p.key, closeEvent({ ...sale, savedTs: Math.floor(Date.now() / 1000), mark }));
  };
  const status = positionStatus(p, { settled: f.settled, settling });
  const name = ANSWER[p.side];
  const question = q ? questionText(q.und, q, q.expiry) : p.question;
  const reason = !found || paused ? "Prices are paused or this question is no longer on the board, so Derive's sell-back price is not shown."
    : f.otherLegs ? "Cowboy now builds this answer from other options than the ones you hold, so it has no sell-back price for yours. Sell back on Derive at its screen price."
      : settling ? "This date is settling: Derive averages the index from 07:30 to 08:00 UTC, and selling back has stopped."
        : noPriceReason(found.level, p.side, false);
  const partWhy = pendingReceipt
    ? "Derive's trade records are still being checked. Values and settlement need a complete fill."
    : "Cowboy prices the full answer only. With one option filled you hold that option alone; check it on Derive.";
  const usdOr = (v) => (v == null ? null : usd(v));
  const pl = (v) => (v == null ? null : <span className={tone(v)}>{signed(v)}</span>);
  const na = (why, label) => <Missing text="Not available yet" label={label} why={why} />;
  const noPrice = <Missing text="No price now" label="Why no price" why={reason} />;
  return (
    <article className={`q-card q-position q-card-${status.key}`}>
      <header className="q-position-heading">
        {q && <Asset und={q.und} compact />}
        <div>
          <Link to={`/q/${p.id}?side=${p.side}`} className="q-card-title">{question}</Link>
          <span className={`q-card-side q-position-side ${p.side === "yes" ? "higher" : "lower"}`}>{name}{q && <> · {fullPay(q, p.side)}</>}</span>
        </div>
      </header>
      <p className={`q-card-status${status.warn ? " warn" : ""}`}>
        {status.key === "settled" ? <>Settled at {money(settle)} · got {usd(settleExit?.exit.gross ?? f.got)}</> : status.text}
        <Info label="How this was placed">{oneTap
          ? "Bought through Derive's request for quote in one tap, on Derive's testnet with test USDC. The fill time, options, prices, fees and trade ids come from Derive's own records."
          : half
          ? "You told Cowboy only the first of the two orders filled. You hold one option alone, which pays differently from the answer and can lose all it cost. Finish or undo it on Derive; Cowboy shows no value for it."
          : "You placed the orders on Derive yourself and told Cowboy what you paid. Cowboy cannot see your Derive account, so these figures are only as good as what you entered."}</Info>
      </p>
      <dl className="q-figs grid q-position-figures">
        <Fig label="You paid" sub={pendingEntry ? "Derive's records still being checked" : entryFeesUnknown ? "Derive's fees unavailable" : p.journal?.cost?.fees_basis === "estimated" ? "estimated fees included" : p.journal?.cost?.fees_basis === "unknown" ? "fees not entered" : op !== p ? `fees included, for the ${amountTextQ(op.contracts)} still open` : "fees included"}
          value={pendingEntry ? null : usdOr(f.paid)} missing={na(pendingEntry ? partWhy : entryFeesUnknown ? feeWhy : "The total entry cost was not recorded.", "Why no entry cost")} />
        {pendingReceipt ? (
          <>
            <Fig label="Value now" missing={na(partWhy, "Why no value")} />
            <Fig label="Profit / loss now" missing={na(partWhy, "Why no result")} />
            <Fig label="Most it pays" missing={na(partWhy, "Why no payout")} />
          </>
        ) : f.closed || p.closed_at ? (
          <>
            <Fig label="Got back" sub="after fees" value={usdOr(real.portions.length ? sumNets(real) : f.got)} missing={na("Only part of what came back was entered.", "Why no amount")} />
            <Fig label="Realized P/L" value={pl(real.portions.length ? real.net : f.pl)} className="q-pl" missing={na(entryFeesUnknown ? feeWhy : "A part of the result was not entered; see Where the result came from.", "Why no result")} />
          </>
        ) : f.settled || (after && settleExit) ? (
          <>
            {real.portions.some((x) => x.kind === "close")
              ? <Fig label="Got back" sub="sold back in part, the rest settled, after fees" value={usdOr(sumNets(real))} missing={na("Only part of what came back was entered.", "Why no amount")} />
              : <Fig label="Got" sub={f.per != null ? `${cents(Math.round(f.per * 100))} per $1` : "at settlement"}
                value={usdOr(settleExit ? settleExit.exit.gross : f.got)} missing={na(partWhy, "Why no amount")} />}
            <Fig label="Realized P/L" value={pl(settleExit ? real.net : f.pl)} className="q-pl" missing={na(entryFeesUnknown ? feeWhy : "A part of the result was not entered; see Where the result came from.", "Why no result")} />
          </>
        ) : (
          <>
            <Fig label="Value now" sub="sell-back, after fees"
              info={f.mark != null && f.valueNow != null && <Info label="At Derive's mark">At Derive's mark: {usd(f.mark)}. Value now is Derive's sell-back price on its screen minus Derive's fees to sell back, about {usd(f.fees)}.</Info>}
              value={usdOr(f.valueNow)} missing={half ? na(partWhy, "Why no value") : noPrice} />
            <Fig label="Profit / loss now" sub="if sold back now" value={pl(f.plNow)} className="q-pl"
              missing={entryFeesUnknown ? na(feeWhy, "Why no result") : half ? na("With only one option filled there is no result for the answer.", "Why no result") : na("There is a result once Derive shows a sell-back price, or at settlement.", "Why no result")} />
            <Fig label="Most it pays" sub="at settlement" value={usdOr(f.maxPayout)} missing={na(partWhy, "Why no payout")} />
          </>
        )}
        <Fig label={f.closed ? "Sold back" : f.settled ? "Settled" : "Settles"}
          value={f.closed ? new Date(p.closed_at * 1000).toISOString().slice(0, 10) : q ? `${dayLabel(q.expiry)}, 08:00 UTC` : null}
          sub={!f.closed && !f.settled && !settling ? countdown(settleTs, now) : settling && !f.settled ? "settling now" : null} missing={na("No date saved.", "Why no date")} />
      </dl>
      {oneTap && sync && !pendingReceipt && <SyncLine s={sync} />}
      {real.portions.length > 0 && real.open > 0 && !after && (
        <p className="q-note q-position-realized">Realized so far: <b className={`mono ${tone(real.net ?? 0)}`}>{real.net != null ? signed(real.net) : "Not available yet"}</b> on {amountTextQ(p.contracts - real.open)} contracts sold back; the figures above are for the {amountTextQ(real.open)} still open.</p>
      )}
      <div className="q-position-tools">
        <details className="q-position-details">
          <summary>Position details<span aria-hidden="true">+</span></summary>
          <div className="q-position-expanded">
            {!f.closed && !f.settled && !p.closed_at && !(after && settleExit) && <dl className="q-figs grid q-position-extra">
              <Fig label="At 08:00 UTC, today's price" sub={f.expiryNow != null ? `pays ${usd(f.expiryNow)}` : null} value={pl(f.plExpiryNow)}
                info={<Info label="About the payout at today's price">What the answer pays if {q?.und} settles at today's price, {money(board?.index)}, and the profit or loss after what you paid. Not a view of where it settles.</Info>}
                missing={na(entryFeesUnknown ? feeWhy : half ? partWhy : "Cowboy needs today's price from the board to show this.", "Why no payout at today's price")} />
            </dl>}
            {q && !half && <PayZone lo={q.lo} hi={q.hi} side={p.side} index={settle ?? board?.index} compact />}
            <SinceStrip p={p} markets={markets} now={now} />
            <EntryRecord p={p} />
            <Realized p={p} und={q?.und || p.und} />
            <div className="q-card-actions">
              <button className="text-control" onClick={() => onRemove(p.key)}>Remove</button>
              <span className="q-position-remove-note">Removes this browser record only.</span>
            </div>
          </div>
        </details>
        {(oneTap ? canSell && !after && !settling && !p.closed_at && real.open > 0 : !!t) && <button className="btn q-position-close" onClick={() => setClosing((s) => !s)} aria-expanded={closing}>{closing ? "Keep it open" : "Close"}</button>}
      </div>
      {closing && canSell && (
        <Suspense fallback={null}>
          <OneTap und={q.und} question={question} answer={name} level={found?.level ?? null} sideKey={p.side} board={board}
            sell={{ position: p, paused, onExit: (exit) => { setClosing(false); onClose(p.key, exit); } }} />
        </Suspense>
      )}
      {closing && !oneTap && t && (
        <QuestionTicket und={q.und} question={question} answer={name} level={found.level} sideKey={p.side} t={t} board={board}
          pricesTs={board.prices_ts} settleTs={settleTs} stale={priceAge(board.prices_ts, now).state === "stale"} closing
          paid={op.paid} holdPayout={f.expiryNow}
          onSold={(sale) => { setClosing(false); sold(sale); }} />
      )}
    </article>
  );
}

/** Positions: kept in this browser only, with export and import under "Saved in this browser". */
export default function MyQuestions() {
  const [stored, setListRaw] = useState(() => prune(loadPositions(NET)));
  const setList = (l) => setListRaw(prune(l));
  const other = loadPositions(NET === "testnet" ? "mainnet" : "testnet").length;
  const [sync, setSync] = useState(null);
  const [scope, setScope] = useState(null);
  // Testnet: with a wallet connected, its own one-tap records (and those naming no wallet); other
  // wallets' records stay saved and in Export.
  const list = useMemo(() => forWallet(stored, scope?.wallet), [stored, scope?.wallet]);
  const [params, setParams] = useSearchParams();
  const tab = ["open", "closed", "following"].includes(params.get("tab")) ? params.get("tab") : "open";
  const setTab = (t) => setParams(t === "open" ? {} : { tab: t }, { replace: true });
  const [importError, setImportError] = useState(null);
  const file = useRef(null);
  const now = Date.now() / 1000;
  const settleOf = (p) => p.settle_ts || 0;
  const done = (p) => !!p.closed_at || now >= settleOf(p);
  const openCount = list.filter((p) => !done(p)).length;
  const incompleteCount = list.filter((p) => !p.closed_at && partial(p) && !incompleteReceipt(p)).length;
  const rows = useMemo(() => list.filter((p) => (tab === "open" ? !done(p) : done(p)))
    .sort((a, b) => settleOf(a) - settleOf(b)), [list, tab, now]);
  const pendingReceipts = list.filter(incompleteReceipt);
  const unknownFeeEntries = list.filter((p) => p.exec === "rfq" && !done(p) && !incompleteReceipt(p) && !Number.isFinite(p.journal?.cost?.total));
  const groups = useMemo(() => exposureGroups(list.filter((p) => !incompleteReceipt(p)), now), [list, now]);
  const summary = realizedSummary(list);
  const toSettle = list.filter((p) => !p.closed_at && settleOf(p) && now >= settleOf(p) && remainingQty(p) > 0 && !(p.exits || []).some((e) => e.kind === "settle"));
  const download = () => {
    const a = document.createElement("a");
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(exportPositions())}`;
    a.download = "cowboy-questions.json";
    a.click();
  };
  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { importPositions(await f.text()); setList(loadPositions(NET)); setImportError(null); } catch (err) {
      setImportError(err?.message === "Saved by a newer Cowboy" ? "This file was saved by a newer Cowboy; nothing was imported." : "That is not a Positions file; nothing was imported.");
    }
    e.target.value = "";
  };
  return (
    <div className="wrap page q-page q-mine marketplace-positions">
      <header className="q-head">
        <div className="q-head-top">
          <h1>Positions</h1>
          <Link to="/saloon" className="btn">Browse the Saloon<span aria-hidden="true">↗</span></Link>
        </div>
        <p className="q-position-intro">Your record of trades placed on Derive.<Info label="About Positions">{TESTNET_FILLS
          ? "One-tap trades are recorded from Derive's own records and checked against your Saloon account on Derive's testnet; trades placed by hand are records you entered. Everything is saved in this browser. Values use the published sell-back price after exit fees when available; an unavailable value stays unknown."
          : "These are records you entered, saved in this browser. Cowboy cannot see your Derive account. Values use the published sell-back price after exit fees when available; an unavailable value stays unknown."}</Info></p>
        {!persistent() && <p className="q-note warn" role="status">This browser is not saving data: Positions last only for this visit. Export a copy to keep them.</p>}
        {list.length > 0 && (
          <p className="q-portfolio-line" aria-label="Your saved records">
            <span><b className="mono">{openCount}</b> open</span>
            <span><b className="mono">{list.length - openCount}</b> closed or settled</span>
            {incompleteCount > 0 && <span className="q-incomplete-count"><b className="mono">{incompleteCount}</b> incomplete {incompleteCount === 1 ? "fill" : "fills"}<Info label="About incomplete fills">Records with only part of the package filled. These stay visible in the record and have no full-answer valuation, including after settlement. Check the individual options on Derive.</Info></span>}
            {summary.count > 0 && (
              <span className="q-realized-sum">Realized <b className={`mono ${tone(summary.total)}`}>{signed(summary.total)}</b>
                <small>{summary.count} {summary.count === 1 ? "result" : "results"}: {summary.closes} sold back, {summary.settles} settled</small>
                <Info label="About realized">The results of positions sold back or settled, after Derive's fees, from what you entered and Derive's settlement prices. {summary.wins} ended above what was paid, {summary.losses} below.{summary.partialCloses ? ` ${summary.partialCloses} ${summary.partialCloses === 1 ? "is a part" : "are parts"} of positions still open.` : ""}{summary.estimated ? ` ${summary.estimated} ${summary.estimated === 1 ? "uses" : "use"} estimated fees.` : ""}{summary.unknown ? ` ${summary.unknown} without a known result ${summary.unknown === 1 ? "is" : "are"} left out of the total.` : ""}</Info>
              </span>
            )}
          </p>
        )}
        <Tabs label="Positions" value={tab} onChange={setTab} items={[["open", "Open"], ["closed", "Closed"], ["following", "Following"]]} />
      </header>
      {NET === "mainnet" && toSettle.map((p) => <SettleWatch key={p.key} p={p} onSettle={(k, price) => setList(settlePosition(k, price))} />)}
      {TESTNET_FILLS && <Suspense fallback={null}><DeriveSync onScope={(s) => { setScope(s); setSync(null); }}
        onSynced={(r) => { setList(r.list); setSync(r); }} /></Suspense>}
      {tab === "following" ? <Suspense fallback={null}><Board followingOnly embedded /></Suspense> : <>
      {tab === "open" && <Exposure groups={groups} />}
      {tab === "open" && pendingReceipts.length > 0 && <p className="q-note">Derive's trade records are still being checked. These positions are left out of the combined settlement figures.</p>}
      {tab === "open" && unknownFeeEntries.length > 0 && <p className="q-note">Derive's entry fees are not available yet. These positions are left out of the combined settlement figures.</p>}
      {TESTNET_FILLS && tab === "open" && sync?.extra && <Suspense fallback={null}><AlsoOnDerive extra={sync.extra} /></Suspense>}
      {rows.length ? rows.map((p) => <Card key={p.key} p={p} scope={scope} sync={sync?.statuses?.[p.key] ?? null} onRemove={(k) => setList(removePosition(k, NET))}
        onClose={(k, got) => setList(closePosition(k, got, Date.now() / 1000, NET))} />)
        : list.length ? (
          <section className="q-empty-card q-empty-tab" aria-label={tab === "open" ? "Nothing open" : "Nothing closed"}>
            <h2>{tab === "open" ? "Nothing open right now" : "Nothing closed yet"}</h2>
            <p>{tab === "open" ? "Your open trades show here with their cost, value now and settlement." : "Trades you sell back or that settle show here with their result."}</p>
            <Link className="btn" to="/saloon">Browse the Saloon</Link>
          </section>
        ) : (
          <section className="q-empty-card" aria-label="No positions yet">
            <h2>No positions yet</h2>
            <p>Your trades, costs and settlement dates, in one place. Choose an outcome in the Saloon, place its orders on Derive, then record what filled.</p>
            <Link className="btn primary lg" to="/saloon">Open the Saloon</Link>
          </section>
        )}
      </>}
      {tab !== "following" && <details className="q-saved">
        <summary>Saved in this browser<Info label="Where these are kept">Saved from "I placed it", in this browser only. Nothing is sent anywhere, and clearing the browser's data removes them: export a copy to keep one. The export keeps closed trades, entry records and partial fills; importing a file twice adds nothing.</Info></summary>
        <div className="q-card-actions">
          <button className="text-control" onClick={download} disabled={!list.length}>Export</button>
          <button className="text-control" onClick={() => file.current?.click()}>Import</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={upload} aria-label="Import a saved file" />
        </div>
        {importError && <p className="q-note warn" role="alert">{importError}</p>}
        {other > 0 && <p className="q-note">{other} {NET === "testnet" ? "mainnet" : "testnet"} {other === 1 ? "record is" : "records are"} kept apart from these and included in Export.</p>}
      </details>}
    </div>
  );
}
