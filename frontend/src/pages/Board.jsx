import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { useFeeds } from "../components/Feeds.jsx";
import { Info, Loading, Failed, Tabs } from "../components/ui.jsx";
import { Asset } from "../components/MarketVisuals.jsx";
import { ChainMini } from "../components/Chain.jsx";
import SaloonHead from "../components/SaloonNotices.jsx";
import { FollowButton, FollowLevel } from "../components/Follow.jsx";
import { DEFAULT_SORT, RANGES, SIDES, SORTS, boardRows, cleanBudget, contextHorizon, filterRows, sortRows } from "../lib/board.js";
import { exportFollows, importFollows, saveBudget, unfollow, useFollowsDoc } from "../lib/follows.js";
import { ANSWER, countdown, dayLabel, fullPay, money, priceAge, signed } from "../lib/questions.js";
import "../questions.css";
import "../board.css";

const PAGE = 24;
const usd = (v) => money(v, { cents: true });
const perText = (v, plus = true) => `${v < 0 ? "-" : plus ? "+" : ""}${Math.abs(v * 100).toFixed(1)}c`;
const clock = (t) => `${new Date(t * 1000).toISOString().slice(11, 16)} UTC`;

function Budget({ value }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => setText(String(saveBudget(text)));
  return (
    <div className="bd-budget">
      <label htmlFor="bd-budget" className="label">Budget
        <Info label="About the budget">This is the total you spend, Derive's fees included: Cowboy sizes each answer so its price plus fees fit it. Every row shows what it buys. It is kept in this browser and is the first amount in the guided flow too.</Info>
      </label>
      <span className="q-dollar-field"><span>$</span>
        <input id="bd-budget" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ""))}
          onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } }} />
      </span>
      <span className="q-quick">{[25, 100, 500].map((v) => (
        <button key={v} className="text-control" aria-pressed={value === v} onClick={() => saveBudget(v)}>${v}</button>))}</span>
    </div>
  );
}

const HEAD = [
  ["Outcome"], ["Settles"],
  ["You pay", "What your budget pays for this answer, Derive's fees included. It is the most you can lose."],
  ["Fees", "Derive's fees inside what you pay, about: $0.50 per option plus a small share per contract. They weigh more on small amounts."],
  ["Most it pays", "The total back at settlement when the coin settles in the answer's full-pay range."],
  ["Most you can make", "Most it pays minus what you pay."],
  ["Pays in part", "Inside this range the answer pays part of the $1, in a straight line."],
  ["Cost over mark", "What you pay per $1 of payout, before fees, minus Derive's mark for the same answer per $1, from the same read as the prices. The lower, the closer to the mark. Fees are shown apart."],
  ["Exit cost now", "Derive's mark minus what selling back now would get per $1, before Derive's exit fees: what leaving straight away costs against the mark."],
  ["Size", "Up to this much payout is on Derive's screen at this price. A larger amount costs more."],
  ["Context", "Cowboy's three layers for the coin (regime, wallets, options) over the next 7 days for dates within 10 days, else 30 days. They describe the market and never change the order of this list."],
  [""],
];

function NotYet({ label, why }) {
  return <span className="q-noprice bd-notyet">Not available yet<Info label={label}>{why}</Info></span>;
}

function Row({ r, align, budget }) {
  const h = contextHorizon(r.settleTs);
  const name = `${r.und} ${ANSWER[r.side]} than ${money(r.k)} on ${dayLabel(r.expiry)}`;
  return (
    <li className="bd-row">
      <div className="bd-cell bd-outcome">
        <Asset und={r.und} compact />
        <span className="bd-title">
          <Link to={`/q/${r.id}?side=${r.side}`} state={{ step: "preview", dollars: budget }} className="bd-link" aria-label={`${name}: see what it pays`}>
            <i className={`q-arrow ${r.side}`} aria-hidden="true" />{ANSWER[r.side]} · <span className="mono">{money(r.k)}</span>
          </Link>
          <small>{fullPay(r.level, r.side)}{r.thin && <span className="bd-thin"> · Thin book</span>}</small>
        </span>
      </div>
      <dl className="bd-figs">
        <div className="bd-cell bd-settle"><dt>Settles</dt><dd>{dayLabel(r.expiry)}<small> 08:00 UTC · {countdown(r.settleTs)}</small></dd></div>
        <div className="bd-cell bd-pay"><dt>You pay</dt><dd className="mono">{usd(r.total)}{r.capped && <small>all the size here</small>}</dd></div>
        <div className="bd-cell"><dt>Fees</dt><dd className="mono">{usd(r.fees)}</dd></div>
        <div className="bd-cell"><dt>Most it pays</dt><dd className="mono">{usd(r.payout)}</dd></div>
        <div className="bd-cell"><dt>Most you can make</dt><dd className={`mono ${r.make > 0 ? "up" : ""}`}>{r.make > 0 ? signed(r.make) : "None"}</dd></div>
        <div className="bd-cell bd-zone"><dt>Pays in part</dt><dd className="mono">{money(r.lo)}–<wbr />{money(r.hi)}</dd></div>
        <div className="bd-cell bd-over"><dt>Cost over mark</dt><dd className="mono">{r.overMark != null
          ? <span title={`Mark ${perText(r.markPer, false)} per $1 at ${clock(r.markTs)}`}>{perText(r.overMark)}</span>
          : <NotYet label={`Why cost over mark is not available for ${r.und} ${ANSWER[r.side]} at ${money(r.k)}`} why={r.markReason} />}</dd></div>
        <div className="bd-cell"><dt>Exit cost now</dt><dd className="mono">{r.exitCost != null ? perText(r.exitCost)
          : <NotYet label={`Why exit cost is not available for ${r.und} ${ANSWER[r.side]} at ${money(r.k)}`}
            why={r.markReason || "Derive's screen has no sell-back price for this answer right now."} />}</dd></div>
        <div className="bd-cell"><dt>Size</dt><dd className="mono">{r.size != null ? money(r.size) : "—"}</dd></div>
        <div className="bd-cell bd-ctx"><dt>Context</dt><dd>{align ? <ChainMini alignment={align} horizon={h} /> : <span className="dim">Unavailable</span>}</dd></div>
      </dl>
      <div className="bd-cell bd-follow"><FollowButton id={r.id} side={r.side} k={r.k} board={r.board} compact /></div>
    </li>
  );
}

function NoPriceList({ list }) {
  if (!list.length) return null;
  return (
    <details className="bd-noprice">
      <summary>No price now <span className="mono dim">{list.length}</span></summary>
      <ul>
        {list.map((r) => (
          <li key={r.key}>
            <span>{r.und} {ANSWER[r.side]} · <span className="mono">{money(r.k)}</span> · {r.label}</span>
            <span className="q-noprice">No price now<Info label={`Why ${r.und} ${ANSWER[r.side]} at ${money(r.k)} has no price`}>{r.reason}</Info></span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Following() {
  const doc = useFollowsDoc();
  const file = useRef(null);
  const [msg, setMsg] = useState("");
  const download = () => {
    const a = document.createElement("a");
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(exportFollows())}`;
    a.download = "cowboy-follows.json";
    a.click();
  };
  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { importFollows(await f.text()); setMsg("Imported."); } catch { setMsg("That file could not be read."); }
    e.target.value = "";
  };
  const list = [...doc.follows].sort((a, b) => a.settle_ts - b.settle_ts);
  return (
    <details className="bd-following" open={list.length > 0 && list.length <= 6 ? true : undefined}>
      <summary>Following <span className="mono dim">{list.length}</span>
        <Info label="About following">Follow an answer to see notices here when you come back: its cost reaches your level, a price is back, it settles within 6 hours or has settled, or a research reading on the coin changed. Kept in this browser only; export a copy to keep one.</Info>
      </summary>
      {list.length ? (
        <ul>
          {list.map((f) => (
            <li key={`${f.id}:${f.side}`}>
              <Link to={`/q/${f.id}?side=${f.side}`} state={{ step: "preview" }}>{f.und} {ANSWER[f.side]} · <span className="mono">{money(f.k)}</span> · {dayLabel(f.expiry)}</Link>
              <FollowLevel id={f.id} side={f.side} />
              <button className="text-control" onClick={() => unfollow(f.id, f.side)}>Stop following</button>
            </li>
          ))}
        </ul>
      ) : <p className="status">Nothing followed yet.</p>}
      <div className="q-card-actions">
        <button className="text-control" onClick={download} disabled={!list.length}>Export</button>
        <button className="text-control" onClick={() => file.current?.click()}>Import</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={upload} aria-label="Import a follows file" />
        {msg && <span className="status" role="status">{msg}</span>}
      </div>
    </details>
  );
}

/** Browse: every live answer across coins and dates, priced for the user's budget, in the order the
 * user picks. Ordered by facts about the price only; the three layers sit on each row as context. */
export default function Board() {
  const { data: index, error } = useData("questions/index.json");
  const { data: markets } = useData("markets.json");
  const doc = useFollowsDoc();
  const budget = cleanBudget(doc.budget);
  const coins = (index?.coins || []).map((c) => c.und);
  const [feeds, files, ready] = useFeeds(coins.map((u) => `questions/${u}.json`));
  const [coin, setCoin] = useState("all");
  const [range, setRange] = useState("all");
  const [side, setSide] = useState("all");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [shown, setShown] = useState(PAGE);
  const now = Date.now() / 1000;
  const boards = coins.map((u) => files[`questions/${u}.json`]).filter(Boolean);
  const age = priceAge(index?.prices_ts, now, index?.paused);
  const paused = age.state === "paused";
  const { rows, noPrice } = useMemo(() => {
    const out = boardRows(boards, budget, { now, paused });
    const byUnd = Object.fromEntries(boards.map((b) => [b.und, b]));
    for (const r of out.rows) r.board = byUnd[r.und];
    return out;
  }, [boards.map((b) => `${b.und}:${b.prices_ts}`).join(","), budget, paused]);
  const filters = { coin, range, side };
  const list = sortRows(filterRows(rows, filters, now), sort);
  const off = filterRows(noPrice, filters, now);
  const alignOf = Object.fromEntries((markets?.coins || []).map((c) => [c.und, c.align]));
  useEffect(() => { setShown(PAGE); }, [coin, range, side, sort, budget]);

  if (error && !index) return <div className="wrap page"><Failed error={error} /></div>;
  return (
    <div className="wrap page q-page bd-page">
      <SaloonHead view="browse" />
      {feeds}
      <section className="bd-controls" aria-label="Budget, filters and order">
        <Budget value={budget} />
        <div className="bd-filters">
          <Tabs label="Coin" value={coin} onChange={setCoin} items={[["all", "All coins"], ...coins.map((u) => [u, u])]} />
          <div className="bd-selects">
            <label className="bd-select"><span className="label">Dates</span>
              <select value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
            <label className="bd-select"><span className="label">Answer</span>
              <select value={side} onChange={(e) => setSide(e.target.value)}>{SIDES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
            <label className="bd-select"><span className="label">Order</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          </div>
        </div>
      </section>
      <Following />
      {!index || !ready ? <Loading /> : (
        <>
          <p className="bd-count status">
            <span className="mono">{list.length}</span> {list.length === 1 ? "answer" : "answers"} for <span className="mono">{usd(budget)}</span>
            {paused ? " · prices paused" : index?.prices_ts ? <> · prices {new Date(index.prices_ts * 1000).toISOString().slice(11, 16)} UTC</> : null}
            <Info label="About this list">Every answer with a price on Derive's screen now, across coins and dates. The order is yours: by cost over Derive's mark per $1 before fees (rows where it is not available yet go last), closeness of the level to the coin's price, settlement date or size. Answers that fail Cowboy's checks are left out; those on the board with no price now are listed below with the reason.</Info>
          </p>
          {list.length ? (
            <div className="bd-table" role="region" aria-label="Outcomes">
              <div className="bd-head">
                {HEAD.map(([t, help]) => <span key={t || "f"} className="bd-cell">{t}{help && <Info label={`About ${t}`}>{help}</Info>}</span>)}
              </div>
              <ol className="bd-list">
                {list.slice(0, shown).map((r) => <Row key={r.key} r={r} align={alignOf[r.und]} budget={budget} />)}
              </ol>
              {list.length > shown && <button className="text-control bd-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
            </div>
          ) : <p className="status">No answers with a price match these filters.</p>}
          <NoPriceList list={off} />
        </>
      )}
    </div>
  );
}
