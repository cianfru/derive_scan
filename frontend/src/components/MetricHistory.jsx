import { useId, useMemo, useState } from "react";
import { PanelHead, Tabs } from "./ui.jsx";
import { REGIME, SIGNAL_LABEL, title, utc, usd } from "../lib/format.js";
import { useElementWidth } from "../lib/useElementWidth.js";
import { coverageReady } from "./HistoryStatus.jsx";
import { historyGeometry, historySource, historyWindow, metricValue, nearestObservation, orderedHistory } from "../lib/history.js";
import "../history.css";

const percent = value => `${(value * 100).toFixed(2)}%`;
const points = value => `${(value * 100).toFixed(2)} pts`;
const exactUsd = value => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const number = value => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const METRICS = {
  engine: [
    { key: "zscore", label: "Price stretch", short: "Stretch", format: value => `${value.toFixed(2)}σ`, zero: true },
    { key: "heat", label: "Heat", short: "Heat", format: number, bounds: [0, 100] },
    { key: "funding_ann", label: "Funding", short: "Funding", format: percent, changeFormat: points, zero: true },
    { key: "oi_usd", label: "Perp OI", short: "OI", format: exactUsd, axis: usd },
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
      {change !== null && <div className="history-change"><span>Window change</span><b>{change > 0 ? "+" : change < 0 ? "−" : ""}{(metric.changeFormat || metric.format)(Math.abs(change))}</b></div>}
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
      {scope === "engine" && selected && <span>{REGIME[selected.regime] || "Regime unavailable"} · {selected.source === "reconstructed" ? "No recorded decision" : SIGNAL_LABEL[selected.signal] || "Decision unavailable"}{selected.ribbon ? ` · Ribbon ${typeof selected.ribbon === "string" ? selected.ribbon : selected.ribbon.state || "unavailable"}` : ""}</span>}
      {selected?.daily && <span>{selected.day_samples} / {selected.day_expected} snapshots in this UTC day</span>}
    </div>
  </div>;
}

export default function MetricHistory({ history, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible);
  const [timeframe, setTimeframe] = useState("1d");
  const [window, setWindow] = useState("30d");
  const [key, setKey] = useState("zscore");
  const scope = "engine";
  const now = Date.now() / 1000;
  const rows = useMemo(() => historyWindow(orderedHistory(history?.engine?.[timeframe] || [], now), window, now), [history, timeframe, window]);
  const metric = METRICS.engine.find(item => item.key === key) || METRICS.engine[0];
  const coverage = history?.coverage?.engine?.[timeframe];
  const cadence = timeframe === "1d" ? 86400 : 14400;
  const recordedStart = coverage?.recorded_from;
  const wallets = history?.coverage?.wallets;
  const expectedWalletDay = new Date((now - 3600 - 86400) * 1000).toISOString().slice(0, 10);
  const walletsReady = coverageReady(wallets) && wallets.through >= expectedWalletDay;
  const info = <>
    The engine's measurements at each {timeframe === "1d" ? "daily" : "4-hour"} close. Solid line: recorded readings{recordedStart != null ? `, from ${dayLabel(recordedStart)}` : ""}. Dashed line: earlier price metrics reconstructed from candles; they never recreate signals, funding or open interest. Gaps stay empty. Funding is the observed hourly rate annualised.
    {" "}Windows show up to 120 days of daily and 30 days of 4-hour readings.
    {coverage?.from != null ? ` Available ${stamp(coverage.from)}` : ""}{coverage?.to != null ? ` to ${stamp(coverage.to)}.` : ""}
    {Number.isFinite(coverage?.reconstructed_count) ? ` ${coverage.recorded_count || 0} recorded engine readings; ${coverage.reconstructed_count} price reconstructions.` : ""}
    {Number.isFinite(coverage?.missing_count) && coverage.missing_count ? ` ${coverage.missing_count} missing intervals.` : ""}
    {wallets ? ` Wallet trade history ${walletsReady ? "current" : "incomplete"}${wallets.through ? ` through ${wallets.through} UTC` : ""}.` : ""}
  </>;
  const headTitle = collapsible
    ? <button type="button" className="fold-toggle" aria-expanded={open} aria-controls="metric-history-body" onClick={() => setOpen(o => !o)}>History<i aria-hidden="true" /></button>
    : "History";
  return <section className={`plate metric-history${open ? " open" : ""}`} id="metric-history" aria-label="Market history">
    <PanelHead title={headTitle} info={open ? info : null} infoLabel="About history" right={open ? <div className="tab-groups">
      <Tabs label="History measurement" value={metric.key} onChange={setKey} items={METRICS.engine.map(item => [item.key, item.short])} />
      <Tabs label="History timeframe" value={timeframe} onChange={setTimeframe} items={[["1d", "1D"], ["4h", "4H"]]} />
      <Tabs label="History window" value={window} onChange={setWindow} items={[["30d", "30D"], ["90d", "90D"], ["all", "All"]]} />
    </div> : null} />
    {open && <div id="metric-history-body" className="metric-history-body">
      <HistoryChart key={`${timeframe}-${metric.key}-${window}`} rows={rows} metric={metric} cadence={cadence} scope={scope} />
    </div>}
  </section>;
}
