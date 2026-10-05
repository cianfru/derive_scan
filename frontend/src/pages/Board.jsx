import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data.js";
import { useFeeds } from "../components/Feeds.jsx";
import { Info, Loading, Failed, Tabs } from "../components/ui.jsx";
import { Asset, CoinIcon } from "../components/MarketVisuals.jsx";
import { ChainMini } from "../components/Chain.jsx";
import { ASSET_NAMES } from "../lib/presentation.js";
import SaloonHead from "../components/SaloonNotices.jsx";
import { FollowButton, FollowLevel } from "../components/Follow.jsx";
import { DEFAULT_SORT, RANGES, SIDES, SORTS, boardRows, cleanBudget, contextHorizon, dateRows, filterRows, sortRows } from "../lib/board.js";
import { exportFollows, importFollows, saveBudget, unfollow, useFollowsDoc } from "../lib/follows.js";
import { TESTNET_FILLS } from "../lib/flags.js";
import { NOT_ON_TESTNET, NOT_ON_TESTNET_WHY, missingLegs, useTestnetListing } from "../lib/testnetLevels.js";
import { ANSWER, countdown, dayLabel, fullPay, money, noPriceReason, priceAge, signed } from "../lib/questions.js";
import "../questions.css";
import "../board.css";

const PAGE = 24;
const usd = (v) => money(v, { cents: true });
const perText = (v, plus = true) => `${v < 0 ? "-" : plus ? "+" : ""}${Math.abs(v * 100).toFixed(1)}c`;
const clock = (t) => `${new Date(t * 1000).toISOString().slice(11, 16)} UTC`;

const PRESETS = [25, 100, 500];

/** One budget control: three amounts, or Other for any amount. */
function Budget({ value }) {
  const custom = !PRESETS.includes(value);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => { setText(String(saveBudget(text))); setEditing(false); };
  return (
    <div className="bd-budget">
      <span className="label" id="bd-budget-label">Budget
        <Info label="About the budget">This is the total you spend, Derive's fees included: Cowboy sizes each answer so its price plus fees fit it. Each answer shows the most you can make with it. It is kept in this browser and carries through when you open an outcome.</Info>
      </span>
      <span className="bd-presets" role="group" aria-labelledby="bd-budget-label">
        {PRESETS.map((v) => <button key={v} className="text-control bd-preset" aria-pressed={value === v} onClick={() => { saveBudget(v); setEditing(false); }}>${v}</button>)}
        {editing ? <span className="q-dollar-field"><span>$</span>
          <input id="bd-budget" aria-label="Other budget" inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ""))}
            onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
        </span>
          : <button className="text-control bd-preset" aria-pressed={custom} onClick={() => setEditing(true)}>{custom ? <span className="mono">${value}</span> : "Other"}</button>}
      </span>
    </div>
  );
}

function NotYet({ label, why }) {
  return <span className="q-noprice bd-notyet">Not available yet<Info label={label}>{why}</Info></span>;
}

/** One answer in a level's row: its price per $1 and the most the budget can make, the tile opens the
 * outcome at that answer; the bookmark beside it follows the answer. */
function AnswerChoice({ r, budget }) {
  const listed = useTestnetListing(TESTNET_FILLS && !r.reason ? r.und : null);
  const offTestnet = TESTNET_FILLS && missingLegs(r.id, r.side, listed).length > 0;
  const available = !r.reason && !offTestnet;
  const name = `${r.und} ${ANSWER[r.side]} than ${money(r.k)} on ${dayLabel(r.expiry)}`;
  const side = <span className="bd-choice-name"><i className={`q-arrow ${r.side}`} aria-hidden="true" />{ANSWER[r.side]}</span>;
  return (
    <div className={`bd-answer ${r.side}${available ? "" : " off"}`}>
      {offTestnet ? <div className="bd-choice off">{side}<span className="q-noprice">{NOT_ON_TESTNET}<Info label={`Why ${name} is not on testnet`}>{NOT_ON_TESTNET_WHY}</Info></span></div>
        : available ? <Link to={`/q/${r.id}?side=${r.side}`} state={{ step: "preview", dollars: budget }} className={`bd-choice ${r.side}`} aria-label={`${name}: see what it pays`}>
          <span className="bd-choice-side">{side}<b className="mono">{r.buyCents}<small>¢</small></b></span>
          <span className="bd-choice-out"><b className="mono">{r.make > 0 ? signed(r.make) : "None"}</b><small>most you make</small></span>
        </Link>
        : <div className="bd-choice off">{side}<span className="q-noprice">No price now<Info label={`Why ${name} has no price`}>{r.reason}</Info></span></div>}
      <FollowButton id={r.id} side={r.side} k={r.k} board={r.board} compact />
      {available && r.capped && <small className="bd-capped">Size at this price limits you to {usd(r.total)}</small>}
    </div>
  );
}

function Comparison({ r }) {
  if (r.reason) return null;
  return <div className="bd-comparison-side">
    <h4 className={r.side === "yes" ? "up" : "down"}>{ANSWER[r.side]}</h4>
    <dl className="bd-figs">
        <div><dt>You pay</dt><dd className="mono">{usd(r.total)}</dd></div>
        <div><dt>Most it pays</dt><dd className="mono">{usd(r.payout)}</dd></div>
        <div><dt>Full payout</dt><dd>{fullPay(r.level, r.side)}</dd></div>
        <div><dt>Derive fees included</dt><dd className="mono">{usd(r.fees)}</dd></div>
        <div><dt>Most you can make</dt><dd className="mono">{r.make > 0 ? signed(r.make) : "None"}</dd></div>
        <div className="bd-over"><dt>Cost over mark</dt><dd className="mono">{r.overMark != null
          ? <span title={`Mark ${perText(r.markPer, false)} per $1 at ${clock(r.markTs)}`}>{perText(r.overMark)}</span>
          : <NotYet label={`Why cost over mark is not available for ${r.und} ${ANSWER[r.side]} at ${money(r.k)}`} why={r.markReason} />}</dd></div>
        <div><dt>Exit cost now</dt><dd className="mono">{r.exitCost != null ? perText(r.exitCost)
          : <NotYet label={`Why exit cost is not available for ${r.und} ${ANSWER[r.side]} at ${money(r.k)}`}
            why={r.markReason || "Derive's screen has no sell-back price for this answer right now."} />}</dd></div>
        <div><dt>Payout size at this price</dt><dd className="mono">{r.size != null ? money(r.size) : "—"}</dd></div>
    </dl>
  </div>;
}

/** Grouping keeps the rank of the first matching answer in the user's existing order. */
function outcomeGroups(rows, unavailable, includeMissing = () => false) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.id)) groups.set(r.id, { ...r, answers: {} });
    groups.get(r.id).answers[r.side] = r;
  }
  for (const r of unavailable) if (groups.has(r.id)) groups.get(r.id).answers[r.side] = r;
  // The wider ladder may have only one priced answer; keep the other side visible without
  // manufacturing a quote. Explicit answer and Following filters still control what is shown.
  for (const group of groups.values()) for (const side of ["yes", "no"]) {
    if (!group.answers[side] && includeMissing(group.id, side)) {
      const base = Object.values(group.answers)[0];
      group.answers[side] = { ...base, side, key: `${base.id}:${side}`, reason: noPriceReason(base.level, side, !!base.board?.paused) };
    }
  }
  return [...groups.values()];
}

/** One level as a raised row: the level and its pays-in-part zone, then Higher and Lower side by side.
 * In the date rows (`inRow`) the row header carries the coin and the date, so the row leaves them out. */
function OutcomeCard({ outcome: r, align, budget, inRow = false }) {
  const [expanded, setExpanded] = useState(false);
  const answers = [r.answers.yes, r.answers.no].filter(Boolean);
  const Heading = inRow ? "h3" : "h2";
  return (
    <li className={`bd-card${inRow ? " in-row" : ""}${answers.length === 1 ? " single" : ""}`}>
      <div className="bd-level">
        {!inRow && <div className="bd-card-top"><Asset und={r.und} /><span className="bd-settle">{dayLabel(r.expiry)}<small>08:00 UTC · {countdown(r.settleTs)}</small></span></div>}
        <Heading className="bd-card-q"><Link className="bd-question" to={`/q/${r.id}`} state={{ dollars: budget }} aria-label={`${r.und} at ${money(r.k)} on ${dayLabel(r.expiry)}: view outcome`}>
          <span className="bd-q-text">Higher or lower than</span> <strong className="mono">{money(r.k)}</strong><span className="bd-q-text">?</span>
        </Link></Heading>
        <div className="bd-partial"><span>Pays in part</span><b className="mono">{money(r.lo)}–{money(r.hi)}</b><Info label={`About partial payout for ${r.und} at ${money(r.k)}`}>Between these prices, the spread pays part of its maximum, in a straight line. Higher reaches full payout at the upper price; Lower reaches full payout at the lower price. Opening an outcome shows the complete payout curve.</Info>{r.thin && <span className="bd-thin">Thin book</span>}</div>
      </div>
      {answers.map((a) => <AnswerChoice key={a.side} r={a} budget={budget} />)}
      <details className="bd-comparison" onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary aria-label={`Compare & research ${r.und} at ${money(r.k)}`}><span className="bd-more-text">Compare & research</span></summary>
        {expanded && <>
        <div className="bd-comparison-grid">{answers.map((a) => <Comparison key={a.side} r={a} />)}</div>
        <p className="bd-comparison-help">Cost over mark and exit cost are per $1 of maximum payout, before fees.<Info label={`About ${r.und} comparison at ${money(r.k)}`}>Cost over mark is the buy price minus Derive's mark from the same price read. Exit cost is that mark minus the published sell-back price. A missing or stale mark is not compared. Payout size is what Derive's screen offers at this price; a larger amount can cost more.</Info></p>
        <div className="bd-ctx"><span>Research context<Info label={`About ${r.und} research context`}>Regime, Wallets, Options, in that order. The daily regime is paired with {contextHorizon(r.settleTs) === "7d" ? "7-day" : "30-day"} wallet and options context. These independent readings do not change the order of the board.</Info></span>{align ? <ChainMini alignment={align} horizon={contextHorizon(r.settleTs)} /> : <span className="dim">Unavailable</span>}</div>
        </>}
      </details>
    </li>
  );
}

/** Where the coin's index sits within a row's ladder: a lit line across the ladder between two levels. */
function NowMark({ und, index }) {
  return <li className="bd-now" aria-label={`${money(index)}, the coin's index now, sits here`}><span className="bd-now-line" aria-hidden="true" /><span className="bd-now-text" aria-hidden="true">{und} now <b className="mono">{money(index)}</b></span><span className="bd-now-line end" aria-hidden="true" /></li>;
}

/** The key over a ladder: what each answer's two figures are. */
function LadderKey({ budget }) {
  return <div className="bd-key" aria-hidden="true"><span>Level</span><span>Price per $1 · most you make with <b className="mono">{usd(budget)}</b></span></div>;
}

/** One coin and settlement date: a header, then its levels from low to high with the index marked. */
function DateRow({ row, align, budget }) {
  const name = ASSET_NAMES[row.und] || row.und;
  const when = `${dayLabel(row.expiry)}, 08:00 UTC`;
  const n = row.items.length;
  const cards = row.items.map((g) => <OutcomeCard key={g.id} outcome={g} align={align} budget={budget} inRow />);
  if (row.nowAt != null) cards.splice(row.nowAt, 0, <NowMark key="now" und={row.und} index={row.index} />);
  return (
    <section className="bd-row" aria-label={`${name}, settles ${when}`}>
      <header className="bd-row-head">
        <h2><CoinIcon und={row.und} /><span className="bd-row-name">{name}</span><span className="bd-row-sep" aria-hidden="true">·</span><span className="bd-row-date">{when}</span>{countdown(row.settleTs) && <><span className="bd-row-sep" aria-hidden="true">·</span><span className="bd-row-in mono">{countdown(row.settleTs)}</span></>}</h2>
        <span className="bd-row-meta"><span className="bd-row-n">{n} {n === 1 ? "level" : "levels"}</span>{row.index != null && <span className="bd-row-index mono">now {money(row.index)}</span>}</span>
      </header>
      <LadderKey budget={budget} />
      <ol className="bd-row-cards" aria-label={`${name} levels on ${dayLabel(row.expiry)}, low to high`}>{cards}</ol>
    </section>
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
    <details className="bd-following">
      <summary>Saved answers & notices <span className="mono dim">{list.length}</span>
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
export default function Board({ followingOnly = false, embedded = false }) {
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
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const now = Date.now() / 1000;
  const boards = coins.map((u) => files[`questions/${u}.json`]).filter(Boolean);
  const age = priceAge(index?.prices_ts, now, index?.paused);
  const paused = age.state === "paused";
  const { rows, noPrice } = useMemo(() => {
    const out = boardRows(boards, budget, { now, paused });
    const byUnd = Object.fromEntries(boards.map((b) => [b.und, b]));
    for (const r of [...out.rows, ...out.noPrice]) r.board = byUnd[r.und];
    return out;
  }, [boards.map((b) => `${b.und}:${b.prices_ts}`).join(","), budget, paused]);
  const filters = { coin, range, side };
  const follows = new Set(doc.follows.map((f) => `${f.id}:${f.side}`));
  const query = search.trim().toLowerCase();
  const matches = (r) => (!followingOnly || follows.has(r.key)) && (!query ||
    `${r.und} ${ASSET_NAMES[r.und] || ""} ${money(r.k)} ${r.k} ${dayLabel(r.expiry)}`.toLowerCase().includes(query)
    || /^[$\d,.]+$/.test(query) && String(r.k).includes(query.replace(/[$,]/g, "")));
  const list = sortRows(filterRows(rows, filters, now).filter(matches), sort);
  const off = filterRows(noPrice, filters, now).filter(matches);
  const groups = outcomeGroups(list, off, (id, answer) => side === "all" && (!followingOnly || follows.has(`${id}:${answer}`)));
  const byDate = sort === "date";
  const rowsByDate = byDate ? dateRows(groups, coins) : [];
  // The rows shown: whole rows until about PAGE cards are on screen.
  const shownRows = [];
  for (let i = 0, cards = 0; i < rowsByDate.length && cards < shown; i++) { shownRows.push(rowsByDate[i]); cards += rowsByDate[i].items.length; }
  const shownCards = shownRows.reduce((n, r) => n + r.items.length, 0);
  const activeFilters = Number(range !== "all") + Number(side !== "all") + Number(sort !== DEFAULT_SORT);
  const alignOf = Object.fromEntries((markets?.coins || []).map((c) => [c.und, c.align]));
  useEffect(() => { setShown(PAGE); }, [coin, range, side, sort, budget, search, followingOnly]);

  if (embedded && followingOnly && !doc.follows.length) return (
    // Following, as a tab in Positions, before anything is followed: a short way in, no empty board.
    <section className="q-empty-card q-empty-tab" aria-label="Nothing followed yet">
      <h2>Keep an eye on an answer</h2>
      <p>Use the bookmark beside Higher or Lower to follow an answer. Its cost, availability and settlement show here, and notices appear when you come back. Kept in this browser only.</p>
      <Link className="btn" to="/saloon">Browse the Saloon</Link>
    </section>
  );
  if (error && !index) return <div className={embedded ? "" : "wrap page"}><Failed error={error} /></div>;
  return (
    <div className={embedded ? "bd-page bd-embedded" : "wrap page q-page bd-page"}>
      {!embedded && <SaloonHead view={followingOnly ? "following" : "browse"} />}
      {feeds}
      <section className="bd-controls" aria-label="Budget, filters and order">
        <div className="bd-control-top"><Budget value={budget} /><label className="bd-search"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input type="search" aria-label="Search outcomes" placeholder="Search coin or price" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
        <div className="bd-filters">
          <Tabs label="Coin" value={coin} onChange={setCoin} items={[["all", "All coins"], ...coins.map((u) => [u, u])]} />
          <button className="bd-filter-toggle" aria-expanded={showFilters} aria-controls="bd-advanced-filters" onClick={() => setShowFilters((open) => !open)}>
            <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 5h14M2 13h14M6 2v6M12 10v6" /></svg>Filters{activeFilters > 0 && <span className="mono">{activeFilters}</span>}
          </button>
          <div id="bd-advanced-filters" className={`bd-selects${showFilters ? " expanded" : ""}`}>
            <label className="bd-select"><span className="label">Dates</span>
              <select value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
            <label className="bd-select"><span className="label">Answer</span>
              <select value={side} onChange={(e) => setSide(e.target.value)}>{SIDES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
            <label className="bd-select"><span className="label">Order</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          </div>
        </div>
      </section>
      {followingOnly && <Following />}
      {!index || !ready ? <Loading /> : (
        <>
          <p className="bd-count status" aria-live="polite">
            <span className="bd-count-main"><span className="mono">{groups.length}</span> {groups.length === 1 ? "outcome" : "outcomes"}{byDate && <> on <span className="mono">{rowsByDate.length}</span> {rowsByDate.length === 1 ? "date" : "dates"}</>}<span className="bd-answer-count"> · {list.length} {list.length === 1 ? "answer" : "answers"} for <span className="mono">{usd(budget)}</span></span></span>
            <span className="bd-count-time">
            <span>{paused ? "Prices paused" : index?.prices_ts ? `Derive prices ${new Date(index.prices_ts * 1000).toISOString().slice(11, 16)} UTC` : "Derive prices"} · Fees included · Defined cost</span>
            <Info label="About this list">{byDate
              ? "Each row is one coin and settlement date, soonest first; on the same date Bitcoin comes first, then Ethereum, then the other coins. Inside a row the levels run from low to high, and the lit line shows where the coin's index is now. Each answer shows its price per $1 of payout before fees and the most your budget can make, fees included; open an outcome for the full picture. Choose another order under Filters to see one list ranked by cost over Derive's mark, closeness to the price, settlement or size."
              : "Answers are grouped by coin, price level and settlement date. Each row takes the position of its first answer in your selected order: cost over Derive's mark before fees, closeness to the coin's price, settlement or size. Missing comparison figures go last."} Research is separate from this order. Answers that fail Cowboy's checks are left out; answers with no price have a reason below.</Info></span>
          </p>
          {list.length ? (
            <div className="bd-marketplace" role="region" aria-label="Outcomes">
              {byDate ? <>
                <div className="bd-rows">{shownRows.map((row) => <DateRow key={row.key} row={row} align={alignOf[row.und]} budget={budget} />)}</div>
                {rowsByDate.length > shownRows.length && <button className="text-control bd-more" onClick={() => setShown(shownCards + PAGE)}>Show later dates</button>}
              </> : <>
                <LadderKey budget={budget} />
                <ol className="bd-grid">
                  {groups.slice(0, shown).map((r) => <OutcomeCard key={r.id} outcome={r} align={alignOf[r.und]} budget={budget} />)}
                </ol>
                {groups.length > shown && <button className="text-control bd-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, groups.length - shown)} more outcomes</button>}
              </>}
            </div>
          ) : <div className="bd-empty"><h2>{followingOnly && !doc.follows.length ? "Keep an eye on an answer." : "No outcomes match these filters."}</h2><p>{followingOnly && !doc.follows.length ? "Use the bookmark beside Higher or Lower to follow that answer. It stays in this browser." : "Try another coin, date or price. Answers without a price are listed below when available."}</p>{followingOnly && !doc.follows.length && <Link className="btn" to="/saloon">Browse outcomes</Link>}</div>}
          <NoPriceList list={off} />
        </>
      )}
    </div>
  );
}
