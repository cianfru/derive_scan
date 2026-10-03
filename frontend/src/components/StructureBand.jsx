import { Info, Empty } from "./ui.jsx";
import FearGreed from "./FearGreed.jsx";
import { REGIME, SIGNAL_LABEL, signalTone, title } from "../lib/format.js";
import { REGIME_COLORS } from "../lib/regime.js";
import { currentEngine } from "../lib/research.js";

// The daily market structure as one slim band above the Markets board:
// consensus | regime mix with its daily history | signal counts (filters) | Fear & Greed.

/** Stacking order of the regime strip, bottom up: Markup first, so the 55% line reads against it. */
const ORDER = ["MARKUP", "REACC", "ACCUM", "CAP", "MARKDOWN", "BLOWOFF", "FLAT"];
/** Every daily signal the engine can give, strongest first. Trim includes Trim hard. */
export const LADDER = ["STRONG_LONG", "LIGHT_LONG", "ACCUMULATE", "REVIVAL_SEED_CONFIRMED", "REVIVAL_SEED", "WAIT",
  "NO_LONG", "LIGHT_SHORT", "TRIM", "RISK_OFF"];
const GROUP = { TRIM: ["TRIM", "TRIM_HARD"] };
export const isSignal = (c, s) => (GROUP[s] || [s]).includes(c.signal_1d);
/** Signal counts for a set of markets, in ladder order; zero counts are dropped unless selected. */
export const signalCounts = (coins, selected = null) =>
  LADDER.map((s) => ({ s, n: coins.filter((c) => isSignal(c, s)).length })).filter((x) => x.n || x.s === selected);

const CONSENSUS_HELP = "The engine's market consensus on the daily close: every Derive perp with enough history sits in one regime, and the market is named when one group holds more than 55% of them (Risk-on: Markup; Accumulation: Accumulation, Re-accumulation and Capitulation; Risk-off: Markdown; Euphoria: Blow-off). Otherwise Mixed. It is one of the nine checks behind a long signal. The strip shows the same count for each past daily close, replayed from price history; today is the last column. A head count of markets, not a strength score.";
const SIGNAL_COUNT_HELP = "Daily signal counts for the markets in the board's current view. Select one to show only those markets; select it again to show all.";

const month = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const day = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Daily regime counts of every perp with a current daily engine (what the consensus counts). */
export function regimeCounts(coins, now) {
  const n = {};
  for (const c of coins) if (c.regime_1d && currentEngine(c.engine_comparison?.["1d"], now)) n[c.regime_1d] = (n[c.regime_1d] || 0) + 1;
  return n;
}

/**
 * The strip's columns: the published daily history, with the latest close taken from the board's own
 * readings (so the last column, the key and the sub-line always agree with the board).
 */
export function stripColumns(breadth, live, bar) {
  const cols = breadth?.cols || [];
  const rows = (breadth?.rows || []).map(([ts, ...n]) => ({ ts, n: Object.fromEntries(cols.map((k, i) => [k, n[i] || 0])) }));
  if (Number.isFinite(bar) && Object.keys(live).length) {
    const last = rows[rows.length - 1];
    if (last && last.ts === bar) last.n = { ...live };
    else if (!last || last.ts < bar) rows.push({ ts: bar, n: { ...live } });
  }
  return rows;
}

function RegimeStrip({ columns }) {
  const W = columns.length, H = 32;
  const line = H * (1 - 0.55);
  return (
    <svg className="regime-strip" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`Daily regime mix for the last ${W} daily closes`}>
      {columns.map((col, i) => {
        const total = ORDER.reduce((a, k) => a + (col.n[k] || 0), 0);
        if (!total) return null;
        let y = H;
        return ORDER.map((k) => {
          const h = ((col.n[k] || 0) / total) * H;
          if (!h) return null;
          y -= h;
          return <rect key={`${col.ts}-${k}`} x={i + 0.08} width={0.84} y={y} height={h} className={i === W - 1 ? "today" : undefined}
            style={{ fill: REGIME_COLORS[k] }} />;
        });
      })}
      <line x1="0" x2={W} y1={line} y2={line} className="rs-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function StructureBand({ data, scoped, scopeLabel, signalFilter, onSignal }) {
  const consensus = data.consensus_detail?.["1d"]?.status === "unavailable" ? null : data.consensus?.["1d"];
  const live = regimeCounts(data.coins || []);
  const measured = Object.values(live).reduce((a, b) => a + b, 0);
  const lead = ORDER.filter((k) => live[k]).sort((a, b) => live[b] - live[a]);
  const columns = stripColumns(data.breadth_1d, live, data.bars?.["1d"]);
  const lastTs = columns[columns.length - 1]?.ts;
  const ladder = signalCounts(scoped, signalFilter);

  return (
    <section className="plate structure-band" aria-label="Daily market structure">
      <div className="sb-cell sb-consensus">
        <span className="sb-eyebrow">Market · 1D<Info label="Explain market consensus">{CONSENSUS_HELP}</Info></span>
        <strong className="sb-headline">{consensus ? title(consensus) : <Empty />}</strong>
        {lead[0] && <small className="sb-sub"><b>{live[lead[0]]}/{measured}</b> in {REGIME[lead[0]]}</small>}
      </div>

      <div className="sb-cell sb-mix">
        {lead.length > 0 && (
          <div className="sb-key">
            {lead.map((k) => <span key={k}><i style={{ background: REGIME_COLORS[k] }} />{REGIME[k]}<b>{live[k]}</b></span>)}
          </div>)}
        {columns.length > 0 ? (
          <>
            <RegimeStrip columns={columns} />
            <div className="sb-axis" aria-hidden="true">
              <span>{month(columns[0].ts)}</span>
              <span>{lastTs === data.bars?.["1d"] ? "Today" : day(lastTs)}</span>
            </div>
          </>
        ) : <Empty label="No regime history" />}
      </div>

      <div className="sb-cell sb-signals">
        <span className="sb-eyebrow">Daily signals · {scopeLabel}<Info label="Explain signal counts">{SIGNAL_COUNT_HELP}</Info></span>
        {ladder.length > 0 ? (
          <>
            <div className="sb-filters" role="group" aria-label="Filter the board by daily signal">
              {ladder.map(({ s, n }) => (
                <button key={s} className={`sb-filter ${signalTone(s)}`} aria-pressed={signalFilter === s}
                  aria-label={`${SIGNAL_LABEL[s]}: ${n} ${n === 1 ? "market" : "markets"}`}
                  onClick={() => onSignal(signalFilter === s ? null : s)}>
                  <span>{SIGNAL_LABEL[s]}</span><b>{n}</b>
                </button>))}
            </div>
            <div className="sb-share" aria-hidden="true">
              {ladder.filter((x) => x.n).map(({ s, n }) => <i key={s} className={signalTone(s)} style={{ flex: n }} />)}
            </div>
          </>
        ) : <Empty label="No current daily signals in this view" />}
      </div>

      <div className="sb-cell sb-fg">
        <FearGreed sentiment={data.context?.sentiment} at={data.context?.sentiment_at} />
      </div>
    </section>
  );
}
