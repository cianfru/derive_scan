import { useId, useMemo, useState } from "react";
import { Info, Tabs } from "./ui.jsx";
import { REGIME, SIGNAL_LABEL, title, utc, usd } from "../lib/format.js";
import { useElementWidth } from "../lib/useElementWidth.js";
import { coverageReady } from "./HistoryStatus.jsx";
import { dailyHistory, historyGeometry, historySource, historyWindow, metricValue, nearestObservation, orderedHistory } from "../lib/history.js";
import "../history.css";

const percent = value => `${(value * 100).toFixed(2)}%`;
const points = value => `${(value * 100).toFixed(2)} pts`;
const exactUsd = value => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const number = value => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const METRICS = {
  engine: [
    { key: "zscore", label: "Price stretch", format: value => `${value.toFixed(2)}σ`, zero: true },
    { key: "heat", label: "Heat", format: number, bounds: [0, 100] },
    { key: "funding_ann", label: "Funding", format: percent, changeFormat: points, zero: true },
    { key: "oi_usd", label: "Perp OI", format: exactUsd, axis: usd },
  ],
  options: [
    { key: "atm_iv_30d", label: "30-day IV", format: percent, changeFormat: points },
    { key: "atm_iv_7d", label: "7-day IV", format: percent, changeFormat: points },
    { key: "atm_iv_90d", label: "90-day IV", format: percent, changeFormat: points },
    { key: "rr25_30d", label: "30-day skew", format: points, zero: true },
    { key: "bf25_30d", label: "30-day butterfly", format: points },
    { key: "pc_oi_ratio", label: "Put / call OI", format: value => `${value.toFixed(3)}×` },
    { key: "option_oi_contracts", label: "Option OI", format: value => `${number(value)} contracts`, axis: number },
    { key: "perp_funding_ann", label: "Funding", format: percent, changeFormat: points, zero: true },
    { key: "perp_oi_usd", label: "Perp OI", format: exactUsd, axis: usd },
  ],
};
const SOURCE_NAMES = { recorded: "Recorded", reconstructed: "Price reconstruction" };
const REGIME_COLORS = { MARKUP: "var(--up)", REACC: "#819b77", ACCUM: "#c4b17b", MARKDOWN: "var(--down)", CAP: "var(--down)", BLOWOFF: "var(--orange)", FLAT: "var(--muted)" };
const stamp = ts => Number.isFinite(ts) ? utc(ts) : "Observation time unavailable";
const dayLabel = ts => new Date(ts * 1000).toISOString().slice(0, 10);

export function HistoryChart({ rows, metric, cadence, scope }) {
  const [box, measuredWidth] = useElementWidth(760);
  const width = Math.max(300, measuredWidth), height = 230;
  const geometry = useMemo(() => historyGeometry(rows, metric.key, width, height, cadence, metric), [rows, metric, width, cadence]);
  const [selectedTs, setSelectedTs] = useState(null);
  const descriptionId = useId();
  const selectedIndex = selectedTs == null ? rows.length - 1 : nearestObservation(rows, selectedTs);
  const selected = rows[selectedIndex];
  const value = metricValue(selected, metric.key);
  const source = historySource(selected);
  const positioning = scope === "engine" && ["funding_ann", "oi_usd"].includes(metric.key);
  const measurementStatus = selected?.metric_status?.[metric.key] ?? selected?.status;
  const statusName = measurementStatus === "warmup" ? "Warming up" : title(measurementStatus);
  const valid = geometry?.valid || [];
  const first = valid[0], last = valid.at(-1);
  const change = first && last && first !== last ? last[metric.key] - first[metric.key] : null;
  const exact = value == null ? "Unavailable" : metric.format(value);
  const pick = event => {
    if (!geometry) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const coordinate = (event.clientX - bounds.left) / bounds.width * width;
    const fraction = Math.max(0, Math.min(1, (coordinate - geometry.left) / (width - geometry.left - geometry.right)));
    const index = nearestObservation(rows, geometry.from + fraction * (geometry.to - geometry.from));
    if (index >= 0) setSelectedTs(rows[index].ts);
  };
  const move = event => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowLeft" ? Math.max(0, selectedIndex - 1) : event.key === "ArrowRight" ? Math.min(rows.length - 1, selectedIndex + 1) : null;
    if (next !== null && rows[next]) { event.preventDefault(); setSelectedTs(rows[next].ts); }
  };
  return <div className="metric-history-chart" ref={box}>
    <div className="history-reading" aria-live="polite">
      <div><span className="label">{metric.label}</span><strong>{exact}</strong></div>
      <div className="history-observation"><time>{positioning ? "Bar close · " : ""}{stamp(selected?.ts)}</time><span>{SOURCE_NAMES[source] || "Source unavailable"}{measurementStatus && measurementStatus !== "ready" ? ` · ${statusName}` : ""}{selected?.daily && selected.partial_day ? " · Partial UTC day" : ""}</span>{positioning && <span>{selected?.positioning_at ? `Ticker observed ${stamp(selected.positioning_at)}` : "Ticker observation time was not saved"}</span>}</div>
      {change !== null && <div className="history-change"><span>Change across shown samples</span><b>{change > 0 ? "+" : change < 0 ? "−" : ""}{(metric.changeFormat || metric.format)(Math.abs(change))}</b></div>}
    </div>
    {geometry ? <>
      <p id={descriptionId} className="sr-only">Use left and right arrow keys to inspect observations. Home and End select the first and last sample. Move a pointer or touch the chart to inspect a date. Missing values and collection gaps remain blank.</p>
      <svg className="history-plot" viewBox={`0 0 ${width} ${height}`} role="slider" tabIndex="0"
        aria-label={`${metric.label} history`} aria-describedby={descriptionId} aria-valuemin={0} aria-valuemax={Math.max(0, rows.length - 1)} aria-valuenow={selectedIndex}
        aria-valuetext={`${stamp(selected?.ts)}: ${exact}. ${SOURCE_NAMES[source] || "Source unavailable"}`}
        onKeyDown={move} onPointerDown={pick} onPointerMove={pick}>
        {[geometry.high, (geometry.high + geometry.low) / 2, geometry.low].map((tick, i) => <g key={i}><line className="history-grid" x1={geometry.left} x2={width - geometry.right} y1={geometry.y(tick)} y2={geometry.y(tick)} /><text x={geometry.left - 9} y={geometry.y(tick) + 4} textAnchor="end">{(metric.axis || metric.format)(tick)}</text></g>)}
        {metric.zero && <line className="history-zero" x1={geometry.left} x2={width - geometry.right} y1={geometry.y(0)} y2={geometry.y(0)} />}
        {Object.entries(geometry.paths).map(([kind, path]) => <path key={kind} className={`history-line ${kind === "reconstructed" ? "reconstructed" : "recorded"}`} d={path.trim()} />)}
        {geometry.isolated.map(row => <circle key={row.ts} cx={geometry.x(row.ts)} cy={geometry.y(row[metric.key])} r="3" fill={historySource(row) === "reconstructed" ? "var(--muted)" : "var(--orange)"} />)}
        {selected && <line className="history-crosshair" x1={geometry.x(selected.ts)} x2={geometry.x(selected.ts)} y1={geometry.top} y2={height - geometry.bottom} />}
        {value !== null && <circle cx={geometry.x(selected.ts)} cy={geometry.y(value)} r="4" className="history-selected" />}
        <text x={geometry.left} y={height - 8}>{dayLabel(geometry.from)}</text>
        {geometry.from !== geometry.to && <text x={width - geometry.right} y={height - 8} textAnchor="end">{dayLabel(geometry.to)}</text>}
      </svg>
    </> : <div className="history-empty" role="status">{rows.length ? `No ${metric.label.toLowerCase()} observations in this window.` : "No observations in this window."}</div>}
    <div className="history-context">
      <span>{valid.length.toLocaleString()} usable samples{geometry?.missing ? ` · ${geometry.missing.toLocaleString()} missing` : ""}</span>
      {scope === "engine" && selected && <span>{REGIME[selected.regime] || "Regime unavailable"} · {selected.source === "reconstructed" ? "No recorded decision" : SIGNAL_LABEL[selected.signal] || "Decision unavailable"}{selected.ribbon ? ` · Ribbon ${typeof selected.ribbon === "string" ? selected.ribbon : selected.ribbon.state || "unavailable"}` : ""}</span>}
      {selected?.daily && <span>{selected.day_samples} / {selected.day_expected} snapshots in this UTC day</span>}
    </div>
    {scope === "engine" && geometry && <svg className="history-regime-strip" viewBox={`0 0 ${width} 12`} aria-label="Regimes at the shown observations" role="img">
      {rows.map(row => row.regime && <line key={row.ts} x1={geometry.x(row.ts)} x2={geometry.x(row.ts)} y1="2" y2="10" stroke={REGIME_COLORS[row.regime] || "var(--seam-hi)"} strokeWidth={Math.min(8, Math.max(2, (width - geometry.left - geometry.right) / rows.length * .8))}><title>{stamp(row.ts)}: {REGIME[row.regime] || row.regime}. {SOURCE_NAMES[historySource(row)] || "Source unavailable"}</title></line>)}
    </svg>}
  </div>;
}

export default function MetricHistory({ history }) {
  const [scope, setScope] = useState("engine");
  const [timeframe, setTimeframe] = useState("1d");
  const [sampling, setSampling] = useState("daily");
  const [window, setWindow] = useState("30d");
  const [keys, setKeys] = useState({ engine: "zscore", options: "atm_iv_30d" });
  const now = Date.now() / 1000;
  const interval = history?.coverage?.options?.interval_seconds || 900;
  const rows = useMemo(() => {
    const raw = scope === "engine" ? history?.engine?.[timeframe] || [] : history?.options || [];
    const sampled = scope === "options" && sampling === "daily" ? dailyHistory(raw, now, interval) : orderedHistory(raw, now);
    return historyWindow(sampled, window, now);
  }, [history, scope, timeframe, sampling, window, interval]);
  const metric = METRICS[scope].find(item => item.key === keys[scope]) || METRICS[scope][0];
  const coverage = scope === "engine" ? history?.coverage?.engine?.[timeframe] : history?.coverage?.options;
  const cadence = scope === "engine" ? timeframe === "1d" ? 86400 : 14400 : sampling === "daily" ? 86400 : interval;
  const reconstructed = rows.some(row => historySource(row) === "reconstructed" && metricValue(row, metric.key) !== null);
  const recordedStart = scope === "engine" ? coverage?.recorded_from : coverage?.history_available_from ?? coverage?.from;
  const wallets = history?.coverage?.wallets;
  const expectedWalletDay = new Date((now - 3600 - 86400) * 1000).toISOString().slice(0, 10);
  const walletsReady = coverageReady(wallets) && wallets.through >= expectedWalletDay;
  return <section className="metric-history" id="metric-history" aria-label="Market history">
    <div className="history-heading"><div><span className="section-code">RECORDED THROUGH TIME</span><h2>Market history</h2></div><Info label="About market history">Solid lines are recorded observations. Dashed lines reconstruct price metrics from completed candles; they never recreate final signals, funding, open interest or option surfaces. Warming values use incomplete normalisation. Empty intervals remain gaps. Funding is the observed hourly rate annualised, not a fixed yield. Options use recorded surfaces only; Daily takes the last observed snapshot of each UTC date.</Info></div>
    <div className="history-toolbar"><Tabs label="History source" value={scope} onChange={setScope} items={[["engine", "Price engine"], ["options", "Options & positioning"]]} /><div className="history-window-controls"><Tabs label="History window" value={window} onChange={setWindow} items={[["30d", "30 days"], ["90d", "90 days"], ["all", "Available history"]]} /><Info label="About available history windows">The published view retains up to 120 days of daily engine measurements, 30 days of 4-hour measurements and 90 days of recorded option snapshots. Available history shows that published window, which can be shorter than the selected range. Earlier original readings remain in the recorder archive; past option surfaces before collection are unavailable.</Info></div></div>
    <div className="history-controls"><label className="history-metric-select">Measurement<select value={metric.key} onChange={event => setKeys(previous => ({ ...previous, [scope]: event.target.value }))} aria-label="History measurement">{METRICS[scope].map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label>{scope === "engine" ? <Tabs label="Engine history timeframe" value={timeframe} onChange={setTimeframe} items={[["1d", "Daily"], ["4h", "4 hours"]]} /> : <Tabs label="Options history sampling" value={sampling} onChange={setSampling} items={[["daily", "Daily"], ["snapshots", "Snapshots"]]} />}</div>
    <HistoryChart key={`${scope}-${timeframe}-${sampling}-${metric.key}-${window}`} rows={rows} metric={metric} cadence={cadence} scope={scope} />
    <div className="history-coverage" role="status"><span>{recordedStart != null ? scope === "options" ? `Options recording began ${dayLabel(recordedStart)}; earlier surfaces unavailable from Derive.` : `Original engine readings recorded from ${dayLabel(recordedStart)}.` : "Recorded history is still collecting"}<Info label="History collection coverage">{recordedStart != null ? `Recorded from ${stamp(recordedStart)}. ` : "No recorded starting timestamp. "}{coverage?.from != null ? `Available from ${stamp(coverage.from)}. ` : ""}{coverage?.to != null ? `Through ${stamp(coverage.to)}. ` : ""}{coverage?.requested_from != null ? `Requested from ${stamp(coverage.requested_from)}. ` : ""}{coverage?.requested_to != null ? `Requested through ${stamp(coverage.requested_to)}. ` : ""}{Number.isFinite(coverage?.expected_count) ? `${coverage.observed_count ?? coverage.count ?? 0} of ${coverage.expected_count} ${scope === "engine" ? "bar closes represented" : "snapshots collected"}. ` : ""}{Number.isFinite(coverage?.missing_count) ? `${coverage.missing_count} missing intervals. ` : ""}{Number.isFinite(coverage?.reconstructed_count) ? `${coverage.recorded_count || 0} recorded engine readings; ${coverage.reconstructed_count} price reconstructions. ` : ""}{scope === "options" ? coverage?.limitation || "Past option surfaces cannot be recovered from candles." : "Price reconstruction does not recreate the conditions or decisions that were available live."}</Info></span>{reconstructed && <span><i className="history-source-swatch" />Earlier price metrics reconstructed from candles</span>}{wallets && <span className={walletsReady ? "" : "warn"}>Wallet trade history {walletsReady ? "current" : "incomplete"}{wallets.through ? ` through ${wallets.through} UTC` : ""}<Info label="About history completeness">Price metrics can be reconstructed from past candles. Original engine decisions require a saved reading. Option surfaces require a saved snapshot. Wallet trades can be rebuilt from Derive's trade history; this does not recover historical option surfaces.{wallets.expected_through ? ` Wallet history must reach ${wallets.expected_through} UTC close.` : ""}{!walletsReady && " Wallet readings remain withheld until trade history is current."}</Info></span>}</div>
  </section>;
}
