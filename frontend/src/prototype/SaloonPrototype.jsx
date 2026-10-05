import { useEffect, useMemo, useState } from "react";
import { budgetTicket, breakeven, buyCents, dayLabel, live, money, noPriceReason, outcome, payAt, priceAge, signed } from "../lib/questions.js";
import { ASSET_NAMES, viewReading } from "../lib/presentation.js";
import { REGIME } from "../lib/format.js";
import { coinImage } from "./assets.js";
import "./saloon.css";

const usd = (value) => money(value, { cents: true });
const stamp = (value) => value ? new Date(value * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "Time unavailable";
const clock = (value) => value ? new Date(value * 1000).toISOString().slice(11, 16) + " UTC" : "Time unavailable";
const timestamp = (value) => typeof value === "number" ? (value > 1e12 ? value / 1000 : value) : Date.parse(value) / 1000;
const Arrow = () => <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>;
const Bookmark = ({ filled = false }) => <svg viewBox="0 0 20 20" width="18" height="18" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 3.5h10v13l-5-3.3-5 3.3z" /></svg>;

function Coin({ und, small = false }) {
  const size = small ? 24 : 34;
  return <span className={`sp-coin${small ? " small" : ""}`}>{["XAUT", "XRP"].includes(und) ? <><img className="sp-icon-light" src={coinImage(und, "light")} width={size} height={size} alt="" /><img className="sp-icon-dark" src={coinImage(und, "dark")} width={size} height={size} alt="" /></> : <img src={coinImage(und)} width={size} height={size} alt="" />}<span><b>{ASSET_NAMES[und] || und}</b><small>{und}</small></span></span>;
}

function Research({ markets, und, now, settleTs, navigate }) {
  const coin = (markets?.coins || []).find((item) => item.und === und);
  const horizon = (settleTs - now) / 86400 <= 10 ? "7d" : "30d";
  const readings = [["engine", "Daily trend"], ["wallets", "Smart wallets"], ["options", "Option prices"]].map(([kind, label]) => {
    const reading = viewReading(coin?.align, horizon, kind, now);
    return { ...reading, kind, heading: label, label: kind === "engine" && reading.state && reading.row?.regime ? REGIME[reading.row.regime] : reading.label };
  });
  return <section className="sp-research" aria-label="Research context">
    <div className="sp-section-head"><div><span className="cp-eyebrow">Research context</span><h2>Three views. One decision: yours.</h2></div><button className="sp-text-button" onClick={() => navigate("markets")}>Open research <Arrow /></button></div>
    <div className="sp-readings">{readings.map((reading) => <div key={reading.kind} title={`${reading.why || "Independent research reading."}${reading.row?.observed_at ? ` Observed ${stamp(reading.row.observed_at)}.` : ""}`}><span>{reading.heading}</span><strong className={`sp-reading-${reading.state || "missing"}`}>{reading.label}</strong><small>{reading.kind === "engine" ? "Last daily close" : reading.kind === "options" ? `${horizon === "7d" ? "7-day" : "30-day"} tenor` : `Expiries within ${horizon === "7d" ? "7" : "30"} days`}</small></div>)}</div>
    <p className="sp-muted">Context, not a signal. These readings do not rank the outcomes.</p>
  </section>;
}

function PriceTile({ level, side, board, budget, now, onChoose, selected = false }) {
  const age = priceAge(board.prices_ts, now, board.paused);
  const available = live(level, side, age.state === "paused", now);
  const ticket = available ? budgetTicket(level, side, budget, board) : null;
  const ready = ticket && !ticket.belowMin;
  return <button className={`sp-price-tile ${side}${selected ? " selected" : ""}`} disabled={!ready} onClick={() => onChoose(side)} title={!available ? noPriceReason(level, side, age.state === "paused") : ticket?.belowMin ? `Minimum total ${usd(ticket.minTotal)}, fees included.` : `${side === "yes" ? "Higher" : "Lower"}: preview this outcome`}>
    <span className="sp-price-top"><span>{side === "yes" ? "Higher" : "Lower"}</span><b>{ready ? <>{buyCents(level, side, false, now)}<small>¢</small></> : "—"}</b></span>
    <span className="sp-price-bottom">{ready ? <><span>Pay <b>{usd(ticket.mostLose)}</b></span><span>Up to <b>{usd(ticket.payout)}</b> back{ticket.capped && <small> · size limited</small>}</span></> : available && ticket?.belowMin ? "Budget below minimum" : "No price now"}</span>
  </button>;
}

function OutcomeCard({ item, budget, now, navigate, followed, onFollow }) {
  const { board, date, level } = item;
  const age = priceAge(board.prices_ts, now, board.paused);
  return <article className="sp-outcome-card">
    <div className="sp-card-top"><span className="sp-card-date">{dayLabel(date.expiry)} · 08:00 UTC</span><button className={`sp-bookmark${followed ? " active" : ""}`} aria-label={`${followed ? "Stop following" : "Follow"} ${board.und} at ${money(level.k)}`} aria-pressed={followed} onClick={onFollow}><Bookmark filled={followed} /></button></div>
    <button className="sp-card-level" onClick={() => navigate("outcome", { questionId: level.id })}><span>{board.und} higher or lower than</span><strong>{money(level.k)}</strong></button>
    <div className="sp-card-choices">{["yes", "no"].map((side) => <PriceTile key={side} level={level} side={side} board={board} budget={budget} now={now} onChoose={(chosen) => navigate("outcome", { questionId: level.id, side: chosen, budget })} />)}</div>
    <div className="sp-card-footer"><span>Pays in part <b>{money(level.lo)}–{money(level.hi)}</b></span><span>{age.state === "fresh" ? "" : age.state === "paused" ? "Prices paused" : "Older quote"}{board.thin ? " · Thin book" : ""}</span></div>
  </article>;
}

function PayoutChart({ level, side, ticket, index }) {
  const width = level.hi - level.lo;
  const min = level.lo - width * .75;
  const max = level.hi + width * .75;
  const [settlement, setSettlement] = useState(() => Math.max(min, Math.min(max, index || level.k)));
  useEffect(() => setSettlement(Math.max(min, Math.min(max, index || level.k))), [level.id]);
  const W = 740, H = 254, x = (price) => 52 + (price - min) / (max - min) * 632;
  const maxPay = ticket?.payout || 1;
  const domainMax = Math.max(maxPay, ticket?.mostLose || 0) * 1.03;
  const y = (amount) => 207 - amount / domainMax * 157;
  const path = (answer) => [min, level.lo, level.hi, max].map((price, i) => `${i ? "L" : "M"}${x(price)},${y(payAt(price, level.lo, level.hi, answer) * maxPay)}`).join(" ");
  const current = side && ticket ? outcome(ticket, level, side, settlement) : null;
  const markerPay = payAt(settlement, level.lo, level.hi, side || "yes") * maxPay;
  return <section id="settlement-payout" className="sp-payoff" aria-label="Explore settlement payout">
    <div className="sp-section-head"><div><span className="cp-eyebrow">At settlement</span><h2>See what each price pays.</h2></div><span className="sp-chart-unit">{ticket ? "Total back, in USDC" : "Payout per $1"}</span></div>
    <div className="sp-sim-read"><div><span>If {level.id.split("-")[0]} settles at</span><strong>{money(settlement)}</strong></div>{current ? <><div><span>You get back</span><strong>{usd(current.payout)}</strong></div><div><span>{current.pl > .004 ? "Profit" : current.pl < -.004 ? "Loss" : "Net result"}, after fees</span><strong className={current.pl >= 0 ? "sp-positive" : "sp-negative"}>{signed(current.pl)}</strong></div></> : <div><span>Choose Higher or Lower</span><strong className="sp-sim-hint">to see your dollar result</strong></div>}</div>
    <svg className="sp-payoff-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ticket && side ? `${side === "yes" ? "Higher" : "Lower"} settlement payout in USDC: maximum ${usd(ticket.payout)}. Partial payout between ${money(level.lo)} and ${money(level.hi)}.` : `Settlement payout per $1: Higher increases from zero at ${money(level.lo)} to full payout at ${money(level.hi)}. Lower is the reverse.`}>
      <rect x={x(level.lo)} y="31" width={x(level.hi) - x(level.lo)} height="176" className="sp-partial-zone" />
      {[0, .5, 1].map((part) => <g key={part}><line x1="52" x2="684" y1={y(part * maxPay)} y2={y(part * maxPay)} className="sp-grid-line" /><text x="38" y={y(part * maxPay) + 4} textAnchor="end">{ticket ? Math.round(part * maxPay).toLocaleString("en-US") : part === 0 ? "$0" : `$${part}`}</text></g>)}
      <text x={x(level.k)} y="20" textAnchor="middle" className="sp-chart-note">Partial payout</text>
      {(ticket && side ? [side] : ["yes", "no"]).map((answer) => <path key={answer} d={path(answer)} className={`sp-pay-line ${answer}`} />)}
      {side && ticket && <line x1="52" x2="684" y1={y(ticket.mostLose)} y2={y(ticket.mostLose)} className="sp-cost-line" />}
      <line x1={x(settlement)} x2={x(settlement)} y1="31" y2="207" className="sp-price-line" />
      <circle cx={x(settlement)} cy={y(markerPay)} r="5.5" className={`sp-marker ${side || "yes"}`} />
      {[level.lo, level.hi].map((price) => <text key={price} x={x(price)} y="235" textAnchor="middle">{money(price)}</text>)}
    </svg>
    <input className="sp-settlement-slider" type="range" aria-label="Price at settlement" aria-valuetext={`${money(settlement)}${current ? `: payout ${usd(current.payout)}, net result ${signed(current.pl)}` : ""}`} min={min} max={max} step={width / 200} value={settlement} onChange={(event) => setSettlement(Number(event.target.value))} />
    <div className="sp-chart-key">{(ticket && side ? [side] : ["yes", "no"]).map((answer) => <span className={answer} key={answer}>{answer === "yes" ? "Higher" : "Lower"}</span>)}{side && ticket && <span className="cost">What you pay</span>}<small>Drag to explore the settlement payout.</small></div>
  </section>;
}

function RecordedHistory({ history, level, side, und }) {
  const [mode, setMode] = useState("index");
  const [hover, setHover] = useState(null);
  if (!history?.ts?.length) return <p className="sp-muted">Recorded history is unavailable for this outcome.</p>;
  const row = history.rows?.[level.id];
  const isOutcome = mode === "outcome" && side && row;
  const samples = isOutcome ? (row.i || []).map((at, i) => ({ time: history.ts[at], value: row[side === "yes" ? "yb" : "nb"]?.[i] == null ? null : row[side === "yes" ? "yb" : "nb"][i] * 100, source: at })) : history.ts.map((time, i) => ({ time, value: history.index[i], source: i }));
  const valid = samples.filter((sample) => Number.isFinite(sample.value));
  if (valid.length < 2) return <p className="sp-muted">Not enough recorded prices to draw a history.</p>;
  const low = Math.min(...valid.map((sample) => sample.value)), high = Math.max(...valid.map((sample) => sample.value));
  const pad = (high - low) * .15 || Math.max(high * .001, .01), min = low - pad, max = high + pad;
  const first = samples[0].time, last = samples[samples.length - 1].time;
  const x = (time) => 16 + (time - first) / Math.max(1, last - first) * 626;
  const y = (value) => 20 + (max - value) / (max - min) * 153;
  let pen = false, previous = null;
  const path = samples.map((sample) => { if (!Number.isFinite(sample.value)) { pen = false; previous = sample.source; return ""; } const move = !pen || previous !== null && sample.source !== previous + 1; pen = true; previous = sample.source; return `${move ? "M" : "L"}${x(sample.time)},${y(sample.value)}`; }).join(" ");
  const current = samples[hover ?? samples.length - 1];
  const short = (time) => new Date(time * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return <div className="sp-recorded-history"><div className="sp-history-controls"><div><button aria-pressed={mode === "index"} onClick={() => setMode("index")}>{und} index</button><button disabled={!side || !row} aria-pressed={isOutcome || false} onClick={() => setMode("outcome")}>Outcome price</button></div><span>{isOutcome ? `${side === "yes" ? "Higher" : "Lower"} buy price · cents per $1, before fees` : "Recorded index · USDC"}</span></div>
    <div className="sp-history-read"><strong>{Number.isFinite(current?.value) ? isOutcome ? `${current.value.toFixed(1)}¢` : money(current.value) : "No recorded price"}</strong><span>{stamp(current?.time)}</span></div>
    <svg viewBox="0 0 740 210" role="img" aria-label={`${und} ${isOutcome ? "outcome buy price" : "index"} history, ${short(first)} to ${short(last)}. Missing observations remain gaps.`} onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(), time = first + Math.max(0, Math.min(1, ((event.clientX - box.left) / box.width * 740 - 16) / 626)) * (last - first); let closest = 0; samples.forEach((sample, i) => { if (Math.abs(sample.time - time) < Math.abs(samples[closest].time - time)) closest = i; }); setHover(closest); }} onPointerLeave={() => setHover(null)}>
      {[low, high].map((value) => <g key={value}><line x1="16" x2="642" y1={y(value)} y2={y(value)} className="sp-grid-line" /><text x="732" y={y(value) + 4} textAnchor="end">{isOutcome ? `${value.toFixed(1)}¢` : money(value)}</text></g>)}
      <path d={path} className="sp-recorded-line" />{Number.isFinite(current?.value) && <><line x1={x(current.time)} x2={x(current.time)} y1="20" y2="173" className="sp-price-line" /><circle cx={x(current.time)} cy={y(current.value)} r="4.5" className="sp-recorded-point" /></>}
      <text x="16" y="204">{short(first)}</text><text x="642" y="204" textAnchor="end">{short(last)}</text>
    </svg>
    <input type="range" min="0" max={samples.length - 1} value={hover ?? samples.length - 1} aria-label="Explore recorded price history" aria-valuetext={`${Number.isFinite(current?.value) ? isOutcome ? `${current.value.toFixed(1)} cents` : money(current.value) : "No recorded price"}, ${stamp(current?.time)}`} onChange={(event) => setHover(Number(event.target.value))} />
  </div>;
}

function OutcomeDetail({ item, markets, history, budget, setBudget, side, setSide, now, navigate, followed, onFollow }) {
  const [review, setReview] = useState(false);
  const { board, date, level } = item;
  const age = priceAge(board.prices_ts, now, board.paused);
  const available = side && live(level, side, age.state === "paused", now);
  const ticket = available ? budgetTicket(level, side, budget, board) : null;
  const be = ticket && breakeven(ticket, level, side);
  useEffect(() => setReview(false), [side, budget, level.id]);
  return <div className="sp-page sp-detail-page">
    <button className="sp-text-button sp-back" onClick={() => navigate("saloon")}>← All outcomes</button>
    <div className="sp-detail-heading"><div><div className="sp-subject"><Coin und={board.und} small /><span>Price outcome</span></div><h1>Higher or lower than <em>{money(level.k)}</em>?</h1><p>{dayLabel(date.expiry)} · 08:00 UTC <span>· {board.und} index {money(board.index)}</span></p></div><button className={`sp-save${followed ? " active" : ""}`} aria-pressed={followed} onClick={onFollow}><Bookmark filled={followed} />{followed ? "Following" : "Follow outcome"}</button></div>
    <div className="sp-detail-layout"><div className="sp-detail-main">
      <PayoutChart level={level} side={side} ticket={ticket && !ticket.belowMin ? ticket : null} index={board.index} />
      <section className="sp-payout-rules"><div><span className="sp-rule-name no">Lower pays in full</span><strong>{money(level.lo)} or below</strong></div><div className="sp-rule-partial"><span>Between these prices</span><strong>Both pay in part.</strong></div><div><span className="sp-rule-name yes">Higher pays in full</span><strong>{money(level.hi)} or above</strong></div></section>
      <details className="sp-mechanics sp-history-details"><summary>Recorded price history <span>Coin index & outcome cost</span></summary><RecordedHistory history={history} level={level} side={side} und={board.und} /></details>
      <Research markets={markets} und={board.und} now={now} settleTs={date.settle_ts} navigate={navigate} />
      <details className="sp-mechanics"><summary>How this outcome works <span>Two options. Defined cost.</span></summary><div><p>This outcome is an option spread on Derive, paid in USDC. The two options define the partial-payout range. Derive uses its settlement index averaged from 07:30 to 08:00 UTC.</p><p>Selling back early uses Derive’s sell-back price at that time. The settlement chart does not show early-exit value.</p>{side && <table><caption>Your {side === "yes" ? "Higher" : "Lower"} package</caption><tbody>{(level[side]?.legs || []).map(([name, action, limit]) => <tr key={name}><td>{action === "buy" ? "Buy" : "Sell"}</td><td>{name}</td><td>{usd(limit)}</td></tr>)}</tbody></table>}</div></details>
    </div><aside className="sp-order-panel" aria-label="Your outcome preview">
      <div className="sp-order-head"><span className="cp-eyebrow">Your preview</span><h2>Choose your outcome.</h2></div>
      <div className="sp-detail-choices">{["yes", "no"].map((answer) => <PriceTile key={answer} level={level} side={answer} board={board} budget={budget} now={now} selected={side === answer} onChoose={setSide} />)}</div>
      <label className="sp-budget"><span>Your budget <small>Fees included</small></span><div><span>$</span><input type="number" min="1" max="1000000" step="10" value={budget} onChange={(event) => setBudget(Math.max(0, Math.min(1000000, Number(event.target.value))))} aria-label="Your budget in USDC" /><b>USDC</b></div></label>
      <div className="sp-budget-presets">{[50, 100, 250, 500].map((amount) => <button key={amount} aria-pressed={budget === amount} onClick={() => setBudget(amount)}>{money(amount)}</button>)}</div>
      {ticket && !ticket.belowMin ? <>
        <div className="sp-order-total"><span>You pay <small>Most you can lose</small></span><strong>{usd(ticket.mostLose)}</strong></div>
        <dl className="sp-order-figures"><div><dt>Most it pays <small>Total back</small></dt><dd>{usd(ticket.payout)}</dd></div><div><dt>Most you can make</dt><dd className="sp-positive">{ticket.payout > ticket.mostLose ? signed(ticket.payout - ticket.mostLose) : "None at this price"}</dd></div><div><dt>Breakeven at settlement</dt><dd>{be ? money(be) : "None at this price"}</dd></div><div><dt>Derive fees, about</dt><dd>{usd(ticket.fees)}</dd></div></dl>
        {ticket.capped && <p className="sp-order-notice">Size limits this preview. It uses {usd(ticket.mostLose)} of your {money(budget)} budget.</p>}
      </> : <p className="sp-choose-note">{ticket?.belowMin ? `The smallest amount here is about ${usd(ticket.minTotal)}, fees included.` : side ? noPriceReason(level, side, age.state === "paused") : "Choose Higher or Lower to see your total cost, maximum payout and breakeven."}</p>}
      <div className="sp-mobile-scenarios"><p>Pays in part between {money(level.lo)} and {money(level.hi)}. It can pay $0.</p><button className="sp-text-button" onClick={() => document.getElementById("settlement-payout")?.scrollIntoView({ behavior: "smooth", block: "start" })}>See settlement scenarios ↓</button></div>
      <button className="sp-review-button" disabled={!ticket || ticket.belowMin} onClick={() => setReview((value) => !value)}>{review ? "Close review" : "Review outcome"}<Arrow /></button>
      {review && ticket && <div className="sp-review" role="status"><b>{side === "yes" ? "Higher" : "Lower"} · {usd(ticket.mostLose)} total</b><p>Pays in full {side === "yes" ? `from ${money(level.hi)}` : `at or below ${money(level.lo)}`}. The settlement price determines the payout.</p><span>Prototype preview. No order is sent.</span></div>}
      <p className="sp-quote-time">{age.state === "paused" ? "Prices paused" : age.state === "stale" ? "Older quote" : "Derive quote"} · {clock(board.prices_ts)}<span>Snapshot preview · no live execution</span></p>
    </aside></div>
  </div>;
}

export default function SaloonPrototype({ data, view = "saloon", navigate, selection = {}, followed, setFollowed }) {
  selection = selection || {};
  const boards = Object.values(data?.questions?.coins || {}).filter((board) => Array.isArray(board?.dates));
  const now = Number.isFinite(timestamp(data?.snapshotAt)) ? timestamp(data.snapshotAt) : Math.max(0, ...boards.map((board) => board.prices_ts || 0));
  const [coin, setCoin] = useState("BTC");
  const [expiry, setExpiry] = useState("");
  const [sort, setSort] = useState("near");
  const [budget, setBudget] = useState(100);
  const [side, setSide] = useState(selection.side || null);
  const [onlyFollowing, setOnlyFollowing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const allItems = useMemo(() => boards.flatMap((board) => board.dates.filter((date) => date.board && date.settle_ts > now).flatMap((date) => (date.levels || []).filter((level) => level.ladder === 7 && !["retired", "tail"].includes(level.state)).map((level) => ({ board, date, level })))), [data, now]);
  const board = boards.find((item) => item.und === coin) || boards[0];
  const dates = (board?.dates || []).filter((date) => date.board && date.settle_ts > now);
  const date = dates.find((item) => item.expiry === expiry) || dates[0];
  const selected = allItems.find((item) => item.level.id === selection.questionId) || allItems.filter((item) => item.board.und === "BTC" && ["yes", "no"].some((answer) => live(item.level, answer, false, now))).sort((a, b) => Math.abs(a.level.k - a.board.index) - Math.abs(b.level.k - b.board.index))[0] || allItems[0];
  useEffect(() => { setSide(selection.side || null); if (selection.budget > 0) setBudget(selection.budget); }, [selection.questionId, selection.side, selection.budget]);
  useEffect(() => { if (selection.coin && boards.some((item) => item.und === selection.coin)) { setCoin(selection.coin); setExpiry(""); } }, [selection.coin]);
  useEffect(() => setShowAll(false), [coin, expiry, sort, onlyFollowing]);
  const toggleFollow = (id) => setFollowed((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const list = allItems.filter((item) => item.board.und === board?.und && item.date.expiry === date?.expiry && (!onlyFollowing || followed.has(item.level.id))).sort((a, b) => sort === "level" ? a.level.k - b.level.k : Math.abs(a.level.k - a.board.index) - Math.abs(b.level.k - b.board.index));
  if (!boards.length || !selected) return <div className="sp-page"><h1>Saloon</h1><p>Price outcomes are unavailable in this snapshot.</p></div>;
  if (view === "outcome") return <OutcomeDetail key={selected.level.id} item={selected} markets={data.markets} history={data.questions.histories?.[`${selected.board.und}-${selected.date.expiry}`]} budget={budget} setBudget={setBudget} side={side} setSide={setSide} now={now} navigate={navigate} followed={followed.has(selected.level.id)} onFollow={() => toggleFollow(selected.level.id)} />;
  return <div className="sp-page">
    <header className="sp-page-heading"><div><span className="cp-eyebrow">Trade a view</span><h1>Saloon</h1><p>Choose a price level. Know your cost and payout.</p></div><span className="sp-snapshot-label">Derive snapshot<span>{stamp(board.prices_ts)}</span></span></header>
    <div className="sp-explorer">
      <div className="sp-explorer-top"><div className="sp-coin-tabs" role="group" aria-label="Filter by coin">{boards.map((item) => <button key={item.und} aria-pressed={board.und === item.und} onClick={() => { setCoin(item.und); setExpiry(""); }}><Coin und={item.und} small /></button>)}</div><div className="sp-index"><span>{board.und} index</span><b>{money(board.index)}</b></div></div>
      <div className="sp-explorer-controls"><label className="sp-date-control"><span>Settlement date</span><select value={date?.expiry || ""} onChange={(event) => setExpiry(event.target.value)}>{dates.map((item) => <option key={item.expiry} value={item.expiry}>{dayLabel(item.expiry)} · 08:00 UTC</option>)}</select></label><label className="sp-compact-budget"><span>Compare with</span><div><b>$</b><input type="number" value={budget} min="1" max="1000000" onChange={(event) => setBudget(Math.max(0, Math.min(1000000, Number(event.target.value))))} aria-label="Comparison budget in USDC" /><span>USDC</span></div><small>Fees included</small></label><label className="sp-sort-control"><span>Show levels</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="near">Closest to current price</option><option value="level">Lowest to highest</option></select></label></div>
    </div>
    <div className="sp-results-head"><div className="sp-results-tabs"><button className={!onlyFollowing ? "active" : ""} onClick={() => setOnlyFollowing(false)}>All outcomes <span>{allItems.filter((item) => item.board.und === board?.und && item.date.expiry === date?.expiry).length}</span></button><button className={onlyFollowing ? "active" : ""} onClick={() => setOnlyFollowing(true)}>Following <span>{followed.size}</span></button></div><span>Price per $1 <small>before fees</small> · Total back <small>for your budget</small></span></div>
    {list.length ? <div className="sp-outcomes-grid">{list.slice(0, showAll ? list.length : 6).map((item) => <OutcomeCard key={item.level.id} item={item} budget={budget} now={now} navigate={navigate} followed={followed.has(item.level.id)} onFollow={() => toggleFollow(item.level.id)} />)}</div> : <div className="sp-empty"><h2>No followed outcomes on this date.</h2><p>Save an outcome with its bookmark to find it here.</p><button className="sp-text-button" onClick={() => setOnlyFollowing(false)}>View all outcomes <Arrow /></button></div>}
    {list.length > 6 && <button className="sp-show-levels" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show fewer levels" : `Show all ${list.length} levels`} <span>{showAll ? "−" : "+"}</span></button>}
    <div className="sp-board-note"><span>It can pay in part.</span><p>Higher and Lower are option spreads. A price is what you pay per $1 of maximum payout.</p><button className="sp-text-button" onClick={() => navigate("outcome", { questionId: list[0]?.level.id || selected.level.id })}>Explore a payout <Arrow /></button></div>
    <Research markets={data.markets} und={board.und} now={now} settleTs={date?.settle_ts || now} navigate={navigate} />
  </div>;
}
