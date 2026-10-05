import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ASSET_NAMES, traceGeometry, viewReading } from "../lib/presentation.js";
import { CONSENSUS, REGIME, SIGNAL_LABEL, SIGNAL_RANK, chg, price, usd } from "../lib/format.js";
import { REGIME_LINE, SIGNAL_LINE } from "../lib/regime.js";
import { currentEngine } from "../lib/research.js";
import { coinImage } from "./assets.js";
import "./markets.css";

const ORDER = ["MARKUP", "REACC", "ACCUM", "CAP", "MARKDOWN", "BLOWOFF", "FLAT"];
const COLORS = { MARKUP: "var(--mp-regime-up)", REACC: "var(--mp-regime-reacc)", ACCUM: "var(--mp-regime-accum)", CAP: "var(--mp-regime-cap)", MARKDOWN: "var(--mp-regime-down)", BLOWOFF: "var(--mp-regime-blowoff)", FLAT: "var(--mp-regime-flat)" };
const LADDER = ["STRONG_LONG", "LIGHT_LONG", "ACCUMULATE", "REVIVAL_SEED_CONFIRMED", "REVIVAL_SEED", "WAIT", "NO_LONG", "TRIM", "RISK_OFF"];
const GROUP = { TRIM: ["TRIM", "TRIM_HARD"], RISK_OFF: ["RISK_OFF", "LIGHT_SHORT"] };
const matches = (coin, signal) => (GROUP[signal] || [signal]).includes(coin.signal_1d);
const scopes = { options: "options markets", entries: "daily entries", perps: "perps only" };
const inScope = (coin, scope) => (scope === "perps" ? !coin.has_options : coin.has_options) && (scope !== "entries" || (SIGNAL_RANK[coin.signal_1d] ?? 0) >= 3);
const stamp = (value) => Number.isFinite(value) ? new Date(value * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "Time unavailable";
const day = (value) => new Date(value * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : "—";
const Arrow = () => <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>;

function DailyBars({ columns }) {
  const [selection, setSelection] = useState(null), [left, setLeft] = useState(0);
  const box = useRef(null), tipId = useId();
  let slot = 0;
  const rows = columns.map((col, i) => {
    if (i) slot += Math.max(1, Math.round((col.ts - columns[i - 1].ts) / 86400));
    return { ...col, slot, total: ORDER.reduce((sum, key) => sum + (col.n[key] || 0), 0) };
  });
  const width = slot + 1, height = 32, latest = rows[rows.length - 1];
  const selected = selection === null ? null : rows.find((row) => row.slot === selection) || { ts: columns[0].ts + selection * 86400, slot: selection, n: {}, total: 0 };
  const shown = selected || latest;
  const groups = ORDER.filter((key) => shown.n[key]).map((key) => ({ key, count: shown.n[key], names: shown.members?.[key]?.length === shown.n[key] ? shown.members[key].join(", ") : null }));
  const reading = `${day(shown.ts)} UTC · ${shown.total ? groups.map(({ key, count, names }) => `${REGIME[key]} ${count}: ${names || "Coin names unavailable"}`).join(" · ") : "No reading"}`;
  const pick = (event) => { const rect = event.currentTarget.getBoundingClientRect(); if (rect.width) setSelection(Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left) / rect.width * width)))); };
  const keys = (event) => {
    if (event.key === "Escape") { setSelection(null); return; }
    const current = selection ?? latest.slot;
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: width - 1, PageUp: current - 30, PageDown: current + 30 }[event.key];
    if (next === undefined) return;
    event.preventDefault(); setSelection(Math.max(0, Math.min(width - 1, next)));
  };
  useEffect(() => {
    if (selection === null) return;
    const close = (event) => { if (!box.current?.contains(event.target)) setSelection(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [selection]);
  useLayoutEffect(() => {
    if (selection === null) return;
    const place = () => {
      const rect = box.current?.getBoundingClientRect(); if (!rect) return;
      const tipWidth = Math.min(320, window.innerWidth - 32);
      const center = rect.left + (selection + .5) / width * rect.width;
      setLeft(Math.max(16, Math.min(window.innerWidth - tipWidth - 16, center - tipWidth / 2)) - rect.left);
    };
    place(); window.addEventListener("resize", place); return () => window.removeEventListener("resize", place);
  }, [selection, width]);
  return <div ref={box} className="mp-daily-bars" role="slider" tabIndex={0} aria-label={`Daily regime mix for the last ${columns.length} daily closes`} aria-valuemin={0} aria-valuemax={width - 1} aria-valuenow={shown.slot} aria-valuetext={reading} aria-describedby={selected ? tipId : undefined} onFocus={() => setSelection((value) => value ?? latest.slot)} onBlur={() => setSelection(null)} onKeyDown={keys} onPointerLeave={(event) => { if (event.pointerType !== "touch") setSelection(null); }}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" onPointerMove={pick} onPointerDown={(event) => { box.current?.focus(); pick(event); }}>
      {rows.map((row) => { if (!row.total) return null; let y = height; return ORDER.map((key) => { const h = (row.n[key] || 0) / row.total * height; if (!h) return null; y -= h; return <rect key={`${row.ts}-${key}`} x={row.slot + .08} width={.84} y={y} height={h} style={{ fill: COLORS[key], opacity: row === latest ? 1 : .62 }} />; }); })}
      <line x1="0" x2={width} y1={height * .45} y2={height * .45} className="mp-breadth-guide" vectorEffect="non-scaling-stroke" />
      {selected && <rect x={selected.slot} width="1" height={height} className="mp-selected-day" vectorEffect="non-scaling-stroke" />}
    </svg>
    {selected && <div className="mp-history-tip" id={tipId} role="tooltip" style={{ left }}><time>{day(selected.ts)}<small>Daily close · UTC</small></time>{selected.total ? groups.map(({ key, count, names }) => <div className="mp-history-group" key={key}><span><i style={{ background: COLORS[key] }} />{REGIME[key]}<b>{count}</b></span><p>{names || "Coin names unavailable"}</p></div>) : <p>No reading</p>}</div>}
  </div>;
}

function Gauge({ context, now }) {
  const value = context?.sentiment?.fear_greed_value;
  const valid = Number.isFinite(value) && value >= 0 && value <= 100;
  const band = valid ? Math.min(4, Math.max(0, Math.ceil(value / 20) - 1)) : -1;
  const labels = ["Extreme fear", "Fear", "Neutral", "Greed", "Extreme greed"];
  const arcs = ["M24,110 A86,86 0 0 1 39.25,61.10", "M41.63,57.83 A86,86 0 0 1 81.50,28.86", "M85.36,27.61 A86,86 0 0 1 134.64,27.61", "M138.50,28.86 A86,86 0 0 1 178.37,57.83", "M180.75,61.10 A86,86 0 0 1 196,110"];
  const stale = !context?.sentiment_at || now - context.sentiment_at > 87600;
  return <div className={`mp-gauge${stale ? " stale" : ""}`} title={`Alternative.me market-wide index, 0–100. ${stamp(context?.sentiment_at)}. Not coin-specific.`}><svg viewBox="14 17 192 101" role="img" aria-label={valid ? `${value} out of 100, ${labels[band]}` : "Sentiment unavailable"}>{arcs.map((path, i) => <path key={path} d={path} className={`mp-gauge-arc band-${i}${i === band ? " active" : ""}`} />)}{valid && <g transform={`rotate(${-90 + value * 1.8} 110 110)`}><path d="M110 29 110 110" className="mp-gauge-needle" /><circle cx="110" cy="24" r="5.5" className={`mp-gauge-marker band-${band}`} /></g>}<circle cx="110" cy="110" r="5" className="mp-gauge-hub" /></svg><div><span>Fear &amp; Greed</span><strong>{valid ? value : "—"}<small>{valid ? labels[band] : "Unavailable"}</small></strong></div></div>;
}

function SummaryBand({ markets, scopeRows, scope, selectedSignal, onSignal, now }) {
  const live = {}, members = {};
  for (const coin of markets.coins || []) if (coin.regime_1d && currentEngine(coin.engine_comparison?.["1d"], now)) { live[coin.regime_1d] = (live[coin.regime_1d] || 0) + 1; (members[coin.regime_1d] ||= []).push(coin.und); }
  for (const names of Object.values(members)) names.sort();
  const measured = Object.values(live).reduce((sum, count) => sum + count, 0);
  const lead = ORDER.filter((key) => live[key]).sort((a, b) => live[b] - live[a]);
  const columns = (markets.breadth_1d?.rows || []).map(([ts, ...counts], index) => ({ ts, n: Object.fromEntries((markets.breadth_1d?.cols || []).map((key, i) => [key, counts[i] || 0])), members: markets.breadth_1d?.members?.[index] ? Object.fromEntries(markets.breadth_1d.cols.map((key, i) => [key, markets.breadth_1d.members[index][i]])) : null }));
  const bar = markets.bars?.["1d"], last = columns[columns.length - 1];
  if (Number.isFinite(bar) && measured) { if (last?.ts === bar) { last.n = live; last.members = members; } else if (!last || last.ts < bar) columns.push({ ts: bar, n: live, members }); }
  const signals = LADDER.map((signal) => ({ signal, count: scopeRows.filter((coin) => currentEngine(coin.engine_comparison?.["1d"], now) && matches(coin, signal)).length })).filter((row) => row.count || row.signal === selectedSignal);
  const consensus = markets.consensus_detail?.["1d"]?.status === "unavailable" ? null : markets.consensus?.["1d"];
  return <section className="mp-summary" aria-label="Daily market structure">
    <div className="mp-summary-cell mp-summary-consensus"><span>Market · daily close</span><strong>{CONSENSUS[consensus] || "Consensus unavailable"}</strong>{lead[0] && <small><b>{live[lead[0]]}/{measured}</b> {REGIME[lead[0]]}</small>}</div>
    <div className="mp-summary-cell mp-summary-history"><div className="mp-regime-key">{lead.map((key) => <span key={key}><i style={{ background: COLORS[key] }} />{REGIME[key]}<b>{live[key]}</b></span>)}</div>{columns.length ? <DailyBars columns={columns} /> : <span className="cp-empty">No regime history</span>}</div>
    <div className="mp-summary-cell mp-summary-signals"><span>Daily setups · {scopes[scope]}</span><div className="mp-signal-filters" role="group" aria-label="Filter daily setups">{!signals.length && <small className="mp-muted">No current daily setups in this view</small>}{signals.map(({ signal, count }) => <button key={signal} aria-pressed={selectedSignal === signal} onClick={() => onSignal(selectedSignal === signal ? null : signal)}>{SIGNAL_LABEL[signal]}<b>{count}</b></button>)}</div><div className="mp-signal-share" aria-hidden="true">{signals.filter((row) => row.count).map(({ signal, count }) => <i key={signal} style={{ flex: count }} className={SIGNAL_RANK[signal] >= 5 ? "up" : SIGNAL_RANK[signal] >= 3 ? "base" : "neutral"} />)}</div></div>
    <div className="mp-summary-cell mp-summary-fear"><Gauge context={markets.context} now={now} /></div>
  </section>;
}

function Trace({ coin }) {
  const geometry = traceGeometry(coin.spark_1d || [], 112, 34, 3);
  if (!geometry) return <span className="mp-muted">No close history</span>;
  return <svg className="mp-trace" viewBox="0 0 112 34" role="img" aria-label={`${coin.und}: ${coin.spark_1d.length} daily closes, ${stamp(coin.spark_times_1d?.[0])} to ${stamp(coin.spark_times_1d?.at(-1))}`}><path d={geometry.path} className={geometry.change > 0 ? "up" : geometry.change < 0 ? "down" : "neutral"} /></svg>;
}

function Reading({ reading, kind, coin }) {
  const regime = kind === "engine" && reading.state ? REGIME[reading.row?.regime] : null;
  return <div className={`mp-reading ${reading.state || "missing"}`}><strong>{regime || reading.label}</strong><small>{regime ? reading.label : kind === "wallets" && reading.state ? `${reading.row?.positions ?? "—"} positions` : kind === "options" && reading.state ? reading.row?.status === "skew_only" ? "From skew" : "Skew + recorded flow" : reading.why ? "Open for the reason" : ""}</small></div>;
}

function Evidence({ coin, horizon, now, navigate }) {
  const engine = viewReading(coin.align, horizon, "engine", now), wallets = viewReading(coin.align, horizon, "wallets", now), options = viewReading(coin.align, horizon, "options", now);
  const days = horizon === "7d" ? 7 : 30;
  const toNumber = (value) => Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
  return <div className="mp-evidence"><div className="mp-evidence-grid">
    <section><span className="mp-evidence-label">Daily regime</span><h3>{engine.state ? REGIME[engine.row?.regime] || engine.label : engine.label}</h3><p>{engine.state ? REGIME_LINE[engine.row?.regime] : engine.why}</p><p>{engine.state ? SIGNAL_LINE[engine.row?.signal] : null}</p><dl><div><dt>Daily signal</dt><dd>{engine.label}</dd></div><div><dt>Evaluated daily closes</dt><dd>{toNumber(engine.row?.history_bars)}</dd></div><div><dt>Observation</dt><dd>{stamp(engine.row?.observed_at)}</dd></div></dl></section>
    <section><span className="mp-evidence-label">Smart-wallet positioning</span><h3>{wallets.label}</h3><p>{wallets.state ? `Options expiring within ${days} days, valued on recorded quotes. Delta measures sensitivity to a small coin-price move; it is not a full portfolio.` : wallets.why}</p><dl><div><dt>Net dollar delta</dt><dd>{usd(wallets.row?.net_delta_usd)}</dd></div><div><dt>Gross dollar delta</dt><dd>{usd(wallets.row?.gross_delta_usd)}</dd></div><div><dt>Wallet–instrument positions</dt><dd>{toNumber(wallets.row?.positions)}</dd></div><div><dt>Estimated / missing positions</dt><dd>{toNumber(wallets.row?.estimated_positions)} / {toNumber(wallets.row?.missing_positions)}</dd></div><div><dt>Valued at</dt><dd>{stamp(wallets.row?.valuation_at)}</dd></div></dl></section>
    <section><span className="mp-evidence-label">Option prices</span><h3>{options.label}</h3><p>{options.state ? `${days}-day tenor, with ${days === 7 ? "24-hour" : "7-day"} recorded flow. ${options.row?.status === "skew_only" ? "This reading uses skew alone." : "A reading of option pricing and collected trades."}` : options.why}</p><dl><div><dt>Skew-history samples</dt><dd>{toNumber(options.row?.relative_skew?.samples)}</dd></div><div><dt>Recorded flow coverage</dt><dd>{percent(options.row?.flow_coverage?.fraction)}</dd></div><div><dt>30-day implied volatility</dt><dd>{percent(coin.atm_iv_30d)}</dd></div><div><dt>Observation</dt><dd>{stamp(options.row?.observed_at)}</dd></div></dl></section>
  </div><div className="mp-evidence-footer"><span>Context, not a signal. The three views are independent.</span>{coin.questions && <button className="cp-button quiet" onClick={() => navigate("saloon", { coin: coin.und })}>See {coin.und} price outcomes <Arrow /></button>}</div></div>;
}

export default function MarketsPrototype({ data, navigate }) {
  const markets = data.markets, now = data.snapshotAt;
  const [scope, setScope] = useState("options"), [horizon, setHorizon] = useState("7d"), [query, setQuery] = useState(""), [sort, setSort] = useState("name"), [signal, setSignal] = useState(null), [expanded, setExpanded] = useState(null);
  const scoped = useMemo(() => (markets.coins || []).filter((coin) => inScope(coin, scope) && `${coin.und} ${ASSET_NAMES[coin.und] || ""}`.toLowerCase().includes(query.trim().toLowerCase())), [markets, scope, query]);
  const rows = useMemo(() => scoped.filter((coin) => !signal || currentEngine(coin.engine_comparison?.["1d"], now) && matches(coin, signal)).sort((a, b) => sort === "change" ? (Number.isFinite(b.chg_1d) ? b.chg_1d : -Infinity) - (Number.isFinite(a.chg_1d) ? a.chg_1d : -Infinity) || a.und.localeCompare(b.und) : a.und.localeCompare(b.und)), [scoped, signal, sort, now]);
  const changeScope = (value) => { setScope(value); setSignal(null); setExpanded(null); };
  const days = horizon === "7d" ? 7 : 30;
  return <div className="mp-page cp-page"><header className="mp-page-head"><div><span className="cp-eyebrow">Research / Markets</span><h1>See the market from three sides.</h1><p>Price trend, trader positioning and option prices. Read them together.</p></div><div className="mp-observed"><span>Latest daily close</span><b>{stamp(markets.bars?.["1d"])}</b><small>Context, not a signal</small></div></header>
    <SummaryBand markets={markets} scopeRows={scoped} scope={scope} selectedSignal={signal} onSignal={setSignal} now={now} />
    <section className="mp-board" aria-label="Market readings"><div className="mp-board-toolbar"><div className="mp-scope-tabs" role="group" aria-label="Market type">{[["options", "Options markets"], ["entries", "Daily entries"], ["perps", "Perps only"]].map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => changeScope(key)}>{label}</button>)}</div><div className="mp-find"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12 12 4 4" /></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a market" aria-label="Find a market" /></div></div>
    <div className="mp-board-context"><span><b>{rows.length}</b> {scopes[scope]}{signal ? ` · ${SIGNAL_LABEL[signal]}` : ""}{query.trim() ? ` · “${query.trim()}”` : ""}</span><label>Sort <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort markets"><option value="name">Coin name</option><option value="change">Daily change</option></select></label><div className="mp-window-control"><span>Options window</span><div role="group" aria-label="Options window">{[["7d", "7 days"], ["30d", "30 days"]].map(([key, label]) => <button key={key} aria-pressed={horizon === key} onClick={() => setHorizon(key)}>{label}</button>)}</div></div></div>
    <div className="mp-column-head" aria-hidden="true"><span>Market<small>Index · daily-close change</small></span><span>Price history<small>60 daily closes</small></span><span>Daily regime<small>Latest completed UTC close</small></span><span>Wallet positioning<small>Options expiring within {days} days</small></span><span>Option prices<small>{days}-day tenor · {days === 7 ? "24-hour" : "7-day"} flow</small></span><span /></div>
    <div className="mp-market-rows">{rows.map((coin) => { const open = expanded === coin.und; const readings = ["engine", "wallets", "options"].map((kind) => viewReading(coin.align, horizon, kind, now)); return <article className={`mp-market${open ? " open" : ""}`} key={coin.und}><button className="mp-market-row" aria-expanded={open} aria-controls={`mp-evidence-${coin.und}`} onClick={() => setExpanded(open ? null : coin.und)}><span className="mp-asset"><img src={coinImage(coin.und)} width="32" height="32" alt="" /><span><b>{coin.und}<small>{ASSET_NAMES[coin.und] || coin.und}</small></b><span className="mp-price">${price(coin.price)}<small className={coin.chg_1d > 0 ? "up" : coin.chg_1d < 0 ? "down" : "neutral"}>{chg(coin.chg_1d)}</small></span></span></span><span className="mp-trace-cell"><Trace coin={coin} /></span>{["engine", "wallets", "options"].map((kind, index) => <span className={`mp-reading-cell ${kind}`} key={kind}><span className="mp-mobile-label">{kind === "engine" ? "Daily regime" : kind === "wallets" ? `Wallets · within ${days} days` : `Options · ${days}-day tenor`}</span><Reading reading={readings[index]} coin={coin} kind={kind} /></span>)}<span className="mp-row-chevron" aria-hidden="true">{open ? "−" : "+"}</span></button>{open && <div id={`mp-evidence-${coin.und}`}><Evidence coin={coin} horizon={horizon} now={now} navigate={navigate} /></div>}</article>; })}</div>
    {!rows.length && <div className="mp-empty"><h3>No markets in this view.</h3><button className="cp-button quiet" onClick={() => { setQuery(""); setSignal(null); setScope("options"); }}>Reset filters</button></div>}
    <div className="mp-board-footer"><span>Open a market to see the evidence and observation times.</span><details><summary>How to read this board</summary><p>Daily regime uses completed daily closes and does not change with the options window. Wallet positioning uses Smart wallets’ option expiries within the selected window. Option prices use a constant {days}-day tenor and {days === 7 ? "24-hour" : "7-day"} flow. The columns do not form one score. Markets are sorted only by name or daily price change.</p><p>The history strip counts every market with a current daily engine, including perps-only markets. One separated bar per daily close; the dashed line marks 55% trending up. Setup counts follow the selected market type and search. Daily change compares the last two completed UTC closes, while the displayed price is the latest published index.</p></details></div>
    </section>
  </div>;
}
