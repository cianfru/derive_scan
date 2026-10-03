import { viewReading } from "../lib/presentation.js";

// The three layers of a market, always in this order and always drawn the same way:
// price regime (the engine), smart-wallet positioning, and option prices.
export const LAYERS = [
  ["engine", "Regime", "regime"],
  ["wallets", "Wallets", "wallets"],
  ["options", "Options", "options"],
];
export const HORIZON_LABEL = { "7d": "Next 7 days", "30d": "Next 30 days" };

export function LayerIcon({ kind, size = 16 }) {
  const p = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6,
    strokeLinecap: "square", "aria-hidden": true };
  if (kind === "engine") return <svg {...p}><path d="M1.5 12.5 5 8l3 2.5 6.5-7" /><path d="M10.5 3.5h4v4" /></svg>;
  if (kind === "wallets") return <svg {...p}><rect x="1.5" y="4.5" width="13" height="9" /><path d="M1.5 7.5h13M10.5 10.2h2" /><path d="M4 4.5 11 1.8l1 2.7" /></svg>;
  return <svg {...p}><path d="M1 13.5h14" /><path d="M1.5 13.5C4.5 13.5 5.2 3 8 3s3.5 10.5 6.5 10.5" strokeLinecap="round" /><path d="M5 13.5V9M11 13.5V9" strokeDasharray="1.2 1.6" /></svg>;
}

export function chainReadings(alignment, horizon) {
  return LAYERS.map(([kind, name, anchor]) => {
    const { label, state } = viewReading(alignment, horizon, kind);
    return { kind, name, anchor, text: label, state };
  });
}

const agreedOf = (r) => (r[0].state && r[0].state !== "neutral" && r.every((x) => x.state === r[0].state) ? r[0].state : null);

/** Compact: three linked squares (regime, wallets, options), for tables and lists. */
export function ChainMini({ alignment, horizon = "30d" }) {
  const r = chainReadings(alignment, horizon);
  const agreed = agreedOf(r);
  return (
    <span className={`chain-mini${agreed ? ` agreed ${agreed}` : ""}`} role="img"
      aria-label={r.map((x) => `${x.name}: ${x.text}`).join(", ")}>
      {r.map((x, i) => (
        <span key={x.kind} className="chain-mini-cell">
          {i > 0 && <i className="chain-link" />}
          <b className={`chain-sq ${x.state || "unknown"}`} title={`${x.name}: ${x.text}`}><LayerIcon kind={x.kind} size={15} /></b>
        </span>))}
    </span>
  );
}

/** Full: the three layers with their reading in words; each links to its section on the coin page. */
export default function Chain({ alignment, horizon = "30d", linked = true, compact = false }) {
  const r = chainReadings(alignment, horizon);
  const agreed = agreedOf(r);
  return (
    <div className={`chain${compact ? " compact" : ""}${agreed ? ` agreed ${agreed}` : ""}`}>
      {r.map((x, i) => {
        const Tag = linked ? "a" : "div";
        return (
          <Tag key={x.kind} className={`chain-tile ${x.state || "unknown"}`} {...(linked ? { href: `#${x.anchor}` } : {})}>
            <span className="chain-icon"><LayerIcon kind={x.kind} size={18} /></span>
            <span className="chain-text"><small>{i + 1} · {x.name}</small><b>{x.text}</b></span>
          </Tag>);
      })}
    </div>
  );
}

export function ChainLegend() {
  return (
    <span className="chain-legend">
      <span><b className="chain-sq up" />Up</span>
      <span><b className="chain-sq neutral" />Balanced</span>
      <span><b className="chain-sq defensive" />Defensive</span>
      <span><b className="chain-sq unknown" />Building</span>
    </span>
  );
}
