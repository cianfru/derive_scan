import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { Info, Tabs } from "../components/ui.jsx";
import PayZone from "../components/PayZone.jsx";
import QuestionTicket from "../components/QuestionTicket.jsx";
import { cents, closeTicket, countdown, dayLabel, findLevel, money, parseId, priceAge } from "../lib/questions.js";
import { exportPositions, importPositions, loadPositions, prune, removePosition, valuePosition } from "../lib/positions.js";
import "../questions.css";

function Card({ p, onRemove }) {
  const q = parseId(p.id);
  const { data: board } = useData(q ? `questions/${q.und}.json` : null);
  const found = board ? findLevel(board, p.id) : null;
  const now = Date.now() / 1000;
  const settleTs = p.settle_ts || (q ? Date.UTC(+q.expiry.slice(0, 4), +q.expiry.slice(4, 6) - 1, +q.expiry.slice(6, 8), 8) / 1000 : 0);
  const after = now >= settleTs;
  const priceFromBoard = found?.settled ? found.date.settle_price : null;
  const { data: hist } = useData(after && priceFromBoard == null && q ? `questions/history/${q.und}-${q.expiry}.json` : null, 30 * 60_000);
  const settle = priceFromBoard ?? hist?.settle_price ?? null;
  const v = valuePosition(p, found, settle);
  const [selling, setSelling] = useState(false);
  const paused = board ? priceAge(board.prices_ts, now, board.paused).state === "paused" : true;
  const settling = !after && now >= settleTs - 1800 || (after && settle == null);
  const pl = v.settled ? v.got - p.paid : v.now != null ? v.now - p.paid : null;
  const t = found && !found.settled && !paused && !settling ? closeTicket(found.level, p.side, p.contracts, board) : null;
  return (
    <article className="q-card">
      <header>
        <Link to={`/q/${p.id}?side=${p.side}`} className="q-card-title">{p.question}</Link>
        <span className="q-card-side">{p.answer}</span>
      </header>
      <dl className="q-figs row">
        <div><dt>Paid</dt><dd className="mono">{money(p.paid, { cents: true })}</dd></div>
        {v.settled ? (
          <div><dt>Got</dt><dd className="mono">{money(v.got, { cents: true })} <small>({cents(Math.round(v.per * 100))} per $1)</small></dd></div>
        ) : (
          <div><dt>Now worth{v.mark != null && <Info label="At Derive's mark">At Derive's mark: {money(v.mark, { cents: true })}. Now worth uses the sell-back price on Derive's screen.</Info>}</dt>
            <dd className="mono">{v.now != null && !paused ? money(v.now, { cents: true }) : "—"}</dd></div>
        )}
        <div><dt>Result</dt><dd className={`mono ${pl > 0 ? "up" : pl < 0 ? "down" : ""}`}>{pl == null || (!v.settled && paused) ? "—" : `${pl >= 0 ? "+" : "-"}${money(Math.abs(pl), { cents: true })}`}</dd></div>
      </dl>
      {q && <PayZone lo={q.lo} hi={q.hi} side={p.side} index={settle ?? board?.index} compact />}
      <p className="q-card-meta">
        {v.settled ? `Settled ${money(settle)} on ${dayLabel(q.expiry)}`
          : settling ? "Settling · average from 07:30 to 08:00 UTC"
          : <>Settles {dayLabel(q.expiry)}, 08:00 UTC · {countdown(settleTs, now)}</>}
        {!v.settled && !settling && v.now == null && <> · No sell-back price now. It settles by itself.</>}
      </p>
      <div className="q-card-actions">
        {t && <button className="text-control" onClick={() => setSelling((s) => !s)} aria-pressed={selling}>Sell back</button>}
        <button className="text-control" onClick={() => onRemove(p.key)}>Remove</button>
      </div>
      {selling && t && (
        <QuestionTicket und={q.und} question={p.question} answer={p.answer} level={found.level} sideKey={p.side} t={t} board={board}
          pricesTs={board.prices_ts} settleTs={settleTs} stale={priceAge(board.prices_ts, now).state === "stale"} closing />
      )}
    </article>
  );
}

/** My questions: kept in this browser only, with export and import. */
export default function MyQuestions() {
  const [list, setList] = useState(() => prune(loadPositions()));
  const [tab, setTab] = useState("open");
  const file = useRef(null);
  const now = Date.now() / 1000;
  const settleOf = (p) => p.settle_ts || 0;
  const rows = useMemo(() => list.filter((p) => (tab === "open" ? now < settleOf(p) : now >= settleOf(p)))
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
    try { setList(importPositions(await f.text())); } catch { /* not a questions file */ }
  };
  return (
    <div className="wrap page q-page q-mine">
      <header className="q-head">
        <div className="q-head-top">
          <h1>My seat<Info label="Where these are kept">Saved from "I placed it", in this browser only. Nothing is sent anywhere, and clearing the browser's data removes them: export a copy to keep one.</Info></h1>
          <Link to="/saloon" className="text-link">Back to the Saloon</Link>
        </div>
        <Tabs label="Positions" value={tab} onChange={setTab} items={[["open", "Open"], ["settled", "Settled"]]} />
      </header>
      {rows.length ? rows.map((p) => <Card key={p.key} p={p} onRemove={(k) => setList(removePosition(k))} />)
        : <p className="status">Nothing here yet. <Link className="text-link" to="/saloon">Visit the Saloon</Link></p>}
      <div className="q-card-actions">
        <button className="text-control" onClick={download} disabled={!list.length}>Export</button>
        <button className="text-control" onClick={() => file.current?.click()}>Import</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={upload} aria-label="Import a saved file" />
      </div>
    </div>
  );
}
