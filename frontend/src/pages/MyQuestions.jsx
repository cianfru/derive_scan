import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { Info, Tabs } from "../components/ui.jsx";
import PayZone from "../components/PayZone.jsx";
import QuestionTicket from "../components/QuestionTicket.jsx";
import {
  ANSWER, cents, closeTicket, countdown, dayLabel, findLevel, fullPay, money, noPriceReason, parseId, priceAge, questionText,
} from "../lib/questions.js";
import {
  closePosition, exportPositions, importPositions, loadPositions, partial, prune, removePosition, valuePosition,
} from "../lib/positions.js";
import "../questions.css";

const usd = (v) => money(v, { cents: true });

/** A value Cowboy cannot show, in words, with the reason in an (i). */
function Missing({ text, why, label }) {
  return <span className="q-noprice">{text}<Info label={label}>{why}</Info></span>;
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
  const [selling, setSelling] = useState(false);
  const paused = board ? priceAge(board.prices_ts, now, board.paused).state === "paused" : true;
  const settling = !after && now >= settleTs - 1800 || (after && settle == null);
  const half = partial(p);
  const t = found && !found.settled && !paused && !settling && !half && !p.closed_at
    ? closeTicket(found.level, p.side, p.contracts, board, p.legs) : null;
  const v = valuePosition(p, found, settle, t ? t.fees : null);
  const pl = v.partial ? null : v.settled ? v.got - p.paid : v.now != null && !paused ? v.now - p.paid : null;
  const name = ANSWER[p.side];
  const question = q ? questionText(q.und, q, q.expiry) : p.question;
  const reason = !found || paused ? "Prices are paused or this question is no longer on the board, so Derive's sell-back price is not shown."
    : v.otherLegs ? "Cowboy now builds this answer from other options than the ones you hold, so it has no sell-back price for yours. Sell back on Derive at its screen price."
      : noPriceReason(found.level, p.side, false);
  return (
    <article className="q-card">
      <header>
        <Link to={`/q/${p.id}?side=${p.side}`} className="q-card-title">{question}</Link>
        <span className="q-card-side">{name}{q && <> · {fullPay(q, p.side)}</>}</span>
      </header>
      <p className={`q-card-status${half ? " warn" : ""}`}>
        {p.closed_at ? "Sold back by hand" : half ? "Only the first option filled: this is not the full answer" : "Placed by hand · Cowboy cannot see your fills"}
        <Info label="How this was placed">{half
          ? "You told Cowboy only the first of the two orders filled. You hold one option alone, which pays differently from the answer and can lose all it cost. Finish or undo it on Derive; Cowboy shows no value for it."
          : "You placed the orders on Derive yourself and told Cowboy what you paid. Cowboy cannot see your Derive account, so these figures are only as good as what you entered."}</Info>
      </p>
      <dl className="q-figs row">
        <div><dt>Paid</dt><dd className="mono">{usd(p.paid)}</dd></div>
        {v.settled && !v.partial ? (
          <div><dt>{v.closed ? "Got back" : "Got"}</dt><dd className="mono">{usd(v.got)}{!v.closed && <small> ({cents(Math.round(v.per * 100))} per $1)</small>}</dd></div>
        ) : (
          <div><dt>Now worth{v.mark != null && <Info label="At Derive's mark">At Derive's mark: {usd(v.mark)}. Now worth is Derive's sell-back price on its screen minus Derive's fees to sell back, about {usd(v.fees)}.</Info>}</dt>
            <dd className="mono">{v.now != null && !paused ? usd(v.now)
              : v.partial ? <Missing text="Not available yet" label="Why no value" why="Cowboy prices the full answer only. Check the option you hold on Derive." />
                : <Missing text="No price now" label="Why no price" why={reason} />}</dd></div>
        )}
        <div><dt>Result</dt><dd className={`mono ${pl > 0 ? "up" : pl < 0 ? "down" : ""}`}>{pl != null ? `${pl >= 0 ? "+" : "-"}${usd(Math.abs(pl))}`
          : <Missing text="Not available yet" label="Why no result" why={v.partial ? "With only one option filled there is no result for the answer." : "There is a result once Derive shows a sell-back price, or at settlement."} />}</dd></div>
      </dl>
      {q && !v.partial && <PayZone lo={q.lo} hi={q.hi} side={p.side} index={settle ?? board?.index} compact />}
      <p className="q-card-meta">
        {p.closed_at ? `Sold back on ${new Date(p.closed_at * 1000).toISOString().slice(0, 10)}`
          : v.settled ? `Settled ${money(settle)} on ${dayLabel(q.expiry)}`
          : settling ? "Settling · average from 07:30 to 08:00 UTC"
          : <>Settles {dayLabel(q.expiry)}, 08:00 UTC · {countdown(settleTs, now)}</>}
      </p>
      <div className="q-card-actions">
        {t && <button className="text-control" onClick={() => setSelling((s) => !s)} aria-pressed={selling}>Sell back</button>}
        <button className="text-control" onClick={() => onRemove(p.key)}>Remove</button>
      </div>
      {selling && t && (
        <QuestionTicket und={q.und} question={question} answer={name} level={found.level} sideKey={p.side} t={t} board={board}
          pricesTs={board.prices_ts} settleTs={settleTs} stale={priceAge(board.prices_ts, now).state === "stale"} closing
          onSold={(got) => { setSelling(false); onClose(p.key, got); }} />
      )}
    </article>
  );
}

/** Positions: kept in this browser only, with export and import. */
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
          <h1>Positions<Info label="Where these are kept">Saved from "I placed it", in this browser only. Nothing is sent anywhere, and clearing the browser's data removes them: export a copy to keep one.</Info></h1>
          <Link to="/saloon" className="text-link">Back to the Saloon</Link>
        </div>
        <Tabs label="Positions" value={tab} onChange={setTab} items={[["open", "Open"], ["closed", "Closed"]]} />
      </header>
      {rows.length ? rows.map((p) => <Card key={p.key} p={p} onRemove={(k) => setList(removePosition(k))} onClose={(k, got) => setList(closePosition(k, got))} />)
        : <p className="status">Nothing here yet. <Link className="text-link" to="/saloon">Visit the Saloon</Link></p>}
      <div className="q-card-actions">
        <button className="text-control" onClick={download} disabled={!list.length}>Export</button>
        <button className="text-control" onClick={() => file.current?.click()}>Import</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={upload} aria-label="Import a saved file" />
      </div>
    </div>
  );
}
