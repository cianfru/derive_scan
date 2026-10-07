import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { useClock } from "../lib/useClock.js";
import { useIndexPrice } from "../lib/livePrice.js";
import { useSheetFocus } from "../components/DecisionSheet.jsx";
import { useFeeds } from "../components/Feeds.jsx";
import { Info, Loading, Failed, RefreshNotice, Tabs } from "../components/ui.jsx";
import { Asset, CoinIcon } from "../components/MarketVisuals.jsx";
import { ChainMini, HORIZON_LABEL, LAYERS, LayerTile } from "../components/Chain.jsx";
import { ASSET_NAMES } from "../lib/presentation.js";
import SaloonHead from "../components/SaloonNotices.jsx";
import { FollowButton, FollowLevel } from "../components/Follow.jsx";
import { DEFAULT_SORT, RANGES, SIDES, SORTS, boardRows, contextHorizon, dateRows, filterRows, nearRow, sortRows } from "../lib/board.js";
import { viewReading } from "../lib/presentation.js";
import { exportFollows, importFollows, unfollow, useFollowsDoc } from "../lib/follows.js";
import { TESTNET_FILLS } from "../lib/flags.js";
import { NOT_ON_TESTNET, NOT_ON_TESTNET_WHY, missingLegs, useTestnetListing } from "../lib/testnetLevels.js";
import { ANSWER, countdown, dayLabel, fullPay, money, noPriceReason, priceAge, signed } from "../lib/questions.js";
import SettleChart from "../components/SettleChart.jsx";
import "../settle-chart.css";
import "../questions.css";
import "../board.css";
import LiveMoney from "../components/LiveMoney.jsx";
import { recordProductEvent } from "../lib/diagnostics.js";
import DecisionComparison, { CompareControl, ViewComparison } from "../components/OutcomeDecision.jsx";
import { retainOutcome, updateDecision, useDecision } from "../lib/decision.js";

const PAGE = 24;
const usd = (v) => money(v, { cents: true });
const perText = (v, plus = true) => `${v < 0 ? "-" : plus ? "+" : ""}${Math.abs(v * 100).toFixed(1)}c`;
const clock = (t) => `${new Date(t * 1000).toISOString().slice(11, 16)} UTC`;

// The board prices every answer for one amount, so answers compare like for like; the amount itself is
// chosen on the outcome page.
const REF = 100;
/** The most an answer makes as a share of what it costs, fees included. */
export function returnText(make, total) {
  if (!(make > 0) || !(total > 0)) return "None";
  const pct = (make / total) * 100;
  return `+${pct >= 100 ? Math.round(pct).toLocaleString("en-US") : pct.toFixed(1)}%`;
}

function NotYet({ label, why }) {
  return <span className="q-noprice bd-notyet">Not available yet<Info label={label}>{why}</Info></span>;
}

/** One answer in a level's row: its price per $1 and the most it makes as a share of its cost; the tile opens the
 * outcome at that answer; the bookmark beside it follows the answer. */
function AnswerChoice({ r, budget }) {
  const [decision] = useDecision();
  const dollars = Number(decision.amountDraft);
  const location = useLocation();
  const listed = useTestnetListing(TESTNET_FILLS && !r.reason ? r.und : null);
  const offTestnet = TESTNET_FILLS && missingLegs(r.id, r.side, listed).length > 0;
  const available = !r.reason && !offTestnet;
  const name = `${r.und} ${ANSWER[r.side]} than ${money(r.k)} on ${dayLabel(r.expiry)}`;
  const side = <span className="bd-choice-name"><i className={`q-arrow ${r.side}`} aria-hidden="true" />{ANSWER[r.side]}</span>;
  return (
    <div className={`bd-answer ${r.side}${available ? "" : " off"}`}>
      {offTestnet ? <div className="bd-choice off">{side}<span className="q-noprice">{NOT_ON_TESTNET}<Info label={`Why ${name} is not on testnet`}>{NOT_ON_TESTNET_WHY}</Info></span></div>
        : available ? <Link to={`/q/${r.id}?side=${r.side}`} state={{ step: "preview", amountDraft: decision.amountDraft, ...(Number.isFinite(dollars) && dollars > 0 ? { dollars } : {}), returnTo: `${location.pathname}${location.search}` }} onClick={() => { retainOutcome(r); recordProductEvent("outcome_opened"); }} className={`bd-choice ${r.side}`} aria-label={`${name}: see what it pays`}>
          <span className="bd-choice-top">{side}<span className="bd-price mono" title={r.capped ? "Small size at this price" : undefined}>{r.buyCents}¢{r.capped && <small className="bd-capped" aria-label="small size at this price">*</small>}</span></span>
          <span className="bd-choice-ret">{r.make > 0 && <small>up to</small>}<b className={`mono${returnText(r.make, r.total).length > 6 ? " long" : ""}`}>{returnText(r.make, r.total)}</b></span>
        </Link>
        : <div className="bd-choice off">{side}<span className="q-noprice">No price now<Info label={`Why ${name} has no price`}>{r.reason}</Info></span></div>}
      <FollowButton id={r.id} side={r.side} k={r.k} board={r.board} compact />
      {available && <CompareControl selection={r} compact />}
    </div>
  );
}

function Comparison({ r }) {
  if (r.reason) return null;
  return <div className="bd-comparison-side">
    <h4 className={r.side === "yes" ? "up" : "down"}>{ANSWER[r.side]}</h4>
    <dl className="bd-figs">
        <div><dt>You pay, for {usd(REF)}</dt><dd className="mono">{usd(r.total)}</dd></div>
        <div><dt>Most it pays</dt><dd className="mono">{usd(r.payout)}</dd></div>
        <div><dt>Full payout</dt><dd>{fullPay(r.level, r.side)}</dd></div>
        <div><dt>Pays in part</dt><dd className="mono">{money(r.level.lo)}–{money(r.level.hi)}</dd></div>
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

/** One level: the level and its pays-in-part zone, then Higher and Lower side by side.
 * In the date rows (`inRow`) the row header carries the coin and the date, so the row leaves them out. */
function OutcomeCard({ outcome: r, align, budget, inRow = false, boardStyle = false }) {
  const [expanded, setExpanded] = useState(false);
  const answers = [r.answers.yes, r.answers.no].filter(Boolean);
  const Heading = inRow ? "h3" : "h2";
  return (
    <li className={`bd-card${inRow ? " in-row" : ""}${answers.length === 1 ? " single" : ""}`}>
      <div className="bd-level">
        {!inRow && <div className="bd-card-top"><Asset und={r.und} /><span className="bd-settle">{dayLabel(r.expiry)}<small>08:00 UTC · {countdown(r.settleTs)}</small></span></div>}
        <Heading className="bd-card-q"><Link className="bd-question" to={`/q/${r.id}`}  aria-label={`${r.und} at ${money(r.k)} on ${dayLabel(r.expiry)}: view outcome`}>
          <span className="bd-q-text">Higher or lower than</span> <strong className="mono">{money(r.k)}</strong><span className="bd-q-text">?</span>
        </Link></Heading>
        {r.thin && <span className="bd-thin">Thin book</span>}
      </div>
      {answers.map((a) => <AnswerChoice key={a.side} r={a} budget={budget} />)}
      <details className="bd-comparison" onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary aria-label={`Compare & research ${r.und} at ${money(r.k)}`}><span className="bd-more-text">Compare & research</span></summary>
        {expanded && <>
        <div className="bd-comparison-grid">{answers.map((a) => <Comparison key={a.side} r={a} />)}</div>
        <p className="bd-comparison-help">Cost over mark and exit cost are per $1 of maximum payout, before fees.<Info label={`About ${r.und} comparison at ${money(r.k)}`}>Cost over mark is the buy price minus Derive's mark from the same price read. Exit cost is that mark minus the published sell-back price. A missing or stale mark is not compared. Payout size is what Derive's screen offers at this price; a larger amount can cost more.</Info></p>
        <div className="bd-ctx"><span>Research context<Info label={`About ${r.und} research context`}>Regime, Wallets, Options, in that order. The {contextHorizon(r.settleTs) === "7d" ? "4-hour regime is paired with 7-day" : "daily regime is paired with 30-day"} wallet and options context. These independent readings do not change the order of the board.</Info></span>{boardStyle ? <span>{HORIZON_LABEL[contextHorizon(r.settleTs)]} · Context, not a signal</span> : align ? <ChainMini alignment={align} horizon={contextHorizon(r.settleTs)} /> : <span className="dim">Unavailable</span>}</div>
        {boardStyle && <div className="bd-research-layers">{LAYERS.map(([kind, name]) => <div key={kind}><span className="label">{name}</span><LayerTile alignment={align} horizon={contextHorizon(r.settleTs)} kind={kind} sub="detail" icon={false} /></div>)}</div>}
        </>}
      </details>
    </li>
  );
}

/** Where the coin's index sits within a row's ladder: a lit line across the ladder between two levels. */
function NowMark({ und, index, current }) {
  return <li className="bd-now" aria-label={`${money(index)}, the coin's ${current?.fresh ? "index now" : "last index"}, sits here`}><span className="bd-now-line" aria-hidden="true" /><span className="bd-now-text" aria-hidden="true">{und} {current?.fresh ? "now" : "last index"} <b className="mono">{money(index)}</b></span><span className="bd-now-line end" aria-hidden="true" /></li>;
}

/** The key over a ladder: what each answer's two figures are. */
function LadderKey() {
  return <div className="bd-key"><span aria-hidden="true">Level</span><span>Up to: the most you make if it pays in full, <span className="bd-key-end">fees included<Info label="About these figures">The big figure is the profit if the answer pays in full, as a share of the total you pay, Derive's fees included, worked out for {usd(REF)}. The small price is the cost per $1 of maximum payout, before fees. Near its level an answer pays in part; opening an outcome shows the full payout curve. Derive charges a small fixed fee per option, so smaller amounts make a little less and larger ones a little more. * marks a price with only a small size available.</Info></span></span></div>;
}

const SMART_WORD = { up: "Long", defensive: "Short", neutral: "Balanced" };
/** How the smart wallets hold the coin over the window this date falls in, as one word, or nothing. */
function SmartWord({ und, align, settleTs, now }) {
  const horizon = contextHorizon(settleTs);
  const { state } = viewReading(align, horizon, "wallets", now);
  if (!SMART_WORD[state]) return null;
  return <span className="bd-row-smart">Smart wallets <b className={state}>{SMART_WORD[state]}</b><Info label={`About smart wallets on ${und}`}>How the most profitable fifth of Derive traders who bet on direction hold {und} options settling in the next {horizon === "7d" ? "7" : "30"} days. Context, not a signal: it never changes the order of this board.</Info></span>;
}

/** A quick look at the coin from a date row (owner, 7 October 2026: "something quick", no new page): hovering the
 * coin and its settlement time shows a small chart; a click opens it as a window over the board, with the date's
 * levels drawn into the time left to the settlement. Closing returns to the same place. */
function QuickLook({ row, name, when, levels, children }) {
  const [peek, setPeek] = useState(false);
  const [open, setOpen] = useState(false);
  const { data: coin, error } = useData(peek || open ? `coins/${row.und}.json` : null);
  const btn = useRef(null);
  const closeBtn = useRef(null);
  const windowRef = useRef(null);
  useSheetFocus(open, windowRef, btn, () => setOpen(false), "(min-width: 0px)");
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hover = (on) => {
    clearTimeout(timer.current);
    if (typeof window !== "undefined" && window.matchMedia && !window.matchMedia("(hover: hover)").matches) return;
    timer.current = setTimeout(() => setPeek(on), on ? 180 : 120);
  };
  const chart = (compact) => coin ? <SettleChart und={row.und} candles={coin.candles} index={row.index} publishedTs={row.pricesTs} settleTs={row.settleTs} levels={levels} compact={compact} />
    : error ? <p className="status">The {name} chart is unavailable right now.</p> : <p className="status">Loading the {name} chart…</p>;
  return <>
    <button ref={btn} type="button" className="bd-look" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setPeek(false); setOpen(true); }}
      onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)} onFocus={() => hover(true)} onBlur={() => hover(false)}>
      {children}<span className="bd-look-icon" aria-hidden="true" /><span className="sr-only">: open the {name} chart</span>
    </button>
    {peek && !open && <div className="bd-look-peek" aria-hidden="true">
      <div className="bd-look-peek-head"><b>{name}</b><span className="mono">index <LiveMoney und={row.und} value={row.index} publishedTs={row.pricesTs} /></span><span>Settles {when}</span></div>
      {chart(true)}
      <small>Click to open</small>
    </div>}
    {open && <>
      <div className="bd-look-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      <div ref={windowRef} className="bd-look-window" tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${name} price up to ${when}`}>
        <div className="bd-look-window-head">
          <div><h3>{name} <span className="mono">index <LiveMoney und={row.und} value={row.index} publishedTs={row.pricesTs} /></span></h3><p>Settles {when}{countdown(row.settleTs) && <> · {countdown(row.settleTs)}</>}</p></div>
          <button ref={closeBtn} type="button" className="text-control" onClick={() => setOpen(false)}>Close</button>
        </div>
        {chart(false)}
        <p className="sc-key"><span><i className="settle" />Settles {when}</span><span>Dotted lines: the levels on this date</span></p>
        <Link className="bd-look-open" to={`/coin/${row.und}`}>Open {name}</Link>
      </div>
    </>}
  </>;
}

/** One coin and settlement date: a header, then its levels from low to high with the index marked. */
function DateRow({ row: full, align, budget, boardStyle = false, all = false, now }) {
  const [open, setOpen] = useState(false);
  const pricesTs = full.items[0]?.board?.prices_ts;
  const current = useIndexPrice(full.und, full.index, pricesTs);
  const indexed = { ...full, index: current.price, pricesTs };
  const row = all || open ? { ...indexed, nowAt: Number.isFinite(current.price) ? indexed.items.filter((it) => it.k <= current.price).length : null } : nearRow(indexed);
  const name = ASSET_NAMES[full.und] || full.und;
  const when = `${dayLabel(full.expiry)}, 08:00 UTC`;
  const n = full.items.length;
  const cards = row.items.map((g) => <OutcomeCard key={g.id} outcome={g} align={align} budget={budget} inRow boardStyle={boardStyle} />);
  if (row.nowAt != null) cards.splice(row.nowAt, 0, <NowMark key="now" und={row.und} index={row.index} current={current} />);
  return (
    <section className="bd-row" aria-label={`${name}, settles ${when}`}>
      <header className="bd-row-head">
        <h2 className="bd-look-wrap"><QuickLook row={row} name={name} when={when} levels={row.items.map((g) => g.k)}><CoinIcon und={row.und} /><span className="bd-row-name">{name}</span><span className="bd-row-sep" aria-hidden="true">·</span><span className="bd-row-date">{when}</span>{countdown(row.settleTs) && <><span className="bd-row-sep" aria-hidden="true">·</span><span className="bd-row-in mono">{countdown(row.settleTs)}</span></>}</QuickLook></h2>
        <span className="bd-row-meta">{row.index != null && <span className="bd-row-index mono">{current.fresh ? "now" : "last index"} <LiveMoney und={row.und} value={row.index} publishedTs={pricesTs} /></span>}<SmartWord und={row.und} align={align} settleTs={row.settleTs} now={now} /></span>
      </header>
      <ol className="bd-row-cards" aria-label={`${name} levels on ${dayLabel(row.expiry)}, low to high`}>{cards}</ol>
      {!all && (row.hidden > 0 || open) && <button type="button" className="bd-row-all" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Show the levels near the price" : `View all ${n} levels`}</button>}
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

/** Browse: every live answer across coins and dates, priced for one amount, in the order the
 * user picks. Ordered by facts about the price only; the three layers sit on each row as context. */
export default function Board({ followingOnly = false, embedded = false }) {
  const { data: index, error, retry: retryIndex } = useData("questions/index.json");
  const [params, setParams] = useSearchParams();
  const [decision] = useDecision();
  const { data: markets } = useData("markets.json");
  const doc = useFollowsDoc();
  const budget = REF;
  const coins = (index?.coins || []).map((c) => c.und);
  const [feeds, files, ready, feedResults] = useFeeds(coins.map((u) => `questions/${u}.json`), undefined, { revision: index?.publication_revision, retry: retryIndex });
  const [coin, setCoinState] = useState(() => (params.get("coin") || decision.coin || "all").toUpperCase().replace(/^ALL$/, "all"));
  const [range, setRange] = useState(() => RANGES.some(([v]) => v === decision.list.range) ? decision.list.range : "all");
  const [side, setSide] = useState(() => SIDES.some(([v]) => v === decision.list.side) ? decision.list.side : "all");
  const [sort, setSort] = useState(() => SORTS.some(([v]) => v === decision.list.sort) ? decision.list.sort : DEFAULT_SORT);
  const [search, setSearch] = useState(() => typeof decision.list.search === "string" ? decision.list.search : "");
  const setCoin = (value) => {
    setCoinState(value);
    if (!embedded) setParams((p) => { const n = new URLSearchParams(p); if (value === "all") n.delete("coin"); else n.set("coin", value); return n; }, { replace: true });
  };
  useEffect(() => {
    if (!embedded) updateDecision({ coin: coin === "all" ? null : coin, view: "list", list: { range, side, sort, search } });
  }, [coin, range, side, sort, search, embedded]);
  const [showFilters, setShowFilters] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const now = useClock();
  const boards = coins.map((u) => files[`questions/${u}.json`]).filter(Boolean);
  const missingCoins = coins.filter((u) => feedResults[`questions/${u}.json`]?.error && !files[`questions/${u}.json`]);
  const feedFailed = ready && (coin === "all" ? coins.length > 0 && missingCoins.length === coins.length : missingCoins.includes(coin) || !coins.includes(coin));
  const refreshError = error || coins.map((u) => feedResults[`questions/${u}.json`]).find((r) => r?.data && r?.error)?.error;
  const age = priceAge(index?.prices_ts, now, index?.paused);
  const paused = age.state === "paused";
  const { rows, noPrice } = useMemo(() => {
    const out = boardRows(boards, budget, { now, paused });
    const byUnd = Object.fromEntries(boards.map((b) => [b.und, b]));
    for (const r of [...out.rows, ...out.noPrice]) r.board = byUnd[r.und];
    return out;
  }, [boards.map((b) => `${b.und}:${b.prices_ts}`).join(","), budget, paused, now]);
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
  for (let i = 0, cards = 0; i < rowsByDate.length && cards < shown; i++) { shownRows.push(rowsByDate[i]); cards += Math.min(rowsByDate[i].items.length, 4); }
  const shownCards = shownRows.reduce((n, r) => n + Math.min(r.items.length, 4), 0);
  const activeFilters = Number(range !== "all") + Number(side !== "all") + Number(sort !== DEFAULT_SORT);
  const alignOf = Object.fromEntries((markets?.coins || []).map((c) => [c.und, c.align]));
  useEffect(() => { setShown(PAGE); }, [coin, range, side, sort, budget, search, followingOnly]);

  // Keep the embedded Following layout; the public browser uses the same board frame as Markets.
  const BoardContainer = embedded ? Fragment : "section";
  const coinTabs = <Tabs label="Coin" value={coin} onChange={setCoin} items={[["all", "All coins"], ...coins.map((u) => [u, u])]} />;
  const scope = <span className="bd-count-main"><span className="mono">{groups.length}</span> {groups.length === 1 ? "outcome" : "outcomes"}{byDate && <> on <span className="mono">{rowsByDate.length}</span> {rowsByDate.length === 1 ? "date" : "dates"}</>}<span className="bd-answer-count"> · {list.length} {list.length === 1 ? "answer" : "answers"}</span></span>;
  const listGuide = <>{byDate
    ? "Each group is one coin and settlement date, soonest first; on the same date Bitcoin comes first, then Ethereum, then the other coins. Inside a group the levels run from low to high, and the line shows where the coin's index is now."
    : "Answers are grouped by coin, price level and settlement date. Each row takes the position of its first answer in your selected order. Missing comparison figures go last."} Each answer shows its price per $1 of maximum payout before fees. Most you make is the maximum profit as a share of the total you pay, including Derive fees, for a {usd(REF)} total. Fixed fees and available size can change that percentage at another amount. Open an outcome to choose your amount and see its full payout curve. Order by date, cost over Derive's mark, closeness to the coin's price, settlement or size. Research is context and does not change this order. Answers that fail Cowboy's checks are left out; answers with no price have a reason below.</>;

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
    <div className={embedded ? "bd-page bd-embedded" : "wrap page q-page bd-page bd-browser"}>
      {!embedded && <SaloonHead view={followingOnly ? "following" : "browse"} board coin={coin === "all" ? null : coin} quoteTs={coin === "all" ? index?.prices_ts : files[`questions/${coin}.json`]?.prices_ts || index?.prices_ts} paused={paused} />}
      {feeds}
      <RefreshNotice error={refreshError} />
      {coins.some((u) => feedResults[`questions/${u}.json`]?.data && feedResults[`questions/${u}.json`]?.error) && <p className="page-meta" role="status">{coins.filter((u) => feedResults[`questions/${u}.json`]?.data && feedResults[`questions/${u}.json`]?.error).join(", ")} option refresh failed.</p>}
      {missingCoins.length > 0 && !feedFailed && <p className="page-meta" role="status">{missingCoins.join(", ")} data could not be loaded. <button type="button" className="text-control" onClick={() => missingCoins.forEach((u) => feedResults[`questions/${u}.json`]?.retry?.())}>Retry</button></p>}
      {boards.filter((b) => priceAge(b.prices_ts, now, b.paused).state !== "fresh").map((b) => <p key={b.und} className="page-meta" role="status">{b.und} option prices {priceAge(b.prices_ts, now, b.paused).state === "paused" ? "paused" : `are ${priceAge(b.prices_ts, now, b.paused).minutes} min old`}.</p>)}
      <BoardContainer {...(embedded ? {} : { className: "bd-board", "aria-label": "Outcome board" })}>
      <section className="bd-controls" aria-label="Search, filters and order"><ViewComparison />
        <div className={`bd-control-top${embedded ? "" : " bd-toolbar"}`}>{!embedded && coinTabs}<label className="bd-search"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input type="search" aria-label="Search outcomes" placeholder="Search coin or price" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
        <div className={`bd-filters${embedded ? "" : " bd-context"}`}>
          {embedded ? coinTabs : <p className="bd-count status" aria-live="polite">{!index || !ready ? "Loading outcomes…" : feedFailed ? "Outcome data unavailable" : scope}</p>}
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
      {!index || !ready ? <Loading /> : feedFailed ? <div className="bd-empty" role="status"><h2>Outcome data is unavailable right now.</h2><p>{coin === "all" ? "Prices could not be loaded." : `${coin} outcome data is unavailable.`}</p><button type="button" className="text-control" onClick={() => coin === "all" ? coins.forEach((u) => feedResults[`questions/${u}.json`]?.retry?.()) : feedResults[`questions/${coin}.json`]?.retry?.()}>Retry</button></div> : !followingOnly && !coins.length ? <div className="bd-empty" role="status"><h2>No prices on Derive right now.</h2><p>Derive's order books are empty, so no outcome can be priced. Outcomes return here once Derive quotes again.</p></div> : (
        <>
          {embedded && <p className="bd-count status" aria-live="polite">
            {scope}
            <span className="bd-count-time">
            <span>{paused ? "Prices paused" : index?.prices_ts ? `Derive prices ${new Date(index.prices_ts * 1000).toISOString().slice(11, 16)} UTC` : "Derive prices"} · Fees included · Defined cost</span>
            <Info label="About this list">{listGuide}</Info></span>
          </p>}
          {list.length ? (
            <div className="bd-marketplace" role="region" aria-label="Outcomes">
              {byDate ? <>
                <LadderKey />
                <div className="bd-rows">{shownRows.map((row) => <DateRow key={row.key} row={row} align={alignOf[row.und]} budget={budget} boardStyle={!embedded} all={!!query || followingOnly} now={now} />)}</div>
                {rowsByDate.length > shownRows.length && <button className="text-control bd-more" onClick={() => setShown(shownCards + PAGE)}>Show later dates</button>}
              </> : <>
                <LadderKey />
                <ol className="bd-grid">
                  {groups.slice(0, shown).map((r) => <OutcomeCard key={r.id} outcome={r} align={alignOf[r.und]} budget={budget} boardStyle={!embedded} />)}
                </ol>
                {groups.length > shown && <button className="text-control bd-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, groups.length - shown)} more outcomes</button>}
              </>}
            </div>
          ) : <div className="bd-empty"><h2>{followingOnly && !doc.follows.length ? "Keep an eye on an answer." : "No outcomes match these filters."}</h2><p>{followingOnly && !doc.follows.length ? "Use the bookmark beside Higher or Lower to follow that answer. It stays in this browser." : "Try another coin, date or price. Answers without a price are listed below when available."}</p>{followingOnly && !doc.follows.length && <Link className="btn" to="/saloon">Browse outcomes</Link>}</div>}
          <NoPriceList list={off} />
        </>
      )}
      <DecisionComparison boards={Object.fromEntries(boards.map((b) => [b.und, b]))} now={now} index={index} retryIndex={retryIndex} />
      {!embedded && <footer className="bd-footer"><span>Prices before fees · Returns include fees, for a {usd(REF)} total</span><details><summary>How to read this board</summary><p>{listGuide}</p></details></footer>}
      </BoardContainer>
    </div>
  );
}
