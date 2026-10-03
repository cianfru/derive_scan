import { usd } from "../lib/format.js";
import { Asset } from "./MarketVisuals.jsx";
import { Info } from "./ui.jsx";
export const FLOW_PARTS = [
  ["call", "buy_premium_usd", "Calls bought", "call-buy"],
  ["call", "sell_premium_usd", "Calls sold", "call-sell"],
  ["put", "buy_premium_usd", "Puts bought", "put-buy"],
  ["put", "sell_premium_usd", "Puts sold", "put-sell"],
];
export function summarizeFlow(byCoin) {
  return Object.entries(byCoin || {})
    .map(([und, f]) => {
      const parts = FLOW_PARTS.map(([kind, key, label, cls]) => ({ label, cls, value: f[kind]?.[key] || 0 }));
      const total = parts.reduce((s, p) => s + p.value, 0);
      return { und, parts, total };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}
/** Track length on a square-root scale of premium, so small markets stay visible. */
export const trackWidth = (total, max) => (max > 0 ? Math.max(6, Math.sqrt(total / max) * 100) : 0);
export default function FlowSummary({ data, selected, onSelect }) {
  const rows = summarizeFlow(data.by_coin),
    total = rows.reduce((s, r) => s + r.total, 0),
    max = rows[0]?.total || 0;
  return (
    <section className="plate lead-plate flow-briefing" aria-label="Options premium by market">
      <div className="flow-brief-head">
        <div className="flow-total">
          <strong>{usd(total)}</strong>
          <span className="flow-meta">{rows.length} markets · 24h</span>
        </div>
        <div className="flow-legend">
          {FLOW_PARTS.map(([, , name, cls]) => (
            <span key={cls}><i className={cls} />{name}</span>
          ))}
          <Info label="How to read flow">
            Option premium from every recorded taker side in the 24-hour window, not just the large-trade sample; a
            taker crosses the spread and the maker side is not counted again. Bar length is premium on a square-root
            scale; the split inside is calls and puts, bought and sold. Calls bought and puts sold gain from a rise;
            puts bought and calls sold from a fall. Trades may open, close, hedge or form a multi-leg strategy, so the
            split describes premium by side, not a bullish or bearish signal. Known market makers are excluded. Select
            a market to filter the large trades.
          </Info>
        </div>
      </div>
      <div className="flow-market-rows">
        {rows.map((r) => (
          <button key={r.und} className="flow-market-row" aria-pressed={selected === r.und}
            onClick={() => onSelect(selected === r.und ? "all" : r.und)}>
            <Asset und={r.und} compact />
            <span className="premium-lane">
              <span className="premium-track" style={{ width: `${trackWidth(r.total, max)}%` }}
                aria-label={r.parts.map((p) => `${p.label}: ${usd(p.value)}`).join(", ")}>
                {r.parts.map((p) => p.value > 0 && <i key={p.cls} className={p.cls} style={{ flexGrow: p.value }} />)}
              </span>
            </span>
            <b>{usd(r.total)}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
