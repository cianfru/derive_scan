import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { Info, Loading, Failed, Tabs } from "../components/ui.jsx";
import { Asset } from "../components/MarketVisuals.jsx";
import Chain from "../components/Chain.jsx";
import QuestionLadder from "../components/QuestionLadder.jsx";
import PayZone from "../components/PayZone.jsx";
import QuestionChart from "../components/QuestionChart.jsx";
import QuestionTicket from "../components/QuestionTicket.jsx";
import OutcomePreview from "../components/OutcomePreview.jsx";
import {
  ANSWER, buyCents, cents, centsDown, countdown, dayLabel, findLevel, fullPay, gap, live, money, noPriceReason, parseId, priceAge,
  questionText, ticket, payAt,
} from "../lib/questions.js";
import { loadPositions } from "../lib/positions.js";
import "../questions.css";

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
      Settles {dayLabel(date.expiry)}, 08:00 UTC{countdown(date.settle_ts) && <> · {countdown(date.settle_ts)}</>}
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

function Context({ und, days }) {
  const { data } = useData("markets.json");
  const row = data?.coins?.find((c) => c.und === und);
  const h = days <= 10 ? "7d" : "30d";
  return (
    <section className="q-context" aria-label="Context, not advice">
      <h3 className="label">Context, not advice
        <Info label="About the context">What Cowboy's three layers show for {und} now, for the next {h === "7d" ? "7" : "30"} days. They describe the market; they do not choose an answer.</Info>
      </h3>
      {row?.align ? <Chain alignment={row.align} horizon={h} linked={false} compact /> : <p className="status">Unavailable</p>}
      <Link className="text-link" to={`/coin/${und}#regime`}>Open {und}</Link>
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
 * it, and focus returns to the button that opened it. Wide screens show the ticket as a column. */
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

/** The question: the two answers (none picked until the user picks), then for the picked one the
 * amount, the outcome preview and the action; the ticket only once an answer is picked. */
function QuestionView({ und, board, found, sideKey, setSide, age, theme, onBack }) {
  const { date, level } = found;
  const question = questionText(und, level, date.expiry);
  const paused = age.state === "paused" || board.paused;
  const [dollars, setDollars] = useState(100);
  const [sheet, setSheet] = useState(false);
  const { data: hist } = useData(`questions/history/${und}-${date.expiry}.json`, 15 * 60_000);
  const t = sideKey && live(level, sideKey, paused) ? ticket(level, sideKey, dollars, board) : null;
  const side = sideKey ? level[sideKey] : null;
  const settling = level.state === "settling";
  const days = (date.settle_ts - Date.now() / 1000) / 86400;
  const sz = side?.size;
  const ready = t && !t.belowMin;
  const sheetRef = useRef(null);
  const opener = useRef(null);
  useSheetFocus(sheet, sheetRef, opener, () => setSheet(false));
  return (
    <article className="q-view" aria-label={question}>
      <button className="text-control q-back" onClick={onBack}>‹ {und} · {date.label}</button>
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
                onClick={() => setSide(k)}>
                <span className="q-pick-name"><i className={`q-arrow ${k}`} aria-hidden="true" />{ANSWER[k]}</span>
                <span className="q-pick-zone"><PayZone lo={level.lo} hi={level.hi} side={k} index={board.index} compact /><small>{fullPay(level, k)}</small></span>
                <b className="mono">{c != null ? cents(c) : <small>No price now</small>}</b>
              </button>
            );
          })}
        </div>
      )}
      {!settling && !sideKey && <p className="status q-hint">Pick Higher or Lower to see what you pay, what it pays, and the orders for Derive.</p>}
      {!settling && sideKey && (
        <section className="q-amount" aria-label="Amount">
          <div className="q-amount-in">
            <label htmlFor="q-dollars" className="label">Amount</label>
            <span className="q-dollar-field"><span>$</span>
              <input id="q-dollars" inputMode="decimal" value={dollars} onChange={(e) => setDollars(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0))} />
            </span>
            <span className="q-quick">{QUICK.map((v) => <button key={v} className="text-control" aria-pressed={dollars === v} onClick={() => setDollars(v)}>${v}</button>)}</span>
          </div>
          {t ? (
            <>
              {t.belowMin && <p className="q-note warn">Smallest amount for this question: {money(t.minCost, { cents: true })}.</p>}
              {t.capped && <p className="q-note">Up to {money(t.capPayout)} of payout at this price; more costs more.</p>}
              {t.premium > 0 && t.premium < 50 && <p className="q-note">Fees are a large share of small amounts.</p>}
              <OutcomePreview und={und} level={level} side={sideKey} t={t} expiry={date.expiry} settleTs={date.settle_ts} index={board.index} />
            </>
          ) : (
            <>
              <p className="status"><NoPrice level={level} side={sideKey} paused={paused} text={`No price now for ${ANSWER[sideKey]}`} /></p>
              <PayZone lo={level.lo} hi={level.hi} side={sideKey} index={board.index} />
            </>
          )}
          {ready && <button ref={opener} className="btn primary lg q-get" onClick={() => setSheet(true)}>Place on Derive</button>}
        </section>
      )}
      <QuestionChart hist={hist} id={level.id} side={sideKey || "yes"} level={level} und={und} theme={theme} />
      <Context und={und} days={days} />
      <p className="q-small mono">
        <span>Rules<Rules und={und} /></span>
        {sz != null && <span>Size at this price: up to {money(sz)}</span>}
        {side && gap(side) != null && <span>Gap {gap(side)}c<Info label="About the gap">What buying and then selling straight back costs on Derive's screen right now: buy {cents(buyCents(level, sideKey, paused))}, sell back {cents(centsDown(side?.sell))}. It is why Higher and Lower add up to more than $1. Mark on Derive {cents(Math.round((sideKey === "yes" ? level.fair : 1 - level.fair) * 100))}.</Info></span>}
      </p>
      {ready && (
        <div ref={sheetRef} className={`q-sheet${sheet ? " open" : ""}`} role={sheet ? "dialog" : undefined} aria-modal={sheet ? "true" : undefined} aria-label="Ticket">
          <button className="text-control q-sheet-close" onClick={() => setSheet(false)}>Close</button>
          <QuestionTicket und={und} question={question} answer={ANSWER[sideKey]} level={level} sideKey={sideKey} t={t} board={board}
            pricesTs={board.prices_ts} settleTs={date.settle_ts} expiry={date.expiry} stale={age.state === "stale"} />
        </div>
      )}
    </article>
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
  const sideParam = search.get("side");
  const sideKey = sideParam === "no" || sideParam === "yes" ? sideParam : null; // never picked for the user
  const setSide = (k) => setSearch((s) => { const n = new URLSearchParams(s); n.set("side", k); return n; }, { replace: true });
  const held = useMemo(() => loadPositions().length, []);
  useEffect(() => { setPickedDate(null); setMore(false); }, [und]);

  if (indexError && !index) return <div className="wrap page"><Failed error={indexError} /></div>;
  if (!index || (und && !board && !error)) return <div className="wrap page"><Loading /></div>;
  const coins = index.coins || [];
  if (!und || (error && !board)) {
    return <div className="wrap page q-page"><h1>Saloon</h1><p className="status">No questions with a price on Derive's screen right now.</p></div>;
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
  // Wide screens show the date's headline question beside the board until a row is picked
  // (phones show the board alone).
  const found = chosen || (date?.headline ? findLevel(board, date.headline) : null);
  const coinItems = (coins.some((c) => c.und === und) ? coins : [...coins, { und }]).map((c) => [c.und, c.und]);
  const back = () => navigate(`/saloon/${und}`);
  const thin = board.thin;
  return (
    <div className={`wrap page q-page${id ? " has-q" : ""}`}>
      <header className="q-head">
        <div className="q-head-top">
          <h1>Saloon <span className="q-sub">Price outcomes</span></h1>
          <Link to="/saloon/mine" className="text-link">Positions{held ? ` (${held})` : ""}</Link>
        </div>
        <Tabs label="Coin" value={und} onChange={(u) => navigate(`/saloon/${u}`)} items={coinItems} />
      </header>
      <div className="q-cols">
        <section className="q-board" aria-label={`${und} questions`}>
          <div className="q-coin">
            <Asset und={und} compact />
            <b className="mono q-index">{money(board.index)}</b>
            {thin && <ThinNote und={und} />}
            <PriceTime pricesTs={board.prices_ts} age={age} />
          </div>
          {dates.length ? (
            <>
              <div className="q-dates">
                <Tabs label="Settlement date" value={date.expiry} onChange={(e) => { setPickedDate(e); if (id) navigate(`/saloon/${und}`); }}
                  items={dates.map((d) => [d.expiry, d.label])} />
              </div>
              <QuestionLadder board={board} date={date} more={more} onMore={() => setMore((m) => !m)} paused={paused}
                selectedId={found?.level?.id} selectedSide={sideKey} />
              <ZoneNote und={und} date={date} index={board.index} />
            </>
          ) : <p className="status">No dates with a price on Derive's screen right now.</p>}
          <Settled board={board} />
        </section>
        <div className="q-main">
          {found && !found.settled ? (
            <QuestionView key={found.level.id} und={und} board={board} found={found} sideKey={sideKey} setSide={setSide} age={age} theme={theme} onBack={back} />
          ) : found?.settled ? (
            <article className="q-view">
              <button className="text-control q-back" onClick={back}>‹ {und}</button>
              <h1 className="q-title">{questionText(und, found.level, found.date.expiry)}</h1>
              {found.date.settle_price != null ? <SettledView und={und} level={found.level} price={found.date.settle_price} paid={found.level.paid} expiry={found.date.expiry} />
                : <p className="q-big">Settling · average from 07:30 to 08:00 UTC</p>}
            </article>
          ) : id ? <OldQuestion id={id} onBack={back} /> : (
            <div className="q-empty">
              <p className="status">Pick a level to see what each answer pays.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
