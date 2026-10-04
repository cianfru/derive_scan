import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { Info, Tabs } from "../components/ui.jsx";
import PayZone from "../components/PayZone.jsx";
import QuestionTicket from "../components/QuestionTicket.jsx";
import {
  ANSWER, cents, closeTicket, countdown, dayLabel, findLevel, fullPay, money, noPriceReason, parseId, priceAge, questionText, signed,
} from "../lib/questions.js";
import {
  closePosition, exportPositions, importPositions, loadPositions, partial, positionFigures, positionStatus, prune, removePosition,
} from "../lib/positions.js";
import "../questions.css";

const usd = (v) => money(v, { cents: true });

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

function Card({ p, onRemove, onClose }) {
  const q = parseId(p.id);
  const { data: board } = useData(q ? `questions/${q.und}.json` : null);
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
  const t = found && !found.settled && !paused && !settling && !half && !p.closed_at
    ? closeTicket(found.level, p.side, p.contracts, board, p.legs) : null;
  const f = positionFigures(p, { found: paused ? null : found, settlePrice: settle, close: t, index: board?.index });
  const status = positionStatus(p, { settled: f.settled, settling });
  const name = ANSWER[p.side];
  const question = q ? questionText(q.und, q, q.expiry) : p.question;
  const reason = !found || paused ? "Prices are paused or this question is no longer on the board, so Derive's sell-back price is not shown."
    : f.otherLegs ? "Cowboy now builds this answer from other options than the ones you hold, so it has no sell-back price for yours. Sell back on Derive at its screen price."
      : settling ? "This date is settling: Derive averages the index from 07:30 to 08:00 UTC, and selling back has stopped."
        : noPriceReason(found.level, p.side, false);
  const partWhy = "Cowboy prices the full answer only. With one option filled you hold that option alone; check it on Derive.";
  const usdOr = (v) => (v == null ? null : usd(v));
  const pl = (v) => (v == null ? null : <span className={tone(v)}>{signed(v)}</span>);
  const na = (why, label) => <Missing text="Not available yet" label={label} why={why} />;
  const noPrice = <Missing text="No price now" label="Why no price" why={reason} />;
  return (
    <article className={`q-card q-card-${status.key}`}>
      <header>
        <Link to={`/q/${p.id}?side=${p.side}`} className="q-card-title">{question}</Link>
        <span className="q-card-side">{name}{q && <> · {fullPay(q, p.side)}</>}</span>
      </header>
      <p className={`q-card-status${status.warn ? " warn" : ""}`}>
        {status.key === "settled" ? <>Settled at {money(settle)} · got {usd(f.got)}</> : status.text}
        <Info label="How this was placed">{half
          ? "You told Cowboy only the first of the two orders filled. You hold one option alone, which pays differently from the answer and can lose all it cost. Finish or undo it on Derive; Cowboy shows no value for it."
          : "You placed the orders on Derive yourself and told Cowboy what you paid. Cowboy cannot see your Derive account, so these figures are only as good as what you entered."}</Info>
      </p>
      <dl className="q-figs grid">
        <Fig label="You paid" sub="fees included" value={usd(p.paid)} />
        {f.closed ? (
          <>
            <Fig label="Got back" sub="after fees" value={usd(f.got)} />
            <Fig label="Profit / loss" value={pl(f.pl)} className="q-pl" />
          </>
        ) : f.settled ? (
          <>
            <Fig label="Got" sub={`${cents(Math.round(f.per * 100))} per $1`} value={usd(f.got)} />
            <Fig label="Profit / loss" value={pl(f.pl)} className="q-pl" />
          </>
        ) : (
          <>
            <Fig label="Most it pays" sub={q ? fullPay(q, p.side) : null} value={usdOr(f.maxPayout)} missing={na(partWhy, "Why no payout")} />
            <Fig label="Value now" sub="sell-back, after fees"
              info={f.mark != null && f.valueNow != null && <Info label="At Derive's mark">At Derive's mark: {usd(f.mark)}. Value now is Derive's sell-back price on its screen minus Derive's fees to sell back, about {usd(f.fees)}.</Info>}
              value={usdOr(f.valueNow)} missing={half ? na(partWhy, "Why no value") : noPrice} />
            <Fig label="Profit / loss now" sub="if sold back now" value={pl(f.plNow)} className="q-pl"
              missing={half ? na("With only one option filled there is no result for the answer.", "Why no result") : na("There is a result once Derive shows a sell-back price, or at settlement.", "Why no result")} />
            <Fig label="At 08:00 UTC, today's price" sub={f.expiryNow != null ? `pays ${usd(f.expiryNow)}` : null} value={pl(f.plExpiryNow)}
              info={<Info label="About the payout at today's price">What the answer pays if {q?.und} settles at today's price, {money(board?.index)}, and the profit or loss after what you paid. Not a view of where it settles.</Info>}
              missing={na(half ? partWhy : "Cowboy needs today's price from the board to show this.", "Why no payout at today's price")} />
          </>
        )}
        <Fig label={f.closed ? "Sold back" : f.settled ? "Settled" : "Settles"}
          value={f.closed ? new Date(p.closed_at * 1000).toISOString().slice(0, 10) : q ? `${dayLabel(q.expiry)}, 08:00 UTC` : null}
          sub={!f.closed && !f.settled && !settling ? countdown(settleTs, now) : settling && !f.settled ? "settling now" : null} missing={na("No date saved.", "Why no date")} />
      </dl>
      {q && !half && <PayZone lo={q.lo} hi={q.hi} side={p.side} index={settle ?? board?.index} compact />}
      <div className="q-card-actions">
        {t && <button className="btn" onClick={() => setClosing((s) => !s)} aria-expanded={closing}>{closing ? "Keep it open" : "Close"}</button>}
        <button className="text-control" onClick={() => onRemove(p.key)}>Remove</button>
      </div>
      {closing && t && (
        <QuestionTicket und={q.und} question={question} answer={name} level={found.level} sideKey={p.side} t={t} board={board}
          pricesTs={board.prices_ts} settleTs={settleTs} stale={priceAge(board.prices_ts, now).state === "stale"} closing
          paid={p.paid} holdPayout={f.expiryNow}
          onSold={(got) => { setClosing(false); onClose(p.key, got); }} />
      )}
    </article>
  );
}

/** Positions: kept in this browser only, with export and import under "Saved in this browser". */
export default function MyQuestions() {
  const [list, setList] = useState(() => prune(loadPositions()));
  const [tab, setTab] = useState("open");
  const file = useRef(null);
  const now = Date.now() / 1000;
  const settleOf = (p) => p.settle_ts || 0;
  const done = (p) => !!p.closed_at || now >= settleOf(p);
  const rows = useMemo(() => list.filter((p) => (tab === "open" ? !done(p) : done(p)))
    .sort((a, b) => settleOf(a) - settleOf(b)), [list, tab, now]);
  const download = () => {
    const a = document.createElement("a");
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(exportPositions())}`;
    a.download = "cowboy-questions.json";
    a.click();
  };
  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { setList(importPositions(await f.text())); } catch { /* not a positions file */ }
  };
  return (
    <div className="wrap page q-page q-mine">
      <header className="q-head">
        <div className="q-head-top">
          <h1>Positions</h1>
          <Link to="/saloon" className="text-link">Back to the Saloon</Link>
        </div>
        <Tabs label="Positions" value={tab} onChange={setTab} items={[["open", "Open"], ["closed", "Closed"]]} />
      </header>
      {rows.length ? rows.map((p) => <Card key={p.key} p={p} onRemove={(k) => setList(removePosition(k))} onClose={(k, got) => setList(closePosition(k, got))} />)
        : list.length ? <p className="status">Nothing {tab === "open" ? "open" : "closed"} yet.</p> : (
          <section className="q-empty-card" aria-label="No positions yet">
            <h2>No positions yet</h2>
            <p>Pick higher or lower on a coin in the Saloon, place it on Derive, then tell Cowboy what filled. It shows here with what you paid, what it is worth and when it settles.</p>
            <Link className="btn primary lg" to="/saloon">Open the Saloon</Link>
          </section>
        )}
      <details className="q-saved">
        <summary>Saved in this browser<Info label="Where these are kept">Saved from "I placed it", in this browser only. Nothing is sent anywhere, and clearing the browser's data removes them: export a copy to keep one.</Info></summary>
        <div className="q-card-actions">
          <button className="text-control" onClick={download} disabled={!list.length}>Export</button>
          <button className="text-control" onClick={() => file.current?.click()}>Import</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={upload} aria-label="Import a saved file" />
        </div>
      </details>
    </div>
  );
}
