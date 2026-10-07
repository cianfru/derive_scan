import { useId, useState } from "react";
import { Info } from "./ui.jsx";
import { CoinIcon } from "./MarketVisuals.jsx";
import { budgetTicket, outcome, breakeven, money, signed } from "../lib/questions.js";
import "../saloon-demo.css";

// Fixed illustrations only. The real Saloon's sizing and settlement helpers keep the example's
// cost, fees, payout and profit consistent. No feeds, wallet state or execution enter this demo.
const COINS = {
  BTC: { index: 85000, gap: 3000, step: 250, name: "Bitcoin" },
  ETH: { index: 3500, gap: 100, step: 10, name: "Ethereum" },
};
const DATES = ["Friday", "Next Friday"];
const BUDGET = 100;
const SIDES = [{ key: "yes", name: "Higher" }, { key: "no", name: "Lower" }];
const CANDLES = [[8, 68, 77, 60], [21, 75, 65, 82], [34, 65, 72, 57], [47, 70, 58, 78], [60, 59, 49, 67], [73, 50, 55, 42], [86, 53, 40, 59], [99, 41, 46, 33], [112, 47, 37, 54], [125, 37, 43, 30], [138, 43, 34, 51], [151, 35, 40, 28]];
const usd = (value) => money(value, { cents: true });
const fullZone = (level, side) => side === "yes" ? `from ${money(level.hi)}` : `at or below ${money(level.lo)}`;

function example(coin, date, row) {
  const { index, gap } = COINS[coin], k = index + (1 - row) * gap, lo = k - gap, hi = k + gap;
  const yes = [[.39, .55, .70], [.44, .54, .64]][date][row], no = 1.03 - yes;
  const side = (buy, kind) => ({ state: "open", buy, size: 1e6, form: "debit",
    legs: [[`${coin}-EX-${kind}-BUY`, "buy", (hi - lo) * (buy + .2)], [`${coin}-EX-${kind}-SELL`, "sell", (hi - lo) * .2]] });
  return { id: "ILLUSTRATION", k, lo, hi, yes: side(yes, "C"), no: side(no, "P") };
}
function board(coin) {
  return { index: COINS[coin].index, spec: { tick: 1, min: .01, step: .00001, taker: .0003, base: .5, cap: .125 } };
}

function BubbleChart({ coin, selection, onSelect }) {
  const { index, gap } = COINS[coin];
  return (
    <div className="sd-discovery">
      <div className="sd-chart-heading"><span>Tap a bubble to explore</span><small>Max profit on a $100 budget</small></div>
      <div className="sd-bubble-chart" role="group" aria-label={`${coin} illustrative outcomes by level and date`}>
        {[0, 1, 2].map((row) => <div key={row} className="sd-price-row" style={{ top: `${18 + row * 31}%` }} aria-hidden="true"><span>{money(index + (1 - row) * gap)}</span><i /></div>)}
        <div className="sd-history" aria-hidden="true">
          <svg viewBox="0 0 166 110" preserveAspectRatio="none">
            {CANDLES.map(([x, open, close, wick]) => <g key={x} className={close < open ? "up" : "down"}>
              <line x1={x} x2={x} y1={Math.min(open, close, wick) - 4} y2={Math.max(open, close, wick) + 3} />
              <rect x={x - 3} y={Math.min(open, close)} width="6" height={Math.max(3, Math.abs(close - open))} />
            </g>)}
          </svg>
        </div>
        {DATES.flatMap((date, col) => [0, 1, 2].map((row) => {
          const selected = selection.date === col && selection.row === row;
          const side = selected ? selection.side : row === 2 ? "no" : "yes";
          const level = example(coin, col, row), ticket = budgetTicket(level, side, BUDGET, board(coin));
          const profit = ticket.payout - ticket.mostLose;
          return <button type="button" key={`${col}-${row}`} className={`sd-bubble ${side}${selected ? " is-selected" : ""}`}
            style={{ left: `${col ? 83 : 55}%`, top: `${18 + row * 31}%`, "--bubble-size": `${Math.round(64 + Math.min(32, profit / 8))}px` }}
            aria-pressed={selected} aria-label={`${coin} ${side === "yes" ? "Higher" : "Lower"}, ${money(level.k)}, ${date}, most you can make ${usd(profit)}`}
            onClick={() => onSelect({ date: col, row, side })}>
            <b>+${Math.round(profit)}</b><small>{side === "yes" ? "Higher" : "Lower"}</small>
          </button>;
        }))}
      </div>
      <div className="sd-chart-dates" aria-hidden="true"><span>Price history</span><span>Friday</span><span>Next Friday</span></div>
      <p className="sd-chart-hint">Each bubble is a different price outcome.</p>
    </div>
  );
}

export default function SaloonDemo() {
  const [coin, setCoin] = useState("BTC");
  const [selection, setSelection] = useState({ date: 0, row: 1, side: "yes" });
  const [price, setPrice] = useState(87000);
  const id = useId(), { side, date, row } = selection;
  const level = example(coin, date, row), t = budgetTicket(level, side, BUDGET, board(coin));
  const o = outcome(t, level, side, price), be = breakeven(t, level, side);
  const tone = o.pl > .004 ? "up" : o.pl < -.004 ? "down" : "neutral";
  const zone = o.payout <= 1e-9 ? "Pays nothing" : o.payout >= t.payout - 1e-9 ? "Pays in full" : "Pays in part";
  function choose(next, nextCoin = coin) {
    setSelection(next);
    const selected = example(nextCoin, next.date, next.row);
    const { gap, step } = COINS[nextCoin];
    setPrice(Math.round((selected.k + (next.side === "yes" ? 1 : -1) * gap * 2 / 3) / step) * step);
  }
  function selectCoin(next) {
    setCoin(next);
    choose({ date: 0, row: 1, side: "yes" }, next);
  }
  return (
    <section className="saloon-demo" aria-labelledby={`${id}-title`}>
      <header className="sd-heading">
        <h3 id={`${id}-title`}>Explore an outcome</h3>
        <span className="sd-illustration">Illustration</span>
      </header>
      <div className="sd-workspace">
        <div className="sd-market">
          <div className="sd-coin-tabs" role="group" aria-label="Example coin">
            {Object.entries(COINS).map(([key, c]) => <button type="button" key={key} aria-pressed={coin === key} onClick={() => selectCoin(key)}>
              <CoinIcon und={key} /><b>{key}</b><span>{c.name}</span>
            </button>)}
          </div>
          <BubbleChart coin={coin} selection={selection} onSelect={choose} />
        </div>
        <div className="sd-card">
          <div className="sd-question-heading" aria-live="polite" aria-atomic="true">
            <p className="sd-example">{DATES[date]} · 08:00 UTC</p>
            <h4 className="sd-question">{coin} higher or lower<br /> than {money(level.k)}?</h4>
          </div>
          <div className="sd-choices" role="group" aria-label="Pick an example answer">
            {SIDES.map((s) => <button key={s.key} type="button" className={`sd-choice ${s.key}`} aria-pressed={side === s.key} aria-label={s.name} onClick={() => choose({ ...selection, side: s.key })}>
              <span className="sd-choice-top"><span><i className={`sd-arrow ${s.key}`} aria-hidden="true" />{s.name}</span><b>{Math.round(level[s.key].buy * 100)}<small>¢</small></b></span>
              <small>Full $1 {fullZone(level, s.key)}</small>
            </button>)}
          </div>
          <p className="sd-per">Price per $1 paid at settlement, before fees.</p>
          <div className="sd-return"><span>Most you can make</span><strong>{signed(t.payout - t.mostLose)}</strong><small>If {coin} settles {side === "yes" ? `at or above ${money(level.hi)}` : `at or below ${money(level.lo)}`}</small></div>
          <dl className="sd-figs">
            <div><dt>You pay, fees included</dt><dd>{usd(t.mostLose)}</dd></div>
            <div><dt>Most it pays back</dt><dd>{usd(t.payout)}</dd></div>
          </dl>
          <div className="sd-risk"><span>Max loss <b>{usd(t.mostLose)}</b></span><span>Fees <b>{usd(t.fees)}</b></span></div>
          <p className="sd-zone-note">Pays in part between {money(level.lo)} and {money(level.hi)}.</p>
          <details className="sd-settlement">
            <summary>Try a settlement price<span aria-hidden="true">+</span></summary>
            <div className="sd-slider">
              <label htmlFor={`${id}-price`}>Settlement price<b>{money(price)}</b></label>
              <input id={`${id}-price`} type="range" min={level.lo - COINS[coin].gap} max={level.hi + COINS[coin].gap} step={COINS[coin].step} value={price}
                aria-valuetext={`${money(price)}: you get ${usd(o.payout)}, ${signed(o.pl)}`}
                onChange={(event) => setPrice(Number(event.target.value))} />
            </div>
            <div className={`sd-result sd-result-${tone}`} role="status" aria-live="polite" aria-atomic="true">
              <span>If {coin} settles at {money(price)}: you get <b>{usd(o.payout)}</b></span><strong>{signed(o.pl)}</strong><small>{zone}. Breakeven {money(be)}.</small>
            </div>
          </details>
        </div>
      </div>
      <div className="sd-foot"><span>Made-up prices. Try any bubble or answer. No trade is placed.</span>
        <Info label="How this payout illustration works">These numbers are an illustration, not a market quote. Every bubble uses a $100 budget, including fees. Amounts round down to the available contract step. Payout is what comes back at settlement; profit or loss is that payout minus your total cost. A partial payout can still be a loss. The max loss shown applies after both options of the debit package are filled and held to settlement. With only the first order filled, the cash needed and loss can be larger. Selling back early uses the prices then.</Info>
      </div>
    </section>
  );
}
