import { viewReading } from "../lib/presentation.js";
import { Info } from "./ui.jsx";
import { REGIME } from "../lib/format.js";

// The three layers of a market, always in this order and always drawn the same way (soft tiles
// joined by a thin line that lights orange when all three agree):
// price regime (the engine), smart-wallet positioning, and option prices.
export const LAYERS = [
  ["engine", "Regime", "regime"],
  ["wallets", "Wallets", "wallets"],
  ["options", "Options", "options"],
];
export const HORIZON_LABEL = { "7d": "Next 7 days", "30d": "Next 30 days" };

export function LayerIcon({ kind, size = 16 }) {
  const p = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (kind === "engine") return <svg {...p}><path d="M1.5 12.5 5 8l3 2.5 6.5-7" /><path d="M10.5 3.5h4v4" /></svg>;
  if (kind === "wallets") return <svg {...p}><rect x="1.5" y="4.5" width="13" height="9" rx="2" /><path d="M1.5 7.5h13M10.5 10.2h2" /><path d="M4 4.5 11 1.8l1 2.7" /></svg>;
  return <svg {...p}><path d="M1 13.5h14" /><path d="M1.5 13.5C4.5 13.5 5.2 3 8 3s3.5 10.5 6.5 10.5" strokeLinecap="round" /><path d="M5 13.5V9M11 13.5V9" strokeDasharray="1.2 1.6" /></svg>;
}

export function chainReadings(alignment, horizon) {
  return LAYERS.map(([kind, name, anchor]) => {
    const { label, state, why } = viewReading(alignment, horizon, kind);
    return { kind, name, anchor, text: label, state, why };
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

const SHORT = { wallets: { up: "Long", defensive: "Short", neutral: "Balanced" }, options: { up: "Upward", defensive: "Defensive", neutral: "Balanced" } };
const HOVER = {
  engine: "The engine's signal and regime: on 4-hour bars for the next 7 days (about 28 bars), on daily bars for the next 30 days (about 30 bars).",
  wallets: "How Derive's Smart wallets hold options expiring in the window: long or short delta overall.",
  options: "What option prices lean towards: skew against its own range and the direction of taker flow.",
};

/** Is every layer pointing the same way for this window (and not balanced)? */
export const chainAgreed = (alignment, horizon) => agreedOf(chainReadings(alignment, horizon));

/** One layer as a wide tile: its icon and reading in words, coloured by state, with the explanation on
 * hover or focus. `aligned` frames it in orange when all three layers agree for its window. */
export function LayerTile({ alignment, horizon = "30d", kind, sub = null, tag = null, aligned = false, icon = true }) {
  const [, name] = LAYERS.find(([k]) => k === kind);
  const { label, state, why, row } = viewReading(alignment, horizon, kind);
  // "detail": what the reading rests on, per layer (the regime; the positions counted; skew alone or with flow).
  if (sub === "detail") sub = kind === "engine" ? "regime" : !state ? null
    : kind === "wallets" ? (Number.isFinite(row?.positions) ? `${row.positions} ${row.positions === 1 ? "position" : "positions"}` : null)
    : row?.status === "skew_only" ? "Skew only" : "Skew and flow";
  if (sub === "regime") sub = state && row?.regime ? REGIME[row.regime] || null : null;
  const word = (state && SHORT[kind]?.[state]) || label;
  const days = horizon === "7d" ? "7" : "30";
  const span = `, next ${days} days${kind === "engine" ? (horizon === "7d" ? " (4-hour bars)" : " (daily bars)") : ""}`;
  const young = kind === "engine" && state && row?.data_status === "warming up" ? " Young history: the engine damps its readings until the coin has about 500 bars." : "";
  const tip = `${name}${span}: ${label}${sub ? ` (${sub})` : ""}. ${why || HOVER[kind]}${young}${aligned ? " All three layers point the same way for this window." : ""}`;
  return (
    <span className={`layer-tile ${state || "unknown"}${aligned ? " aligned" : ""}`} tabIndex={0} role="img" aria-label={tip} data-tip={tip}>
      {icon && <span className="lt-icon"><LayerIcon kind={kind} size={16} /></span>}
      <span className="lt-text">{tag && <small className="lt-tag">{tag}</small>}<b>{word}</b>{sub && <small>{sub}</small>}</span>
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
          <Tag key={x.kind} className={`chain-tile ${x.state || "unknown"}`} {...(linked ? { href: `#${x.anchor}`, title: x.why || undefined } : {})}>
            <span className="chain-icon"><LayerIcon kind={x.kind} size={18} /></span>
            <span className="chain-text"><small><i className="step-n">0{i + 1}</i>{x.name}</small>
              <b>{x.text}{!linked && x.why && <Info label={`Why ${x.name} reads ${x.text}`}>{x.why}</Info>}</b></span>
          </Tag>);
      })}
    </div>
  );
}

/** The key above the chain columns: what each of the three tiles reads, in order, then what its colour means. */
export function ChainLegend() {
  return (
    <span className="chain-key">
      <span className="chain-key-layers">
        {LAYERS.map(([kind, name], i) => (
          <span key={kind}>{i > 0 && <i className="chain-key-sep" aria-hidden="true">·</i>}<LayerIcon kind={kind} size={12} />{name}</span>))}
      </span>
      <span className="chain-legend">
        <span><b className="chain-sq up" />Up</span>
        <span><b className="chain-sq neutral" />Balanced</span>
        <span><b className="chain-sq defensive" />Defensive</span>
        <span><b className="chain-sq unknown" />Building</span>
      </span>
    </span>
  );
}
