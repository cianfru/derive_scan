import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useData } from "../lib/data.js";
import { Info, Loading, Failed, Tabs } from "../components/ui.jsx";
import { Asset } from "../components/MarketVisuals.jsx";
import Chain from "../components/Chain.jsx";
import QuestionLadder from "../components/QuestionLadder.jsx";
import PayZone from "../components/PayZone.jsx";
import QuestionChart from "../components/QuestionChart.jsx";
import QuestionTicket from "../components/QuestionTicket.jsx";
import {
  answerNames, buyCents, cents, centsDown, countdown, dayLabel, findLevel, gap, live, money, parseId, priceAge,
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
        <Info label="About the pay zone">Each level pays in part within {money(half)} either side: a zone of {money(date.zone)}, {share}% of {und}'s price. Above the zone Yes pays $1, below it nothing, and in between part of it in a straight line. A wider zone costs less on Derive's screen; a narrower one is closer to a plain yes or no.</Info>
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
              <span>Above <b className="mono">{money(lv.k)}</b></span>
              <span className="mono">Yes paid {cents(Math.round(lv.paid * 100))}</span>
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
      <p>Yes paid <b className="mono">{cents(Math.round(paid * 100))}</b> per $1 · No paid <b className="mono">{cents(100 - Math.round(paid * 100))}</b></p>
      <PayZone lo={level.lo} hi={level.hi} index={price} />
      <p className="status">{und} settled on {dayLabel(expiry)} at the 30-minute average to 08:00 UTC.</p>
    </div>
  );
}

/** The question: its answers, pay zone, chart, the amount panel, and the ticket. */
function QuestionView({ und, board, found, sideKey, setSide, age, theme, onBack }) {
  const { date, level } = found;
  const headline = date.headline === level.id;
  const names = answerNames(headline);
  const question = questionText(und, level, date.expiry, headline);
  const paused = age.state === "paused" || board.paused;
  const [dollars, setDollars] = useState(100);
  const [sheet, setSheet] = useState(false);
  const { data: hist } = useData(`questions/history/${und}-${date.expiry}.json`, 15 * 60_000);
  const t = live(level, sideKey, paused) ? ticket(level, sideKey, dollars, board) : null;
  const side = level[sideKey];
  const settling = level.state === "settling";
  const days = (date.settle_ts - Date.now() / 1000) / 86400;
  const sz = side?.size;
  return (
    <article className="q-view" aria-label={question}>
      <button className="text-control q-back" onClick={onBack}>‹ {und} · {date.label}</button>
      <h1 className="q-title">{question}</h1>
      <p className="q-settles">Settles {dayLabel(date.expiry)}, 08:00 UTC{countdown(date.settle_ts) && <> · {countdown(date.settle_ts)}</>}
        <Info label="About settlement">Derive settles on the average {und} index over the 30 minutes to 08:00 UTC. The answer is then paid in USDC to your Derive account with no action from you.</Info>
      </p>
      {settling ? <p className="q-big">Settling · average from 07:30 to 08:00 UTC</p> : (
        <div className="q-pick" role="radiogroup" aria-label="Answer">
          {["yes", "no"].map((k) => {
            const c = buyCents(level, k, paused);
            return (
              <button key={k} role="radio" aria-checked={sideKey === k} className={`q-pick-btn${sideKey === k ? " on" : ""}${headline ? ` dir-${k}` : ""}`}
                onClick={() => setSide(k)}>
                <span>{names[k]}</span><b className="mono">{cents(c)}</b>
              </button>
            );
          })}
        </div>
      )}
      <PayZone lo={level.lo} hi={level.hi} side={sideKey} index={board.index} />
      <QuestionChart hist={hist} id={level.id} side={sideKey} level={level} und={und} theme={theme} />
      {!settling && (
        <section className="q-amount" aria-label="Amount">
          <div className="q-amount-in">
            <label htmlFor="q-dollars" className="label">Amount</label>
            <span className="q-dollar-field"><span>$</span>
              <input id="q-dollars" inputMode="decimal" value={dollars} onChange={(e) => setDollars(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0))} />
            </span>
            <span className="q-quick">{QUICK.map((v) => <button key={v} className="text-control" aria-pressed={dollars === v} onClick={() => setDollars(v)}>${v}</button>)}</span>
          </div>
          {t ? (
            <dl className="q-figs">
              <div className="q-lose"><dt>Most you can lose</dt><dd className="mono">{money(t.mostLose, { cents: true })}</dd></div>
              <div><dt>You pay</dt><dd className="mono">{money(t.premium, { cents: true })} <small>+ fees about {money(t.fees, { cents: true })}</small></dd></div>
              <div><dt>Pays up to</dt><dd className="mono">{money(t.payout, { cents: true })} <small>{sideKey === "yes" ? `from ${money(level.hi)}` : `at or below ${money(level.lo)}`}</small></dd></div>
              <div><dt>At {money(level.k)}</dt><dd className="mono">{money(t.atK, { cents: true })}</dd></div>
              {t.belowMin && <p className="q-note warn">Smallest amount for this question: {money(t.minCost, { cents: true })}.</p>}
              {t.capped && <p className="q-note">Up to {money(t.capPayout)} of payout at this price; more costs more.</p>}
              {t.premium > 0 && t.premium < 50 && <p className="q-note">Fees are a large share of small amounts.</p>}
            </dl>
          ) : <p className="status">No price on Derive's screen for {names[sideKey]} right now.</p>}
          {t && !t.belowMin && (
            <button className="btn primary lg q-get" onClick={() => setSheet(true)}>Get {names[sideKey]} on Derive</button>
          )}
        </section>
      )}
      <Context und={und} days={days} />
      <p className="q-small mono">
        <span>Rules<Rules und={und} /></span>
        {sz != null && <span>Size at this price: up to {money(sz)}</span>}
        {gap(side) != null && <span>Gap {gap(side)}c<Info label="About the gap">What buying and then selling straight back costs on Derive's screen right now: buy {cents(buyCents(level, sideKey, paused))}, sell back {cents(centsDown(side?.sell))}. It is why Yes and No add up to more than $1. Mark on Derive {cents(Math.round((sideKey === "yes" ? level.fair : 1 - level.fair) * 100))}.</Info></span>}
      </p>
      {t && !t.belowMin && (
        <div className={`q-sheet${sheet ? " open" : ""}`} role={sheet ? "dialog" : undefined} aria-label="Ticket">
          <button className="text-control q-sheet-close" onClick={() => setSheet(false)}>Close</button>
          <QuestionTicket und={und} question={question} answer={names[sideKey]} level={level} sideKey={sideKey} t={t} board={board}
            pricesTs={board.prices_ts} settleTs={date.settle_ts} stale={age.state === "stale"} />
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
  const sideKey = search.get("side") === "no" ? "no" : "yes";
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
          <h1>Saloon</h1>
          <Link to="/saloon/mine" className="text-link">My seat{held ? ` (${held})` : ""}</Link>
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
                selectedId={id} selectedSide={sideKey} />
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
              <p className="status">Pick an answer to see its pay zone, chart and the orders to place on Derive.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
