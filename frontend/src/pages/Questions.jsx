import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { Info, Loading, Failed, Tabs, Arrow } from "../components/ui.jsx";
import { Asset, CoinIcon } from "../components/MarketVisuals.jsx";
import { ASSET_NAMES } from "../lib/presentation.js";
import { LAYERS, LayerTile } from "../components/Chain.jsx";
import QuestionLadder from "../components/QuestionLadder.jsx";
import PayZone from "../components/PayZone.jsx";
import QuestionChart from "../components/QuestionChart.jsx";
import QuestionTicket from "../components/QuestionTicket.jsx";
import OutcomePreview, { OutcomeFigures, OutcomePayoffStudy } from "../components/OutcomePreview.jsx";
import SaloonHead from "../components/SaloonNotices.jsx";
import { FollowButton, FollowLevel } from "../components/Follow.jsx";
import { loadBudget } from "../lib/follows.js";
import { TESTNET_FILLS, TRADE_ON } from "../lib/flags.js";
import { oneTapOffered } from "../lib/pilot.js";
import { NOT_ON_TESTNET, NOT_ON_TESTNET_WHY, missingLegs, useTestnetListing } from "../lib/testnetLevels.js";
import {
  ANSWER, buyCents, cents, centsDown, countdown, dayLabel, findLevel, fullPay, gap, live, money, noPriceReason, parseId, priceAge,
  budgetTicket, questionText, settlingNow, payAt,
} from "../lib/questions.js";
import "../questions.css";
import "../marketplace-detail.css";
import "../saloon-guided.css";

const clock = (t) => `${new Date(t * 1000).toISOString().slice(11, 16)} UTC`;
const QUICK = [25, 100, 500];

function PriceTime({ pricesTs, age }) {
  if (age.state === "paused") return <span className="q-time warn">Prices paused since {clock(pricesTs)}</span>;
  return (
    <span className={`q-time mono${age.state === "stale" ? " warn" : ""}`}>
      prices {clock(pricesTs)}{age.state === "stale" && ` · ${age.minutes} min old`}
      <Info label="About price times">Prices are read from Derive's screen every 15 minutes and shared with everyone. Derive's screen may have moved since.</Info>
    </span>
  );
}

function ThinNote({ und }) {
  return (
    <span className="q-thin">Thin book
      <Info label={`About ${und}'s thin book`}>Derive's order book for {und} is thinner than for BTC and ETH: less size at each price, and a wider gap between buying and selling back. Its questions pass looser checks (up to 8c over Derive's mark, from $25 at the top of the book) so that they can show at all.</Info>
    </span>
  );
}

function ZoneNote({ und, date, index }) {
  const half = date.zone / 2;
  const share = ((date.zone / index) * 100).toFixed(1);
  return (
    <p className="q-foot">
      <span className="q-foot-zone">Pays in part within {money(half)} either side
        <Info label="About the pay zone">Each level pays in part within {money(half)} either side: a zone of {money(date.zone)}, {share}% of {und}'s price. Above the zone Higher pays $1 and Lower nothing; below it, the reverse; in between each pays part of it, in a straight line. A wider zone costs less on Derive's screen; a narrower one is closer to all or nothing.</Info>
      </span>
    </p>
  );
}

function Settled({ board }) {
  const rows = (board.settled || []).filter((s) => s.settle_price != null);
  if (!rows.length) return null;
  return (
    <details className="q-settled">
      <summary>Settled</summary>
      {rows.map((s) => (
        <div key={s.expiry} className="q-settled-date">
          <span className="label">{s.label} · settled {money(s.settle_price)}</span>
          {s.levels.map((lv) => (
            <Link key={lv.id} to={`/q/${lv.id}`} className="q-settled-row">
              <span>Higher or lower than <b className="mono">{money(lv.k)}</b></span>
              <span className="mono">Higher paid {cents(Math.round(lv.paid * 100))}</span>
            </Link>
          ))}
        </div>
      ))}
    </details>
  );
}

/** The coin's research, one tap away: its three layers now and a large way into the coin's page
 * (the reverse of the coin page's "in the Saloon" card). */
function Context({ und, days }) {
  const { data } = useData("markets.json");
  const row = data?.coins?.find((c) => c.und === und);
  const h = days <= 10 ? "7d" : "30d";
  return (
    <section className="q-context md-context" aria-label="Context, not advice">
      <h2 className="md-context-title">Context, not advice
        <Info label="About the context">What Cowboy's three layers show for {und} now, for the next {h === "7d" ? "7" : "30"} days: regime, wallets and options. They describe the market; they do not choose an answer.</Info>
      </h2>
      <Link className="md-coin-cta" to={`/coin/${und}#regime`}>
        <CoinIcon und={und} />
        <span className="md-coin-cta-text"><b>Open {und}</b><small>{ASSET_NAMES[und] || und} · chart and data</small></span>
        <span className="md-coin-cta-readings">{LAYERS.map(([kind, name]) => (
          <span key={kind} className="md-context-reading"><small>{name}</small>
            <LayerTile alignment={row?.align} horizon={h} kind={kind} icon={false} />
          </span>
        ))}</span>
        <span className="md-coin-cta-go" aria-hidden="true"><Arrow /></span>
      </Link>
    </section>
  );
}

function Rules({ und }) {
  return (
    <Info label="Rules">
      Each answer is two Derive options on {und}: one bought, one sold, both expiring on the date shown. Derive settles them in USDC on the average {und} index over the 30 minutes to 08:00 UTC, with no action from you. A settlement inside the zone pays part of the $1; that is normal. You can sell back on Derive at any time until a minute before 08:00 UTC; holding is fine too. Derive's fees apply per option. Cowboy shows prices from Derive's screen and places nothing. Derive is not open to everyone: its terms list who may not use it.
    </Info>
  );
}

function SettledView({ und, level, price, paid, expiry }) {
  return (
    <div className="q-settled-view">
      <p className="q-big mono">Settled {money(price)}</p>
      <p>Higher paid <b className="mono">{cents(Math.round(paid * 100))}</b> per $1 · Lower paid <b className="mono">{cents(100 - Math.round(paid * 100))}</b></p>
      <PayZone lo={level.lo} hi={level.hi} index={price} />
      <p className="status">{und} settled on {dayLabel(expiry)} at the 30-minute average to 08:00 UTC.</p>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** The phone ticket sheet is a dialog: focus moves into it on open, Tab stays inside, Escape closes
 * it, and focus returns to the button that opened it. Wide screens keep the ticket in the page. */
export function useSheetFocus(open, sheetRef, openerRef, close) {
  useEffect(() => {
    const el = sheetRef.current;
    const modal = typeof matchMedia !== "function" || matchMedia("(max-width: 1279px)").matches;
    if (!open || !el || !modal) return undefined;
    const items = () => [...el.querySelectorAll(FOCUSABLE)]
      .filter((x) => !x.closest(".sr-only") && !(x.tagName !== "SUMMARY" && x.closest("details:not([open])")));
    (items()[0] || el).focus?.();
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const list = items();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    const back = openerRef.current;
    return () => { document.removeEventListener("keydown", key); back?.focus?.(); };
  }, [open]);
}

/** No price for a side, with the reason in an (i). */
export function NoPrice({ level, side, paused, text = "No price now" }) {
  return (
    <span className="q-noprice">{text}
      <Info label={`Why ${ANSWER[side]} has no price`}>{noPriceReason(level, side, paused)}</Info>
    </span>
  );
}

function Step({ n, title, children, className = "", stepRef }) {
  return (
    <section ref={stepRef} className={`q-step ${className}`} aria-label={title}>
      <h2 className="q-step-head"><span className="q-step-n mono" aria-hidden="true">{n}</span>{title}</h2>
      {children}
    </section>
  );
}

/** The step's one primary action, with the chosen answer, amount and most you can lose beside it.
 * In the page on wide screens; a bar fixed to the bottom of the screen on phones. */
function ActionBar({ und, level, sideKey, date, t, label, onGo, disabled, hidden, goRef }) {
  return (
    <div className={`q-actbar${hidden ? " hide" : ""}`} aria-label="Your answer">
      <span className="q-actbar-sum">
        <b>{ANSWER[sideKey]} · {money(level.k)}<span className="q-actbar-date"> · {date.label}</span></b>
        <small className="mono">{t ? <>most you can lose {money(t.mostLose, { cents: true })}<span className="q-actbar-amt"> · fees included</span></> : "No price now"}</small>
      </span>
      <button ref={goRef} className="btn primary lg q-get" onClick={onGo} disabled={disabled}>{label}</button>
    </div>
  );
}

/** The question's price history per $1, folded away: evidence, not a step of the trade. */
function History({ und, date, level, sideKey, theme }) {
  const [open, setOpen] = useState(false);
  const { data: hist } = useData(open ? `questions/history/${und}-${date.expiry}.json` : null, 15 * 60_000);
  return (
    <details className="q-history" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Price history</summary>
      {open && <QuestionChart hist={hist} id={level.id} side={sideKey || "yes"} level={level} und={und} theme={theme} />}
    </details>
  );
}

const scrollTo = (el) => el?.scrollIntoView?.({ block: "start", behavior: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

/** The board's detail page keeps the choice, amount and payout together. Only the final order
 * review opens a ticket; prices, fees, available size and time gates use the same guided maths. */
function OutcomeDetail({ und, board, found, sideKey, setSide, age, theme, renderLadder, ladderOpen, onLadder, initialDollars }) {
  const { date, level } = found;
  const question = questionText(und, level, date.expiry);
  const paused = age.state === "paused" || board.paused;
  const settling = settlingNow(level);
  const [dollars, setDollars] = useState(() => Number.isFinite(initialDollars) && initialDollars > 0 ? initialDollars : loadBudget());
  const [sheet, setSheet] = useState(false);
  const { data: hist, error: historyError } = useData(`questions/history/${und}-${date.expiry}.json`, 15 * 60_000);
  const t = !settling && sideKey && live(level, sideKey, paused) ? budgetTicket(level, sideKey, dollars, board) : null;
  const ready = t && !t.belowMin;
  // Testnet builds: one tap needs the level's options listed on Derive's testnet (by hand stays open).
  const listed = useTestnetListing(TESTNET_FILLS && sideKey ? und : null);
  const offTestnet = TESTNET_FILLS && !!sideKey && missingLegs(level.id, sideKey, listed).length > 0;
  const sheetRef = useRef(null);
  const opener = useRef(null);
  useSheetFocus(sheet && ready, sheetRef, opener, () => setSheet(false));
  useEffect(() => { if (!ready) setSheet(false); }, [ready]);
  const choose = (side) => { setSheet(false); setSide(side); };
  const place = () => {
    setSheet(true);
    requestAnimationFrame(() => sheetRef.current?.querySelector("button, a")?.focus?.());
  };
  return (
    <div className={`md-detail${sideKey && !settling ? " md-chosen" : ""}`}>
      <header className="md-heading">
        <Link className="md-back" to="/saloon">‹ All outcomes</Link>
        <div className="md-subject"><Asset und={und} compact /><span>Price outcome</span>{board.thin && <ThinNote und={und} />}</div>
        <h1 className="q-title">{question}</h1>
        <p className="q-settles">Settles {dayLabel(date.expiry)}, 08:00 UTC{countdown(date.settle_ts) && <> · {countdown(date.settle_ts)}</>}
          <Info label="About settlement">Derive settles on the average {und} index over the 30 minutes to 08:00 UTC. The two options pay in USDC to your Derive account with no action from you.</Info>
        </p>
        {sideKey && !settling && <div className="q-follow md-follow"><FollowButton id={level.id} side={sideKey} k={level.k} board={board} /><FollowLevel id={level.id} side={sideKey} /></div>}
      </header>

      <div className="md-evidence">
        <section className="md-history" aria-label="Price history">
          <div className="md-section-heading"><div><span className="label">{und} index now</span><strong className="mono">{money(board.index)}</strong></div><PriceTime pricesTs={board.prices_ts} age={age} /></div>
          <div className="md-history-key"><span>Price history</span><Info label="About the price chart">Question shows Derive's mark, buy and sell-back prices in cents per $1 of maximum payout for {ANSWER[sideKey || "yes"]}. Select {und} to see the coin's index instead. These are prices, not a measure of how often an outcome happens.</Info></div>
          {historyError && !hist ? <p className="status">Price history is unavailable right now.</p> : <QuestionChart hist={hist} id={level.id} side={sideKey || "yes"} level={level} und={und} theme={theme} />}
        </section>
        <Context und={und} days={(date.settle_ts - Date.now() / 1000) / 86400} />
        {t && <section className="md-payoff-study" aria-label="Settlement payout"><h2>What it pays at settlement</h2><OutcomePayoffStudy und={und} level={level} side={sideKey} t={t} index={board.index} expiry={date.expiry} /></section>}
        <section className="md-settlement" aria-label="How settlement works">
          <div className="md-section-heading"><h2>It can pay in part.</h2><Rules und={und} /></div>
          <p>Between <b className="mono">{money(level.lo)}</b> and <b className="mono">{money(level.hi)}</b>, each answer pays a share of $1. The settlement price determines how much.</p>
          <div className="md-boundaries"><div><span className="md-lower">Lower pays in full</span><b className="mono">{money(level.lo)} or below</b></div><div><span className="md-higher">Higher pays in full</span><b className="mono">{money(level.hi)} or above</b></div></div>
          <ZoneNote und={und} date={date} index={board.index} />
        </section>
        <section className="md-other"><button className="text-control q-other" aria-expanded={ladderOpen} onClick={onLadder}>{ladderOpen ? "Hide other levels" : "Other levels"}</button>{ladderOpen && renderLadder(dollars)}</section>
      </div>

      <aside className="md-selection" aria-label="Your outcome">
        <div className="md-selection-inner">
          <div className="md-selection-title"><h2>Choose your outcome</h2><span>Cost per $1 of max. payout<Info label="About the answer price">The amount shown buys up to $1 of payout at settlement, before Derive's fees. An answer can pay nothing, part of $1, or the full $1, depending on the settlement price.</Info></span></div>
          {settling ? <p className="q-big">Settling · average from 07:30 to 08:00 UTC</p> : <>
            <div className="q-pick md-pick" role="radiogroup" aria-label="Answer">
              {["yes", "no"].map((side) => {
                const c = buyCents(level, side, paused);
                return <button key={side} role="radio" aria-checked={sideKey === side} className={`q-pick-btn ${side}${sideKey === side ? " on" : ""}`}
                  aria-label={`${ANSWER[side]}, ${fullPay(level, side)}, ${c != null ? `${c} cents per $1` : "no price now"}`} onClick={() => choose(side)}>
                  <span className="q-pick-name"><i className={`q-arrow ${side}`} aria-hidden="true" />{ANSWER[side]}</span><b className="mono">{c != null ? cents(c) : <small>No price now</small>}</b>
                  <span className="q-pick-zone"><small>{fullPay(level, side)}</small></span>
                </button>;
              })}
            </div>
            {!sideKey ? <div className="md-unpicked"><p>Choose Higher or Lower to see your cost and payout.</p><small>Nothing is selected for you.</small></div> : <>
              <section className="q-amount md-amount" aria-label="Amount" hidden={sheet}>
                <div className="q-amount-in"><label htmlFor="q-dollars" className="label">Amount, fees included<Info label="About the amount">The total you spend, Derive's fees included. Cowboy sizes the two options so their price plus Derive's fees fit this amount; what is left over from rounding stays with you.</Info></label>
                  <span className="q-dollar-field"><span>$</span><input id="q-dollars" inputMode="decimal" value={dollars} onChange={(e) => setDollars(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0))} /></span>
                  <span className="q-quick">{QUICK.map((v) => <button key={v} className="text-control" aria-pressed={dollars === v} onClick={() => setDollars(v)}>${v}</button>)}</span>
                </div>
                {t ? <>
                  {t.belowMin && <p className="q-note warn">Smallest amount for this question: {money(t.minTotal, { cents: true })} with Derive's fees.</p>}
                  {t.capped && <p className="q-note">Up to {money(t.capPayout)} of payout at this price; more costs more.</p>}
                  {t.mostLose > 0 && t.mostLose < 50 && <p className="q-note">Fees are a large share of small amounts.</p>}
                  <section className="md-preview" aria-label="What it pays"><OutcomeFigures und={und} level={level} side={sideKey} t={t} expiry={date.expiry} settleTs={date.settle_ts} summary compact /><p className="md-loss-note">Your cost is the most you can lose once both orders fill.</p></section>
                </> : <p className="status"><NoPrice level={level} side={sideKey} paused={paused} text={`No price now for ${ANSWER[sideKey]}`} /></p>}
                {age.state === "stale" && <p className="q-note warn">Prices are {age.minutes} min old. Check Derive's screen before placing orders.</p>}
                {offTestnet && <p className="q-note"><span className="q-noprice">{NOT_ON_TESTNET}<Info label={`Why ${ANSWER[sideKey]} at ${money(level.k)} is not on testnet`}>{NOT_ON_TESTNET_WHY}</Info></span></p>}
                <div className="md-review-action"><button ref={opener} className="btn primary lg" disabled={!ready} onClick={place}>Review orders</button><small>{oneTapOffered() ? "One tap: both options at one price, or nothing." : "One-tap trading is coming. For now, two orders on Derive."}</small></div>
              </section>
              {sheet && ready && <div ref={sheetRef} className="q-sheet open md-ticket" role="dialog" aria-modal={typeof matchMedia !== "function" || matchMedia("(max-width: 1279px)").matches ? "true" : undefined} aria-label="Ticket">
                <button className="text-control q-sheet-close" onClick={() => setSheet(false)}>Back to payout</button>
                <QuestionTicket und={und} question={question} answer={ANSWER[sideKey]} level={level} sideKey={sideKey} t={t} board={board} pricesTs={board.prices_ts} settleTs={date.settle_ts} expiry={date.expiry} stale={age.state === "stale"} />
              </div>}
            </>}
          </>}
        </div>
      </aside>
    </div>
  );
}

/** The guided flow from step 3: Higher or Lower (never picked for the user), then the amount, then
 * what it pays, then the orders for Derive. One primary action per step. The full ladder of levels
 * sits under "Other levels". */
function QuestionView({ und, board, found, sideKey, setSide, age, theme, lead, ladder, ladderOpen, onLadder, initialStep, initialDollars }) {
  const { date, level } = found;
  const question = questionText(und, level, date.expiry);
  const paused = age.state === "paused" || board.paused;
  // The first amount: the board's budget when opened from it, else the budget kept in this browser.
  // An amount is the total spend, Derive's fees included (budgetTicket), as on the board.
  const [dollars, setDollars] = useState(() => (Number.isFinite(initialDollars) && initialDollars > 0 ? initialDollars : loadBudget()));
  const [sheet, setSheet] = useState(false);
  const [step, setStep] = useState(() => (sideKey ? initialStep || "preview" : "pick"));
  const t = sideKey && live(level, sideKey, paused) ? budgetTicket(level, sideKey, dollars, board) : null;
  const side = sideKey ? level[sideKey] : null;
  const settling = settlingNow(level); // by the clock now, from 07:30 UTC
  const days = (date.settle_ts - Date.now() / 1000) / 86400;
  const sz = side?.size;
  const ready = t && !t.belowMin;
  const sheetRef = useRef(null);
  const opener = useRef(null);
  const amountRef = useRef(null);
  const previewRef = useRef(null);
  useSheetFocus(sheet, sheetRef, opener, () => setSheet(false));
  useEffect(() => { if (initialStep === "amount") scrollTo(amountRef.current); }, []);
  const pick = (k) => { setSide(k); if (step === "pick") setStep("amount"); };
  const preview = () => { setStep("preview"); requestAnimationFrame(() => scrollTo(previewRef.current)); };
  const place = () => {
    setSheet(true);
    // Wide screens show the ticket beside the flow: move focus to it.
    if (typeof matchMedia === "function" && !matchMedia("(max-width: 1279px)").matches) sheetRef.current?.querySelector("a, button")?.focus?.();
  };
  const showPreview = !settling && sideKey && step === "preview";
  const bar = !settling && sideKey && (
    <ActionBar und={und} level={level} sideKey={sideKey} date={date} t={t} hidden={sheet}
      label={step === "preview" ? "Place on Derive" : "See what it pays"} goRef={step === "preview" ? opener : null}
      onGo={step === "preview" ? place : preview} disabled={step === "preview" ? !ready : !t} />
  );
  return (
    <div className={`q-layout${sideKey && !settling ? " has-bar" : ""}`}>
      <div className="q-flow">
        {lead}
        <Step n={3} title="Higher or lower" className="q-step-pick">
          <article className="q-view" aria-label={question}>
            <h1 className="q-title">{question}</h1>
            <p className="q-settles">Settles {dayLabel(date.expiry)}, 08:00 UTC{countdown(date.settle_ts) && <> · {countdown(date.settle_ts)}</>}
              <Info label="About settlement">Derive settles on the average {und} index over the 30 minutes to 08:00 UTC. What the answer pays is then paid in USDC to your Derive account with no action from you.</Info>
            </p>
            {settling ? <p className="q-big">Settling · average from 07:30 to 08:00 UTC</p> : (
              <div className="q-pick" role="radiogroup" aria-label="Answer">
                {["yes", "no"].map((k) => {
                  const c = buyCents(level, k, paused);
                  return (
                    <button key={k} role="radio" aria-checked={sideKey === k} className={`q-pick-btn${sideKey === k ? " on" : ""}`}
                      aria-label={`${ANSWER[k]}, ${fullPay(level, k)}, ${c != null ? `${c} cents per $1` : "no price now"}`}
                      onClick={() => pick(k)}>
                      <span className="q-pick-name"><i className={`q-arrow ${k}`} aria-hidden="true" />{ANSWER[k]}</span>
                      <span className="q-pick-zone"><PayZone lo={level.lo} hi={level.hi} side={k} index={board.index} compact /><small>{fullPay(level, k)}</small></span>
                      <b className="mono">{c != null ? cents(c) : <small>No price now</small>}</b>
                    </button>
                  );
                })}
              </div>
            )}
            {!settling && !sideKey && <p className="status q-hint">Pick Higher or Lower. Nothing is picked for you.</p>}
            {sideKey && (
              <p className="q-follow">
                <FollowButton id={level.id} side={sideKey} k={level.k} board={board} />
                <FollowLevel id={level.id} side={sideKey} />
              </p>
            )}
          </article>
          <ZoneNote und={und} date={date} index={board.index} />
          <button className="text-control q-other" aria-expanded={ladderOpen} onClick={onLadder}>{ladderOpen ? "Hide other levels" : "Other levels"}</button>
          {ladderOpen && ladder}
        </Step>
        {!settling && sideKey && (
          <Step n={4} title="Amount" stepRef={amountRef} className="q-step-amount">
            <div className="q-amount">
              <div className="q-amount-in">
                <label htmlFor="q-dollars" className="label">Amount, fees included
                  <Info label="About the amount">The total you spend, Derive's fees included. Cowboy sizes the two options so their price plus Derive's fees fit this amount; what is left over from rounding stays with you.</Info>
                </label>
                <span className="q-dollar-field"><span>$</span>
                  <input id="q-dollars" inputMode="decimal" value={dollars} onChange={(e) => setDollars(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0))} />
                </span>
                <span className="q-quick">{QUICK.map((v) => <button key={v} className="text-control" aria-pressed={dollars === v} onClick={() => setDollars(v)}>${v}</button>)}</span>
              </div>
              {t ? (
                <>
                  {t.belowMin && <p className="q-note warn">Smallest amount for this question: {money(t.minTotal, { cents: true })} with Derive's fees.</p>}
                  {t.capped && <p className="q-note">Up to {money(t.capPayout)} of payout at this price; more costs more.</p>}
                  {t.mostLose > 0 && t.mostLose < 50 && <p className="q-note">Fees are a large share of small amounts.</p>}
                </>
              ) : (
                <>
                  <p className="status"><NoPrice level={level} side={sideKey} paused={paused} text={`No price now for ${ANSWER[sideKey]}`} /></p>
                  <PayZone lo={level.lo} hi={level.hi} side={sideKey} index={board.index} />
                </>
              )}
            </div>
            {step !== "preview" && bar}
          </Step>
        )}
        {showPreview && t && (
          <Step n={5} title="What it pays" stepRef={previewRef} className="q-step-preview">
            <section className="q-amount q-preview" aria-label="Outcome preview">
              <OutcomePreview und={und} level={level} side={sideKey} t={t} expiry={date.expiry} settleTs={date.settle_ts} index={board.index} />
            </section>
            {bar}
          </Step>
        )}
        <Context und={und} days={days} />
        <History und={und} date={date} level={level} sideKey={sideKey} theme={theme} />
        <p className="q-small mono">
          <span>Rules<Rules und={und} /></span>
          {sz != null && <span>Size at this price: up to {money(sz)}</span>}
          {side && gap(side) != null && <span>Gap {gap(side)}c<Info label="About the gap">What buying and then selling straight back costs on Derive's screen right now: buy {cents(buyCents(level, sideKey, paused))}, sell back {cents(centsDown(side?.sell))}. It is why Higher and Lower add up to more than $1. Mark on Derive {cents(Math.round((sideKey === "yes" ? level.fair : 1 - level.fair) * 100))}.</Info></span>}
        </p>
      </div>
      <aside className="q-aside">
        {showPreview && ready ? (
          <div ref={sheetRef} className={`q-sheet${sheet ? " open" : ""}`} role={sheet ? "dialog" : undefined} aria-modal={sheet ? "true" : undefined} aria-label="Ticket">
            <button className="text-control q-sheet-close" onClick={() => setSheet(false)}>Close</button>
            <QuestionTicket und={und} question={question} answer={ANSWER[sideKey]} level={level} sideKey={sideKey} t={t} board={board}
              pricesTs={board.prices_ts} settleTs={date.settle_ts} expiry={date.expiry} stale={age.state === "stale"} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}

/** An id that is no longer on the board: its date's history file still has its settlement. */
function OldQuestion({ id, onBack }) {
  const p = parseId(id);
  const { data: hist, error } = useData(p ? `questions/history/${p.und}-${p.expiry}.json` : null, 30 * 60_000);
  if (!p) return <p className="status">Unknown question.</p>;
  if (error && !hist) return <p className="status">This question is no longer published.</p>;
  if (!hist) return <Loading />;
  const lv = { ...p, id };
  return (
    <article className="q-view">
      <button className="text-control q-back" onClick={onBack}>‹ {p.und}</button>
      <h1 className="q-title">{questionText(p.und, lv, p.expiry)}</h1>
      {hist.settle_price != null ? <SettledView und={p.und} level={lv} price={hist.settle_price} paid={payAt(hist.settle_price, p.lo, p.hi)} expiry={p.expiry} />
        : <p className="status">Off the board now. It settles {dayLabel(p.expiry)}, 08:00 UTC.</p>}
      <QuestionChart hist={hist} id={id} side="yes" level={lv} und={p.und} />
    </article>
  );
}

export default function Questions() {
  const { und: undParam, id } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const { theme } = useOutletContext() || {};
  const parsed = id ? parseId(id) : null;
  const { data: index, error: indexError } = useData("questions/index.json");
  const und = parsed?.und || undParam || index?.coins?.[0]?.und;
  const { data: board, error } = useData(und ? `questions/${und}.json` : null);
  const [pickedDate, setPickedDate] = useState(null);
  const [more, setMore] = useState(false);
  const [ladder, setLadder] = useState(false);
  const location = useLocation();
  const sideParam = search.get("side");
  const sideKey = sideParam === "no" || sideParam === "yes" ? sideParam : null; // never picked for the user
  const setSide = (k) => setSearch((s) => { const n = new URLSearchParams(s); n.set("side", k); return n; }, { replace: true });
  useEffect(() => { setPickedDate(null); setMore(false); setLadder(false); }, [und]);

  if (indexError && !index) return <div className="wrap page"><Failed error={indexError} /></div>;
  if (!index || (und && !board && !error)) return <div className="wrap page"><Loading /></div>;
  const coins = index.coins || [];
  if (!und || (error && !board)) {
    return <div className="wrap page q-page"><SaloonHead view="guided" /><p className="status">No questions with a price on Derive's screen right now.</p></div>;
  }
  const age = priceAge(board.prices_ts, Date.now() / 1000, board.paused || index.paused);
  const paused = age.state === "paused";
  const dates = board.dates.filter((d) => d.board);
  const chosen = id ? findLevel(board, id) : null;
  // Default tab: the nearest date whose headline can be bought on both sides, else the nearest with
  // any live answer, else the nearest.
  const liveHead = (d) => { const h = d.levels.find((x) => x.id === d.headline); return h && live(h, "yes", paused) && live(h, "no", paused); };
  const anyLive = (d) => d.levels.some((x) => x.ladder === 7 && (live(x, "yes", paused) || live(x, "no", paused)));
  const fallback = (dates.find(liveHead) || dates.find(anyLive) || dates[0])?.expiry;
  const expiry = chosen?.date?.expiry || pickedDate || fallback;
  const date = dates.find((d) => d.expiry === expiry) || dates[0];
  // The flow opens on the date's headline level; "Other levels" opens the full ladder.
  const found = chosen || (date?.headline ? findLevel(board, date.headline) : null);
  const coinItems = (coins.some((c) => c.und === und) ? coins : [...coins, { und }]).map((c) => [c.und, c.und]);
  const back = () => navigate(`/saloon/${und}`);
  const thin = board.thin;
  // Picking a row in the ladder opens that level at the amount step, the ladder folded away.
  const onPick = (e, lv, k, dollars) => {
    e.preventDefault();
    setLadder(false);
    navigate(`/q/${lv.id}?side=${k}`, { state: { step: "amount", ...(Number.isFinite(dollars) && dollars > 0 ? { dollars } : {}) } });
  };
  const lead = (
    <>
      <Step n={1} title="Coin" className="q-step-coin">
        <Tabs label="Coin" value={und} onChange={(u) => navigate(`/saloon/${u}`)} items={coinItems} />
        <div className="q-coin">
          <Asset und={und} compact />
          <b className="mono q-index">{money(board.index)}</b>
          {thin && <ThinNote und={und} />}
          <PriceTime pricesTs={board.prices_ts} age={age} />
        </div>
      </Step>
      {dates.length > 0 && (
        <Step n={2} title="Date" className="q-step-date">
          <div className="q-dates">
            <Tabs label="Settlement date" value={date.expiry} onChange={(e) => { setPickedDate(e); navigate(`/saloon/${und}`); }}
              items={dates.map((d) => [d.expiry, d.label])} />
          </div>
        </Step>
      )}
    </>
  );
  const renderLadder = (dollars) => date && (
    <div className="q-board" aria-label={`${und} levels`}>
      <QuestionLadder board={board} date={date} more={more} onMore={() => setMore((m) => !m)} paused={paused}
        selectedId={found?.level?.id} selectedSide={sideKey} onPick={(e, lv, k) => onPick(e, lv, k, dollars)} />
    </div>
  );
  const ladderEl = renderLadder();
  return (
    <div className={`wrap page q-page${id ? " md-page" : " q-guided"}`}>
      {!id && <SaloonHead view="guided" />}
      {found && !found.settled ? (
        id ? <OutcomeDetail key={found.level.id} und={und} board={board} found={found} sideKey={sideKey} setSide={setSide} age={age} theme={theme}
          renderLadder={renderLadder} ladderOpen={ladder} onLadder={() => setLadder((o) => !o)} initialDollars={location.state?.dollars} /> :
        <QuestionView key={found.level.id} und={und} board={board} found={found} sideKey={sideKey} setSide={setSide} age={age} theme={theme}
          lead={lead} ladder={ladderEl} ladderOpen={ladder} onLadder={() => setLadder((o) => !o)} initialStep={location.state?.step}
          initialDollars={location.state?.dollars} />
      ) : (
        <div className="q-layout">
          <div className="q-flow">
            {lead}
            {found?.settled ? (
              <article className="q-view">
                <h1 className="q-title">{questionText(und, found.level, found.date.expiry)}</h1>
                {found.date.settle_price != null ? <SettledView und={und} level={found.level} price={found.date.settle_price} paid={found.level.paid} expiry={found.date.expiry} />
                  : <p className="q-big">Settling · average from 07:30 to 08:00 UTC</p>}
                <button className="text-control" onClick={back}>Back to {und}'s open dates</button>
              </article>
            ) : id ? <OldQuestion id={id} onBack={back} /> : dates.length ? ladderEl
              : <p className="status">No dates with a price on Derive's screen right now.</p>}
          </div>
        </div>
      )}
      <Settled board={board} />
    </div>
  );
}
