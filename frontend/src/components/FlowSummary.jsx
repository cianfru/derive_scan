import { usd } from "../lib/format.js";
import { Asset } from "./MarketVisuals.jsx";
import { Info, Arrow } from "./ui.jsx";

// What traders paid for options, per coin (owner, 10 October 2026: the four-shade bars were "kind of hard to
// read"): one bar per coin, calls bought against puts bought, sized by the money paid; what traders sold
// stays a quiet figure beside it.
export const FLOW_PARTS = [
  ["call", "buy_premium_usd", "Calls", "call-buy"],
  ["put", "buy_premium_usd", "Puts", "put-buy"],
];
/** Per coin: {und, calls, puts, bought, sold}, largest bought first; coins with no option premium left out. */
export function summarizeFlow(byCoin) {
  return Object.entries(byCoin || {})
    .map(([und, f]) => {
      const calls = f.call?.buy_premium_usd || 0, puts = f.put?.buy_premium_usd || 0;
      const sold = (f.call?.sell_premium_usd || 0) + (f.put?.sell_premium_usd || 0);
      return { und, calls, puts, bought: calls + puts, sold };
    })
    .filter((r) => r.bought > 0 || r.sold > 0)
    .sort((a, b) => b.bought - a.bought || b.sold - a.sold);
}
/** Track length on a square-root scale of what was paid, so small markets stay visible. */
export const trackWidth = (total, max) => (max > 0 && total > 0 ? Math.max(6, Math.sqrt(total / max) * 100) : 0);
const pct = (part, whole) => Math.round((part / whole) * 100);

export default function FlowSummary({ data, selected, onSelect, selectionCount, selectionKind = "trades", onViewTrades }) {
  const rows = summarizeFlow(data.by_coin),
    calls = rows.reduce((s, r) => s + r.calls, 0),
    puts = rows.reduce((s, r) => s + r.puts, 0),
    max = rows[0]?.bought || 0;
  return (
    <section className="plate lead-plate flow-briefing" aria-label="What traders paid for options, by market">
      <div className="flow-brief-head">
        <div className="flow-total">
          <strong>{usd(calls + puts)}</strong>
          <span className="flow-meta">paid for options · {rows.length} markets · 24h</span>
        </div>
        <div className="flow-legend">
          <span><i className="call-buy" />Calls <small>pay if the price rises</small></span>
          <span><i className="put-buy" />Puts <small>pay if the price falls</small></span>
          <Info label="How to read flow">
            Option premium every recorded taker paid in the 24-hour window, not only the large trades: a taker
            crosses the spread, and the maker on the other side is not counted again. Bar length is what was paid,
            on a square-root scale so small markets stay visible; the split is calls against puts. "Sold" is premium
            takers collected by selling options. A trade may open, close, hedge or be one leg of a wider position,
            so the split describes money by side, not a signal. Known market makers are left out. Select a market to
            see its large trades.
          </Info>
        </div>
      </div>
      <div className="flow-market-rows">
        {rows.map((r) => (
          <button key={r.und} type="button" className="flow-market-row" aria-pressed={selected === r.und}
            onClick={() => onSelect(selected === r.und ? "all" : r.und)}>
            <Asset und={r.und} compact />
            <span className="premium-lane">
              {r.bought > 0 ? <span className="premium-track" style={{ width: `${trackWidth(r.bought, max)}%` }}
                aria-label={`Calls ${usd(r.calls)}, puts ${usd(r.puts)}`}>
                {r.calls > 0 && <i className="call-buy" style={{ flexGrow: r.calls }} />}
                {r.puts > 0 && <i className="put-buy" style={{ flexGrow: r.puts }} />}
              </span> : <span className="faint fl-none">Nothing bought</span>}
              {r.bought > 0 && <span className="fl-split"><b className="call">{pct(r.calls, r.bought)}%</b> calls · <b className="put">{pct(r.puts, r.bought)}%</b> puts</span>}
            </span>
            <span className="fl-money"><b>{usd(r.bought)}</b>{r.sold > 0 && <small>sold {usd(r.sold)}</small>}</span>
          </button>
        ))}
      </div>
      {selected !== "all" && onViewTrades && <div className="flow-selection">
        <span>{selected} · {selectionCount} recorded {selectionKind}</span>
        <button type="button" className="text-control" onClick={onViewTrades}>View {selected} trades<Arrow /></button>
      </div>}
    </section>
  );
}
