import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ago, dayTime, usd } from "../lib/format.js";
import { dayLayout, flowCoins } from "../lib/flowBubbles.js";
import { sentence } from "../lib/flowStories.js";
import { separate } from "../lib/homeLayout.js";
import { useElementSize } from "../lib/useElementWidth.js";
import FlowBubbles, { LeanText } from "./FlowBubbles.jsx";
import { Asset } from "./MarketVisuals.jsx";
import WalletTag from "./WalletTag.jsx";
import { Info, Arrow } from "./ui.jsx";

// Which way options money points (owner, 10 October 2026: the bubbles are "so much cool"; "a user clicking on a
// specific coin and see a more detailed view"): every coin as a bubble on one map, and a picked coin's own view,
// how its money splits and its large trades through the day.

/** Past this age the flow file no longer reads as "the last 24 hours" and names its window instead. */
const FRESH_SEC = 2 * 3600;
const STRIP_AXIS = 18;

/** One coin's large trades through the day, rise above the line and fall below, with the one under the pointer
 * (else the largest) read out in a sentence under the strip. `trades` are stories (lib/flowStories.js). */
function DayStrip({ und, trades, from, to }) {
  const [box, size] = useElementSize({ w: 640, h: 150 });
  const [active, setActive] = useState(null);
  if (!trades.length) return <p className="fc-none">No large option trades on {und} in the last 24 hours.</p>;
  const stale = Date.now() / 1000 - to > FRESH_SEC;
  const h = size ? size.h - STRIP_AXIS : 0, mid = h / 2;
  // Each dot stays wholly on its side of the line; crowded dots may overlap within it.
  const marks = size ? separate(dayLayout(trades, { w: size.w, h, from, to }), { top: 0, bottom: h, mid, margin: 2 }).sort((a, b) => b.s - a.s) : [];
  const largest = trades.reduce((a, b) => (b.money > a.money ? b : a));
  const shown = (active && trades.find((t) => t.key === active)) || largest;
  const side = (t) => `gains if the price ${t.side === "rise" ? "rises" : "falls"}`;
  const words = (t) => `${sentence(t.text)}, ${usd(t.money)} ${t.paid ? "paid" : "collected"}, ${ago(t.ts)}, ${side(t)}`;
  // The pointer or a tap picks the nearest trade, so a dot under a crowd or too small to hit stays reachable;
  // the dots themselves are the keyboard's way in.
  const nearest = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, d = 36;
    for (const m of marks) { const dm = Math.hypot(m.px - x, m.py - y) - m.s / 2; if (dm < d) { d = dm; best = m; } }
    if (best) setActive(best.key);
  };
  return (
    <>
      <div className="fc-strip" ref={box} onPointerMove={nearest} onPointerDown={nearest}>
        <i className="fc-line" style={{ top: mid }} />
        {marks.map((m) => (
          <button key={m.key} type="button" className={`fc-dot ${m.side}${shown.key === m.key ? " on" : ""}`} aria-label={words(m)}
            aria-pressed={shown.key === m.key} onClick={() => setActive(m.key)} onFocus={() => setActive(m.key)}
            style={{ left: `${(m.px - m.s / 2).toFixed(1)}px`, top: `${(m.py - m.s / 2).toFixed(1)}px`, width: m.s, height: m.s }} />
        ))}
        <div className="fc-xw" aria-hidden="true" style={{ top: h }}>
          {stale ? <><span className="fb-n">{dayTime(from)}</span><span className="fb-n">{dayTime(to)}</span></> : <><span><span className="fb-n">24h</span> ago</span><span>now</span></>}
        </div>
      </div>
      <p className="fc-read" aria-live="polite">
        <WalletTag address={shown.wallet} size={18} />
        <span><b>{sentence(shown.text)}</b> <span className="fc-read-d">{shown.detail}</span></span>
        <span className="fc-read-m"><small className={`fc-read-side ${shown.side === "rise" ? "up" : "down"}`}>{side(shown)}</small>
          <small>{shown.paid ? "paid" : "collected"}</small> <b>{usd(shown.money)}</b> <small>{ago(shown.ts)}</small></span>
      </p>
    </>
  );
}

/** A picked coin: its option money and which way it points, how the money splits by what was bought and sold,
 * and its large trades through the day. */
function CoinFlow({ coin, trades, from, to, onClose, onViewTrades, count }) {
  const s = coin.split;
  const max = Math.max(1, s.callsBought, s.putsSold, s.putsBought, s.callsSold);
  const sides = [
    { k: "up", title: "Gains if the price rises", sum: coin.rise, rows: [["Bought calls", s.callsBought], ["Sold puts", s.putsSold]] },
    { k: "down", title: "Gains if it falls", sum: coin.fall, rows: [["Bought puts", s.putsBought], ["Sold calls", s.callsSold]] },
  ];
  return (
    <section className="fc" aria-label={`${coin.und} options flow`}>
      <div className="fc-head">
        <Asset und={coin.und} />
        <span className="fc-sum">{coin.total > 0 ? <><b>{usd(coin.total)}</b> in options, <span className="fb-n">24h</span> · <LeanText c={coin} /></>
          : <>No option money recorded in the last <span className="fb-n">24</span> hours</>}</span>
        <span className="fc-actions">
          <Link className="text-control" to={`/coin/${coin.und}#options`}>Open {coin.und}<Arrow /></Link>
          <button type="button" className="text-control" onClick={onClose}>All markets</button>
        </span>
      </div>
      {coin.total > 0 && <div className="fc-split">
        {sides.map((side) => (
          <div key={side.k} className={`fc-side ${side.k}`}>
            <div className="fc-side-h"><h3>{side.title}</h3><b>{usd(side.sum)}</b></div>
            {side.rows.map(([label, v]) => (
              <div key={label} className="fc-row">
                <span>{label}</span>
                <span className="fc-bar" aria-hidden="true"><i style={{ width: `${Math.max(v > 0 ? 1 : 0, (v / max) * 100)}%` }} /></span>
                <b>{usd(v)}</b>
              </div>
            ))}
          </div>
        ))}
      </div>}
      <div className="fc-day">
        <div className="fc-day-h">
          <h3>Large trades through the day</h3>
          <span className="fc-key" aria-hidden="true"><span><i className="up" />Gains if it rises, above</span><span><i className="down" />Gains if it falls, below</span></span>
          {count > 0 && onViewTrades && <button type="button" className="text-control" onClick={onViewTrades}>{count === 1 ? "See it in the list" : `All ${count} in the list`}<Arrow /></button>}
        </div>
        <DayStrip und={coin.und} trades={trades} from={from} to={to} />
      </div>
    </section>
  );
}

export default function FlowSummary({ data, selected = "all", onSelect, coinTrades = [], selectionCount = 0, onViewTrades }) {
  const coins = flowCoins(data.by_coin);
  const total = coins.reduce((sum, c) => sum + c.total, 0);
  const picked = selected !== "all" ? coins.find((c) => c.und === selected)
    || { und: selected, rise: 0, fall: 0, total: 0, share: 0.5, lean: "even", split: { callsBought: 0, putsSold: 0, putsBought: 0, callsSold: 0 } } : null;
  const from = Number(data.since), to = Number(data.coverage?.end ?? data.generated_at);
  const map = useRef(null);
  // Closing a coin's view puts focus back on its bubble, so the keyboard keeps its place.
  const close = () => {
    const und = picked?.und;
    onSelect("all");
    const later = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 0);
    later(() => map.current?.querySelector(`[data-und="${und}"]`)?.focus());
  };
  return (
    <section className="plate lead-plate flow-briefing" aria-label="Which way options money points, by market">
      <div className="flow-brief-head">
        <div className="flow-total">
          <strong>{usd(total)}</strong>
          <span className="flow-meta">in options · {coins.length} markets · 24h</span>
        </div>
        <div className="flow-legend">
          <span className="flow-hint">{coins.length ? "Pick a coin to see its trades" : ""}</span>
          <Info label="How to read flow">
            Each bubble is one coin: its size is the option money traded on it over the last 24 hours, and it sits
            left or right by how much of that money went into trades that gain if the price falls (buying puts,
            selling calls) or rises (buying calls, selling puts). The ring is green when more than 55% points to a
            rise, red when more than 55% points to a fall, grey in between. The money is the premium paid or received
            on every recorded trade that crossed the spread, market makers left out; a spread's two halves offset. A
            trade may open, close or hedge a position, so this is context, not a signal.
          </Info>
        </div>
      </div>
      {coins.length ? <div className="flow-map" ref={map}>
        <FlowBubbles coins={coins} onPick={onSelect} selected={selected} rMin={15} rMax={58} labels={coins.length} label={(c) => `${c.und} ${usd(c.total)}`} />
      </div> : <p className="fc-none">No option money recorded in the last 24 hours.</p>}
      {picked && <CoinFlow coin={picked} trades={coinTrades} from={from} to={to} onClose={close} onViewTrades={onViewTrades} count={selectionCount} />}
    </section>
  );
}
