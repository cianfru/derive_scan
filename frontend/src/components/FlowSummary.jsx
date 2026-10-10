import { usd } from "../lib/format.js";
import { riseFall } from "../lib/takeaway.js";
import { Asset } from "./MarketVisuals.jsx";
import { Info, Arrow } from "./ui.jsx";

// Which way options money points, per coin (owner, 10 October 2026: the four-shade bars were "kind of hard to
// read"): one bar per coin, the money on trades that gain if the price rises against the money on trades that
// gain if it falls, the Options layer's own measure, so a spread's two halves offset.
/** Per coin: {und, rise, fall, total}, most money first; coins with no option money left out. */
export function summarizeFlow(byCoin) {
  return Object.entries(byCoin || {})
    .map(([und, f]) => ({ und, ...riseFall(f) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}
/** Track length on a square-root scale of the money, so small markets stay visible. */
export const trackWidth = (total, max) => (max > 0 && total > 0 ? Math.max(6, Math.sqrt(total / max) * 100) : 0);

/** "62% rise · 38% fall", or one side alone when the other is empty. */
export function SplitWords({ rise, total }) {
  const up = Math.round((rise / total) * 100);
  if (up >= 100 || rise === total) return <span className="fl-split"><b className="up">All</b> rise</span>;
  if (up <= 0 || rise === 0) return <span className="fl-split"><b className="down">All</b> fall</span>;
  return <span className="fl-split"><b className="up">{up}%</b> rise · <b className="down">{100 - up}%</b> fall</span>;
}

export default function FlowSummary({ data, selected, onSelect, selectionCount, selectionKind = "trades", onViewTrades }) {
  const rows = summarizeFlow(data.by_coin),
    total = rows.reduce((s, r) => s + r.total, 0),
    max = rows[0]?.total || 0;
  return (
    <section className="plate lead-plate flow-briefing" aria-label="Which way options money points, by market">
      <div className="flow-brief-head">
        <div className="flow-total">
          <strong>{usd(total)}</strong>
          <span className="flow-meta">in options · {rows.length} markets · 24h</span>
        </div>
        <div className="flow-legend">
          <span><i className="rise" />Gains if the price rises</span>
          <span><i className="fall" />Gains if it falls</span>
          <Info label="How to read flow">
            Buying calls or selling puts gains if the price rises; buying puts or selling calls gains if it falls.
            The money is the premium paid or received on every recorded trade of the last 24 hours that crossed the
            spread, market makers left out. A spread puts its two halves on both sides, so they offset. Bar length is
            the money, on a square-root scale so small markets stay visible. A trade may open, close or hedge a
            position, so this is context, not a signal. Select a market to see its large trades.
          </Info>
        </div>
      </div>
      <div className="flow-market-rows">
        {rows.map((r) => (
          <button key={r.und} type="button" className="flow-market-row" aria-pressed={selected === r.und}
            onClick={() => onSelect(selected === r.und ? "all" : r.und)}>
            <Asset und={r.und} compact />
            <span className="premium-lane">
              <span className="premium-track" style={{ width: `${trackWidth(r.total, max)}%` }}
                aria-label={`Gains if the price rises ${usd(r.rise)}, gains if it falls ${usd(r.fall)}`}>
                {r.rise > 0 && <i className="rise" style={{ flexGrow: r.rise }} />}
                {r.fall > 0 && <i className="fall" style={{ flexGrow: r.fall }} />}
              </span>
              <SplitWords rise={r.rise} total={r.total} />
            </span>
            <span className="fl-money"><b>{usd(r.total)}</b></span>
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
