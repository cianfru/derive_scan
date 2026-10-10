import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Info, Empty } from "./ui.jsx";
import FearGreed from "./FearGreed.jsx";
import { REGIME, SIGNAL_LABEL, CONSENSUS, signalTone, title } from "../lib/format.js";
import { REGIME_COLORS, REGIME_ORDER as ORDER, consensusTerm } from "../lib/regime.js";
import { currentEngine } from "../lib/research.js";

// The daily market structure as one slim band above the Markets board:
// consensus | regime mix with its daily history | signal counts (filters) | Fear & Greed.

// Stacking order of the regime strip (REGIME_ORDER), bottom up: Trending up first, so the 55% line reads against it.
/** Every daily signal the engine can give, strongest first. Stretched includes Very stretched; Leaning down holds
 * both engine signals that share that plain label (Risk off and Light short). */
export const LADDER = ["STRONG_LONG", "LIGHT_LONG", "ACCUMULATE", "REVIVAL_SEED_CONFIRMED", "REVIVAL_SEED", "WAIT",
  "NO_LONG", "TRIM", "RISK_OFF"];
const GROUP = { TRIM: ["TRIM", "TRIM_HARD"], RISK_OFF: ["RISK_OFF", "LIGHT_SHORT"] };
export const isSignal = (c, s) => (GROUP[s] || [s]).includes(c.signal_1d);
/** Signal counts for a set of markets, in ladder order; zero counts are dropped unless selected. */
export const signalCounts = (coins, selected = null) =>
  LADDER.map((s) => ({ s, n: coins.filter((c) => isSignal(c, s)).length })).filter((x) => x.n || x.s === selected);

const CONSENSUS_HELP = "The engine's market consensus on the daily close: every Derive perp with enough history sits in one regime, and the market is named when one group holds more than 55% of them (most coins trending up; most coins basing: building a base, cooling off or washed out; most coins trending down; most coins overheated). Otherwise Mixed. It is one of the nine checks behind an up-setup. The strip shows the same count for each past daily close, replayed from price history; today is the last column. The dashed line marks 55% trending up. A head count of markets, not a strength score.";
const SIGNAL_COUNT_HELP = "Daily signal counts for the markets in the board's current view. Select one to show only those markets; select it again to show all.";

const day = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function regimeMembers(coins, now) {
  const members = {};
  for (const c of coins) if (c.regime_1d && currentEngine(c.engine_comparison?.["1d"], now)) {
    (members[c.regime_1d] ||= []).push(c.und);
  }
  for (const names of Object.values(members)) names.sort();
  return members;
}

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
export function stripColumns(breadth, live, bar, liveMembers = null) {
  const cols = breadth?.cols || [];
  const rows = (breadth?.rows || []).map(([ts, ...n], i) => ({
    ts, n: Object.fromEntries(cols.map((k, j) => [k, n[j] || 0])),
    members: breadth.members?.[i] ? Object.fromEntries(cols.map((k, j) => [k, breadth.members[i][j]])) : null,
  }));
  if (Number.isFinite(bar) && Object.keys(live).length) {
    const last = rows[rows.length - 1];
    if (last && last.ts === bar) { last.n = { ...live }; last.members = liveMembers; }
    else if (!last || last.ts < bar) rows.push({ ts: bar, n: { ...live }, members: liveMembers });
  }
  return rows;
}

function RegimeStrip({ columns }) {
  const [sel, setSel] = useState(null);
  const [tipLeft, setTipLeft] = useState(0);
  const box = useRef(null);
  const tipId = useId();
  const open = sel !== null;
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!box.current?.contains(e.target)) setSel(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const H = 32;
  let x = 0;
  const rows = columns.map((col, i) => {
    if (i) x += Math.max(1, Math.round((col.ts - columns[i - 1].ts) / 86400));
    const total = ORDER.reduce((a, k) => a + (col.n[k] || 0), 0);
    return { ...col, x, total };
  });
  const W = x + 1;
  const latest = rows[rows.length - 1];
  const selected = sel === null ? null : rows.find((r) => r.x === sel) || {
    ts: columns[0].ts + sel * 86400, x: sel, total: 0, n: {},
  };
  const shown = selected || latest;
  const groups = ORDER.filter((k) => shown.n[k]).map((k) => ({
    k, count: shown.n[k], names: shown.members?.[k]?.length === shown.n[k] ? shown.members[k].join(", ") : null,
  }));
  const reading = `${day(shown.ts)} UTC · ${shown.total ? groups.map(({ k, count, names }) =>
    `${REGIME[k]} ${count}: ${names || "Coin names unavailable"}`).join(" · ") : "No reading"}`;
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width) setSel(Math.max(0, Math.min(W - 1, Math.floor((e.clientX - r.left) / r.width * W))));
  };
  const keys = (e) => {
    if (e.key === "Escape") { setSel(null); return; }
    const i = sel ?? latest.x;
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, PageUp: i - 30, PageDown: i + 30, Home: 0, End: W - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSel(Math.max(0, Math.min(W - 1, next)));
  };
  const line = H * (1 - 0.55);
  useLayoutEffect(() => {
    if (sel === null) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(320, window.innerWidth - 32);
      const center = r.left + (sel + .5) / W * r.width;
      setTipLeft(Math.max(16, Math.min(window.innerWidth - width - 16, center - width / 2)) - r.left);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [sel, W]);
  return (
    <div ref={box} className="regime-history" role="slider" tabIndex={0}
      aria-label={`Daily regime mix for the last ${columns.length} daily closes`}
      aria-valuemin={0} aria-valuemax={W - 1} aria-valuenow={shown.x} aria-valuetext={reading}
      aria-describedby={open ? tipId : undefined}
      onFocus={() => setSel((v) => v ?? latest.x)} onBlur={() => setSel(null)} onKeyDown={keys}
      onPointerLeave={(e) => { if (e.pointerType !== "touch") setSel(null); }}>
      <svg className="regime-strip" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"
        onPointerMove={pick} onPointerDown={(e) => { box.current?.focus(); pick(e); }}>
        {rows.map((r) => {
          if (!r.total) return null;
          let y = H;
          return ORDER.map((k) => {
            const h = ((r.n[k] || 0) / r.total) * H;
            if (!h) return null;
            y -= h;
            return <rect key={`${r.ts}-${k}`} x={r.x + .08} width={.84} y={y} height={h}
              className={r === latest ? "rs-today" : "rs-bar"} style={{ fill: REGIME_COLORS[k] }} />;
          });
        })}
        <line x1="0" x2={W} y1={line} y2={line} className="rs-line" vectorEffect="non-scaling-stroke" />
        {selected && <rect x={selected.x} y="0" width="1" height={H} className="rs-selected" vectorEffect="non-scaling-stroke" />}
      </svg>
      {selected && <div id={tipId} className="rs-tooltip" role="tooltip" style={{ left: tipLeft }}>
        <div className="rs-tooltip-body">
          <time className="rs-date">{day(selected.ts)}<span>Daily close · UTC</span></time>
          {selected.total ? groups.map(({ k, count, names }) => <div className="rs-group" key={k} style={{ "--regime-color": REGIME_COLORS[k] }}>
            <span className="rs-group-label"><i aria-hidden="true" />{REGIME[k]}<b>{count}</b></span>
            <span className={`rs-coins${names ? "" : " unavailable"}`}>{names || "Coin names unavailable"}</span>
          </div>) : <span className="rs-coins unavailable">No reading</span>}
        </div>
      </div>}
    </div>
  );
}

export default function StructureBand({ data, scoped, scopeLabel, signalFilter, onSignal }) {
  const consensus = data.consensus_detail?.["1d"]?.status === "unavailable" ? null : data.consensus?.["1d"];
  const now = Date.now() / 1000;
  const live = regimeCounts(data.coins || [], now);
  const measured = Object.values(live).reduce((a, b) => a + b, 0);
  const lead = ORDER.filter((k) => live[k]).sort((a, b) => live[b] - live[a]);
  const columns = stripColumns(data.breadth_1d, live, data.bars?.["1d"], regimeMembers(data.coins || [], now));
  const ladder = signalCounts(scoped, signalFilter);

  return (
    <section className="plate structure-band" aria-label="Daily market structure">
      <div className="sb-cell sb-consensus">
        <span className="sb-eyebrow">All perps · daily close<Info label="Explain market consensus">{CONSENSUS_HELP}{consensus ? consensusTerm(consensus) : ""}</Info></span>
        <strong className="sb-headline">{consensus ? CONSENSUS[consensus] || title(consensus) : <Empty />}</strong>
        {lead[0] && <small className="sb-sub"><b>{live[lead[0]]}/{measured}</b> perps · {REGIME[lead[0]]}</small>}
      </div>

      <div className="sb-cell sb-mix">
        {lead.length > 0 && (
          <div className="sb-key">
            {lead.map((k) => <span key={k} style={{ "--regime-color": REGIME_COLORS[k] }}><i />{REGIME[k]}<b>{live[k]}</b></span>)}
          </div>)}
        {columns.length > 0 ? (
          <RegimeStrip columns={columns} />
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
