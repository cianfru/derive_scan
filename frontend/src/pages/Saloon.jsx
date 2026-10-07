import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { useClock } from "../lib/useClock.js";
import { useFeeds } from "../components/Feeds.jsx";
import { Info, Loading, RefreshNotice } from "../components/ui.jsx";
import { CoinIcon } from "../components/MarketVisuals.jsx";
import SaloonHead from "../components/SaloonNotices.jsx";
import SaloonChart, { countText, dayName, traderText } from "../components/SaloonChart.jsx";
import QuestionTicket from "../components/QuestionTicket.jsx";
import { OutcomeFigures } from "../components/OutcomePreview.jsx";
import { FollowButton } from "../components/Follow.jsx";
import { useIndexPrice } from "../lib/livePrice.js";
import { useSheetFocus } from "../components/DecisionSheet.jsx";
import DecisionComparison, { CompareControl } from "../components/OutcomeDecision.jsx";
import { readDecision, retainOutcome, saloonReturn, useDecision } from "../lib/decision.js";
import { ASSET_NAMES } from "../lib/presentation.js";
import { boardRows } from "../lib/board.js";
import { oneTapOffered } from "../lib/pilot.js";
import { ANSWER, budgetTicket, buyCents, countdown, findLevel, fullPay, live, money, outcome, priceAge, questionText, settlingNow, signed } from "../lib/questions.js";
import Board from "./Board.jsx";
import { recordProductEvent } from "../lib/diagnostics.js";
import "../questions.css";
import "../board.css";
import "../marketplace-detail.css";
import "../saloon-chart.css";

// Bubbles show the most each answer makes for one amount, as on the list, so they compare like for like.
const REF = 100;
const QUICK = [25, 100, 500];
const CANDLES = 72; // 12 days of 4-hour candles
const pctText = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/** One coin tab, its price and 24-hour change live from Derive's index feed once it answers. */
function CoinTab({ c: snap, on, onChange }) {
  const lp = useIndexPrice(snap.und, snap.index, snap.pricesTs);
  const c = lp.price ? { ...snap, index: lp.price, chg: lp.source === "live" && lp.prev > 0 ? (lp.price / lp.prev - 1) * 100 : snap.chg } : snap;
  return (
    <button type="button" role="tab" data-und={c.und} aria-selected={on} tabIndex={on ? 0 : -1} className="sl-ctab" onClick={() => onChange(c.und)}
      aria-label={`${c.name}${Number.isFinite(c.index) ? `, ${money(c.index)}` : ""}${Number.isFinite(c.chg) ? `, ${pctText(c.chg / 100)} in 24 hours` : ""}, ${c.count} ${c.count === 1 ? "answer" : "answers"}${c.smart ? `, ${c.smart} with smart wallets` : ""}`}>
      <CoinIcon und={c.und} />
      <span className="ct-body">
        <span className="ct-top"><b>{c.und}</b><small>{c.name}</small></span>
        <span className="ct-mid"><span className="ct-price mono">{Number.isFinite(c.index) ? money(c.index) : "Not available yet"}</span>
          {Number.isFinite(c.chg) && <span className={`ct-chg mono ${c.chg >= 0 ? "up" : "down"}`}>{pctText(c.chg / 100)}</span>}</span>
        <span className="ct-foot">{c.failed ? "Data unavailable" : <>{c.count} {c.count === 1 ? "answer" : "answers"}{c.smart > 0 && <><i className="ct-gold" aria-hidden="true" />{c.smart}</>}{c.thin && " · thin book"}</>}</span>
      </span>
    </button>
  );
}

/** The coin tabs (inside the page, above the chart): logo, price, 24-hour change, answers and gold rings. */
function CoinTabs({ coins, value, onChange }) {
  const ref = useRef(null);
  const keys = (e) => {
    const tabs = [...ref.current.querySelectorAll('[role="tab"]')], i = tabs.indexOf(document.activeElement);
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (n == null || i < 0) return;
    e.preventDefault();
    const t = tabs[(n + tabs.length) % tabs.length];
    t.focus(); onChange(t.dataset.und);
  };
  return (
    <div className="sl-ctabs-wrap">
      <div ref={ref} className="sl-ctabs" role="tablist" aria-label="Coin" onKeyDown={keys}>
        {coins.map((c) => <CoinTab key={c.und} c={c} on={c.und === value} onChange={onChange} />)}
      </div>
    </div>
  );
}

/** The trade panel over the chart: the answer, Higher or Lower, the amount (fees included), what it pays, the ticket. */
function TradePanel({ und, row, rows, board, age, onPick, onClose, opener, refreshError, now }) {
  const current = useIndexPrice(und, board.index, board.prices_ts);
  const [decision, update] = useDecision();
  const draft = decision.amountDraft, setDraft = (amountDraft) => update({ amountDraft });
  const [ticket, setTicket] = useState(false);
  const panelRef = useRef(null);
  const stageAction = useRef(null), previousStage = useRef(ticket);
  const modal = useSheetFocus(true, panelRef, opener, () => ticket ? setTicket(false) : onClose(), "(max-width: 700px)");
  useEffect(() => {
    if (previousStage.current === ticket) return;
    previousStage.current = ticket;
    const action = stageAction.current;
    (action && !action.disabled ? action : panelRef.current?.querySelector(".sl-close"))?.focus();
  }, [ticket]);
  useEffect(() => { setTicket(false); }, [row.key]);
  const level = row.level, side = row.side, yes = side === "yes";
  const paused = age.state === "paused" || board.paused;
  const opposite = side === "yes" ? "no" : "yes";
  const other = rows.find((r) => r.expiry === row.expiry && r.k === row.k && r.side !== side)
    || { ...row, side: opposite, key: `${row.id}:${opposite}`, buyCents: buyCents(level, opposite, paused) };
  const settling = settlingNow(level, now);
  const dollars = Number(draft);
  const valid = Number.isFinite(dollars) && dollars > 0;
  const t = valid && !settling && live(level, side, paused, now) ? budgetTicket(level, side, dollars, board) : null;
  const ready = t && !t.belowMin && t.payout > 0;
  const smart = level.smart_wallets || null;
  const traders = board.dates?.find((d) => d.expiry === row.expiry)?.traders || null;
  const question = questionText(und, level, row.expiry);
  const pick = (s) => { const r = s === side ? row : other; if (r) onPick(r); };
  useEffect(() => { if (!ready) setTicket(false); }, [ready]);
  const atNow = ready && Number.isFinite(current.price) ? outcome(t, level, side, current.price) : null;
  return (
    <aside ref={panelRef} className="sl-panel" role={modal ? "dialog" : undefined} aria-modal={modal ? "true" : undefined} aria-label="Your trade" tabIndex={-1}>
      <button type="button" className="text-control sl-close" onClick={onClose}>Close</button>
      <header>
        <h2>{und} {yes ? "higher" : "lower"} than {money(row.k)}?</h2>
        <p className="sl-when">{dayName(row.settleTs)}, 08:00 UTC{countdown(row.settleTs) && <> · {countdown(row.settleTs)}</>} · {und} index <span className="mono">{money(current.price)}</span><small className="decision-price-note">{current.notice}</small></p>
      </header>
      <RefreshNotice error={refreshError} />
      {age.state === "paused" && <p className="q-note warn">{und} prices paused.</p>}
      {ticket && ready ? <>
        <button ref={stageAction} type="button" className="text-control sl-back" onClick={() => setTicket(false)}>Back to payout</button>
        <QuestionTicket und={und} question={question} answer={ANSWER[side]} level={level} sideKey={side} t={t} board={board}
          pricesTs={board.prices_ts} settleTs={row.settleTs} expiry={row.expiry} stale={age.state === "stale"} />
      </> : <>
        <div className="sl-seg" role="group" aria-label="Answer">
          {["yes", "no"].map((s) => {
            const r = s === side ? row : other;
            return <button key={s} type="button" className={s} aria-pressed={s === side} disabled={!r || r.buyCents == null} onClick={() => pick(s)}>
              {ANSWER[s]}<small className="mono">{r?.buyCents != null ? `${r.buyCents}c per $1` : "No price now"}</small><small>{fullPay(level, s)}</small></button>;
          })}
        </div>
        <div className="sl-amount">
          <label htmlFor="sl-dollars" className="label">Amount, fees included<Info label="About the amount">The total you spend, Derive's fees included. Cowboy sizes the two options so their price plus Derive's fees fit this amount.</Info></label>
          <span className="q-dollar-field"><span>$</span><input id="sl-dollars" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))} /></span>
          <span className="q-quick">{QUICK.map((v) => <button key={v} type="button" className="text-control" aria-pressed={dollars === v} onClick={() => setDraft(String(v))}>${v}</button>)}</span>
        </div>
        {t ? <>
          {t.belowMin && <p className="q-note warn">Smallest amount here: {money(t.minTotal, { cents: true })} with Derive's fees.</p>}
          {t.capped && <p className="q-note">Up to {money(t.capPayout)} of payout at this price; more costs more.</p>}
          {!t.belowMin && <section className="md-preview" aria-label="What it pays"><OutcomeFigures und={und} level={level} side={side} t={t} expiry={row.expiry} settleTs={row.settleTs} summary compact /></section>}
        </> : <p className="status">{settling ? "Settling · average from 07:30 to 08:00 UTC" : valid ? `No price now for ${ANSWER[side]}.` : "Enter an amount greater than $0."}</p>}
        {atNow && <p className="decision-consequence">If {und} settles at {money(current.price)}, you get <b>{money(atNow.payout, { cents: true })}</b> · <b className={atNow.pl >= 0 ? "up" : "down"}>{signed(atNow.pl)}</b><Info label="About this settlement example">This example uses {current.source === "live" && current.fresh ? "the live index" : "the last available index"} and describes settlement at that price. Selling back early has a different value.</Info></p>}
        {traders && <p className="sl-traders">Directional traders on this date: {traderText(traders)}.<Info label="About directional traders">Every Derive wallet that trades options for direction, profitable or not. Market makers, income sellers (who sell options to collect a fee) and hedgers (who buy protection) are left out. Each wallet counts long or short by its own open options on this settlement date (at least $1,000 its way). "Most of the money" weighs them by size: long or short when at least 62.5% points one way. It needs 3 traders and $10,000. Where traders lean is not where the price goes. Context, not a signal.</Info></p>}
        {smart && <p className="sl-smart">Smart wallets here: {countText(smart)}.<Info label="About smart wallets">The most profitable directional options wallets on Derive holding options of this date at strikes inside this answer's pay zone, each counted long or short by its own position there (at least $1,000). The gold ring marks the answer at least two of them lean toward, more than lean the other way. Context, not a signal.</Info></p>}
        {age.state === "stale" && <p className="q-note warn">Prices are {age.minutes} min old.</p>}
        <button ref={stageAction} type="button" className="btn primary lg" disabled={!ready} onClick={() => setTicket(true)}>Review trade</button>
        <p className="sl-foot"><span>{oneTapOffered() ? "One tap: both options at one price, or nothing." : "One-tap trading is coming to Cowboy."}</span>
          <Link to={`/q/${row.id}?side=${side}`} onClick={() => recordProductEvent("payout_reviewed")} state={{ amountDraft: draft, ...(valid ? { dollars } : {}), returnTo: saloonReturn(und) }}>Full details</Link><FollowButton id={row.id} side={side} k={row.k} board={board} /><CompareControl selection={row} onView={onClose} /></p>
      </>}
    </aside>
  );
}

function DataFailure({ title, retry, children, coin }) {
  return <div className="decision-failure" role="status"><h2>{title}</h2>{children && <p>{children}</p>}
    <div className="decision-actions">{retry && <button type="button" className="text-control" onClick={() => retry()}>Retry</button>}
      <Link to={saloonReturn(coin, { ...readDecision(), view: "list" })}>View the list</Link></div>
  </div>;
}

function ChartView({ index, error, retryIndex }) {
  const { theme } = useOutletContext() || {};
  const [params, setParams] = useSearchParams();
  const [decision, update] = useDecision();
  const opener = useRef(null);
  const { data: markets } = useData("markets.json");
  const listed = (index?.coins || []).map((c) => c.und);
  const [feeds, files, ready, results] = useFeeds(listed.map((u) => `questions/${u}.json`), undefined,
    { revision: index?.publication_revision, retry: retryIndex });
  const now = useClock();
  const indexAge = priceAge(index?.prices_ts, now, index?.paused);
  const globalPaused = indexAge.state === "paused";
  const boards = listed.map((u) => files[`questions/${u}.json`]).filter(Boolean);
  const rows = boardRows(boards, REF, { now, paused: globalPaused }).rows;
  const byUnd = Object.fromEntries(boards.map((b) => [b.und, b]));
  const mk = Object.fromEntries((markets?.coins || []).map((c) => [c.und, c]));
  const coins = listed.map((u) => {
    const meta = (index.coins || []).find((c) => c.und === u) || {};
    return { und: u, name: ASSET_NAMES[u] || u, index: byUnd[u]?.index, pricesTs: byUnd[u]?.prices_ts,
      chg: mk[u]?.chg_24h, count: rows.filter((r) => r.und === u).length, smart: meta.smart || 0,
      thin: !!byUnd[u]?.thin, failed: !!results[`questions/${u}.json`]?.error && !byUnd[u] };
  });
  const asked = (params.get("coin") || "").toUpperCase();
  const und = asked || (listed.includes(decision.coin) ? decision.coin : null) || coins.find((c) => c.count)?.und || coins[0]?.und;
  const board = byUnd[und];
  const boardResult = results[`questions/${und}.json`];
  const age = board ? priceAge(board.prices_ts, now, board.paused || globalPaused) : indexAge;
  const paused = age.state === "paused";
  const { data: coinFile, error: coinError, retry: retryCandles } = useData(und && listed.includes(und) ? `coins/${und}.json` : null);
  const mine = rows.filter((r) => r.und === und);
  const dates = useMemo(() => {
    const by = new Map();
    for (const r of mine) { if (!by.has(r.expiry)) by.set(r.expiry, []); by.get(r.expiry).push(r); }
    return [...by.keys()].sort().map((e) => ({ expiry: e, settle: by.get(e)[0].settleTs, rows: by.get(e),
      traders: board?.dates?.find((d) => d.expiry === e)?.traders || null }));
  }, [mine.map((r) => `${r.key}:${r.total}`).join(","), board, und]);
  const candles = useMemo(() => (coinFile?.candles?.["4h"] || []).slice(-CANDLES), [coinFile]);
  const explicitId = params.get("outcome");
  const chosen = explicitId ? { id: explicitId, side: params.get("side") }
    : decision.outcome?.und === und ? decision.outcome : null;
  const found = chosen && board ? findLevel(board, chosen.id) : null;
  const selected = found && !found.settled && ["yes", "no"].includes(chosen.side) ? {
    key: `${chosen.id}:${chosen.side}`, id: chosen.id, side: chosen.side, und, level: found.level,
    k: found.level.k, lo: found.level.lo, hi: found.level.hi, expiry: found.date.expiry,
    settleTs: found.date.settle_ts, buyCents: buyCents(found.level, chosen.side, paused),
  } : null;
  const showPanel = !!explicitId || decision.panelOpen;
  const close = () => {
    update({ panelOpen: false });
    setParams((p) => { const n = new URLSearchParams(p); n.delete("outcome"); n.delete("side"); return n; }, { replace: true });
  };
  const pick = (r) => {
    if (!showPanel) opener.current = [...document.querySelectorAll(".sch-bubble")].find((n) => n.dataset.key === r.key) || document.activeElement;
    retainOutcome(r);
    recordProductEvent("outcome_opened");
    update({ view: "chart" });
    setParams((p) => { const n = new URLSearchParams(p); n.set("coin", r.und); n.set("outcome", r.id); n.set("side", r.side); return n; }, { replace: true });
  };
  const setCoin = (u) => {
    update({ coin: u, outcome: null, panelOpen: false, view: "chart" });
    setParams((p) => { const n = new URLSearchParams(p); n.set("coin", u); n.delete("outcome"); n.delete("side"); return n; }, { replace: true });
  };
  const missing = listed.filter((u) => results[`questions/${u}.json`]?.error && !byUnd[u]);

  return (
    <div className="wrap page q-page bd-browser sl-page">
      <SaloonHead view="chart" board coin={und} quoteTs={board?.prices_ts || index?.prices_ts} paused={paused} />
      {feeds}
      <RefreshNotice error={error} />
      {missing.length > 0 && <p className="page-meta" role="status">{missing.join(", ")} outcome data unavailable.</p>}
      {!index || !ready ? <Loading /> : !coins.length ? <div className="bd-empty" role="status"><h2>No prices on Derive right now.</h2><p>Derive's order books are empty, so no outcome can be priced. Outcomes return here once Derive quotes again.</p></div> : <>
          <CoinTabs coins={coins} value={und} onChange={setCoin} />
          {board && <div className="sl-key">
            <p className="sl-key-mobile">
              <span><i className="up" aria-hidden="true" />Higher</span>
              <span><i className="down" aria-hidden="true" />Lower</span>
              <span className="sl-key-return">Max profit on {money(REF)}<Info label="About chart returns">Each bubble shows the most you make on {money(REF)}, Derive's fees included. Higher pays above the level; Lower pays below it, with partial payouts inside the pay zone. Tap a bubble for the exact payout range and dollar figures. {mine.length} {ASSET_NAMES[und] || und} ({und}) answers have a price now; {coins.find((c) => c.und === und)?.smart || 0} with smart wallets.{board.thin && " This coin has a thin order book."} A gold ring means more smart wallets lean that way. The bottom line shows directional traders' long and short positions on each date. These readings are context, not a signal.</Info></span>
            </p>
            <p className="sl-key-desktop">
              <span><i className="up" aria-hidden="true" />Higher: pays if {und} settles above the level</span>
              <span><i className="down" aria-hidden="true" />Lower: pays if it settles below</span>
              <span><i className="gold" aria-hidden="true" />Gold ring: more smart wallets lean that way</span>
              <span>Each bubble: the most you make on {money(REF)}, fees included</span>
              {dates.some((d) => d.traders) && <span><i className="lane" aria-hidden="true" />Bottom line: directional traders long and short on each date</span>}
              <span className="sl-key-how">Drag a bubble to explore · scroll or pinch to zoom · drag the chart to move</span>
            </p>
          </div>}
          <RefreshNotice error={board ? boardResult?.error : null} />
          <RefreshNotice error={coinFile ? coinError : null} />
          {age.state === "stale" && board && <p className="page-meta" role="status">{und} option prices are {age.minutes} min old.</p>}
          {chosen && !selected && board && <p className="page-meta" role="status">The selected outcome is no longer available here. <Link to={`/q/${chosen.id}?side=${chosen.side}`}>Open its details</Link></p>}
          <div className="sl-frame">
            {!listed.includes(und) ? <DataFailure coin={und} title={`${und} is not on this board.`} retry={retryIndex}>Choose another coin.</DataFailure>
              : !board && boardResult?.error ? <DataFailure coin={und} title={`${und} outcome data is unavailable.`} retry={boardResult.retry}>Your selected coin stays selected.</DataFailure>
              : !board ? <Loading /> : !coinFile && coinError ? <DataFailure coin={und} title={`${und} chart data is unavailable.`} retry={retryCandles}>Outcome prices are available in the list.</DataFailure>
              : !coinFile ? <Loading /> : paused ? <DataFailure coin={und} title={`${und} prices paused.`} retry={boardResult?.retry}>The last available option quotes are too old to use.</DataFailure> : !dates.length ? <div className="bd-empty" role="status"><h2>No {und} answer has a price now.</h2><p>Try another coin, or the list for the reasons.</p></div>
              : <SaloonChart und={und} name={ASSET_NAMES[und]} index={board.index} publishedTs={board.prices_ts} candles={candles} dates={dates} amount={REF} now={now} theme={theme}
                  selected={selected} onOpen={pick} />}
            {selected && showPanel && <div className="sl-backdrop" aria-hidden="true" onClick={close} />}
            {selected && showPanel && <TradePanel key={`${und}:${selected.expiry}:${selected.k}`} und={und} row={selected} rows={mine} board={board} age={age}
              onPick={pick} onClose={close} opener={opener} refreshError={boardResult?.error} now={now} />}
          </div>
          <DecisionComparison boards={byUnd} now={now} index={index} retryIndex={retryIndex} />
          <footer className="bd-footer sl-footer">
            <span>{age.state === "paused" ? "Prices paused" : board?.prices_ts ? `Derive prices ${new Date(board.prices_ts * 1000).toISOString().slice(11, 16)} UTC` : "Derive prices"} · Fees included · Defined cost</span>
            <details><summary>How to read this chart</summary>
              <p>Candles on the left are {und}'s last 12 days, every 4 hours. Each column on the right is a settlement date at 08:00 UTC; the columns are spaced evenly so every date fits, with the time left under each date. Each bubble is one answer at its level: Higher above the price now, Lower below it. The figure inside is the most it makes for a {money(REF)} total, Derive's fees included. Hover a bubble to see where it pays; click it to open the trade panel. Small dots are levels without room for a bubble: click one, or zoom in, and it opens up. Drag a bubble to slide through other levels and dates.</p>
              <p>Smart wallets are the most profitable directional options wallets on Derive. At each level, every one holding options of that date inside the answer's pay zone counts long or short by its own position there; hover a bubble to see "Smart wallets here: 3 long · 1 short". The gold ring marks the answer at least two of them lean toward, more than lean the other way (with at least $10,000 between them, $2,000 on smaller coins). The line under the dates counts every directional trader on each date the same way, "7 long · 8 short"; its dot sits higher when most of their money is long, lower when it is short, and is bigger when more money is behind it. It needs 3 traders. Context, not a signal.</p>
            </details>
          </footer>
        </>}
    </div>
  );
}

/** The Saloon: the chart by default, the list with ?view=list. */
export default function Saloon() {
  const [params] = useSearchParams();
  const { data: index, error, retry: retryIndex } = useData("questions/index.json");
  if (params.get("view") === "list") return <Board />;
  if (error && !index) return <div className="wrap page"><DataFailure title="Outcome data is unavailable." retry={retryIndex}>The Saloon could not load its prices.</DataFailure></div>;
  return <ChartView index={index} error={error} retryIndex={retryIndex} />;
}
