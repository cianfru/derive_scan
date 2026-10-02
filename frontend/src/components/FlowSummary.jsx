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
      const parts = FLOW_PARTS.map(([kind, key, label, cls]) => ({
        label,
        cls,
        value: f[kind]?.[key] || 0,
      }));
      const total = parts.reduce((s, p) => s + p.value, 0),
        dominant = [...parts].sort((a, b) => b.value - a.value)[0];
      return { und, parts, total, dominant };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}
export default function FlowSummary({ data, selected, onSelect }) {
  const rows = summarizeFlow(data.by_coin),
    total = rows.reduce((s, r) => s + r.total, 0),
    leader = rows[0];
  return (
    <section className="flow-briefing">
      <div className="flow-brief-head">
        <div>
          <span className="instrument-label">Recorded options activity</span>
          <h2>
            {leader
              ? `${leader.und} leads premium activity`
              : "No option premium recorded in this window"}
          </h2>
          <p>
            {leader
              ? `${usd(leader.total)} in ${leader.und} is ${((leader.total / total) * 100).toFixed(0)}% of the collected premium. ${leader.dominant.label} account for ${((leader.dominant.value / leader.total) * 100).toFixed(0)}% of that market’s activity.`
              : "Collection coverage above tells you how much of the window has been observed."}
          </p>
        </div>
        <div className="flow-total">
          <span>
            Collected premium{" "}
            <Info label="Explain collected premium">
              All recorded taker option sides in the displayed 24-hour window,
              not just the large-trade sample. A taker crosses the spread; the
              maker side is not counted again. Multi-leg strategies can appear
              in several categories, so premium balance does not identify a
              trader's complete strategy.
            </Info>
          </span>
          <strong>{usd(total)}</strong>
          <small>{rows.length} active markets / 24h window</small>
        </div>
      </div>
      <div className="flow-legend">
        {FLOW_PARTS.map(([, , name, cls]) => (
          <span key={cls}>
            <i className={cls} />
            {name}
          </span>
        ))}
        <Info label="How to interpret flow">
          Every bar shows the percentage composition within that market, not its
          size relative to other markets; dollar totals show size. Calls bought
          and puts sold have positive directional sensitivity; puts bought and
          calls sold have negative sensitivity. Trades may open, close, hedge or
          form a multi-leg strategy. These bars describe the premium traded by
          side, not a standalone bullish or bearish signal. Partial collection
          is not representative of the full day. Known market-maker exclusions
          are applied when data is collected.
        </Info>
      </div>
      <div className="flow-market-rows">
        {rows.map((r) => (
          <button
            key={r.und}
            className="flow-market-row"
            aria-pressed={selected === r.und}
            onClick={() => onSelect(selected === r.und ? "all" : r.und)}
          >
            <Asset und={r.und} compact />
            <span
              className="premium-track"
              aria-label={r.parts
                .map((p) => `${p.label}: ${usd(p.value)}`)
                .join(", ")}
            >
              {r.parts.map((p) => (
                <i
                  key={p.cls}
                  className={p.cls}
                  style={{ width: `${(p.value / r.total) * 100}%` }}
                />
              ))}
            </span>
            <span className="flow-dominant">
              {r.dominant.label}
              <small>
                {((r.dominant.value / r.total) * 100).toFixed(0)}% of premium
              </small>
            </span>
            <b>{usd(r.total)}</b>
          </button>
        ))}
      </div>
      <div className="flow-selection">
        <span>
          {selected === "all"
            ? "Select a market to filter the tape below."
            : `${selected} selected. The trade tape below is filtered to this market.`}
        </span>
        {selected !== "all" && (
          <button className="text-control" onClick={() => onSelect("all")}>
            Clear market filter
          </button>
        )}
      </div>
    </section>
  );
}
