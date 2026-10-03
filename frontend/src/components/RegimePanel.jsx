// The Regime step explained: a header (1D regime with its daily strip, signal with one plain
// reason, 4H), readings under the chart (z-score, heat, ribbon) and the nine entry checks.
// Reads coins/{UND}.json only: latest rows, history.engine, the published ribbon trail and
// engine_context. Every colour comes from a token; nothing is recomputed in the browser.
import { Info, Signal, Empty } from "./ui.jsx";
import { DASH, REGIME, SIGNAL_LABEL, title, dayTime } from "../lib/format.js";
import { SIGNAL_HELP } from "../lib/explain.js";
import { STATUS_NAMES } from "../lib/presentation.js";
import {
  REGIME_COLORS, REGIME_SHORT, REGIME_LINE, REGIME_INFO, Z_INFO, HEAT_INFO, BAND_INFO, RIBBON_INFO, CHECKS_INFO,
  RIBBON_STATE, HEAT_PHASE, checks, bandGate, against, whyLine, lastRun, fmtZ,
} from "../lib/regime.js";

const DAYS = 90;
const DAY = 86400;
const FULL_HISTORY = 499;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (t) => { const d = new Date(t * 1000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const warming = (row) => !!row?.data_status && row.data_status !== "ready";

/** A strip of daily cells, oldest left; missing days stay empty. */
function Strip({ cells, label }) {
  return (
    <span className="day-strip" role="img" aria-label={label} style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((c, i) => <i key={i} title={c.title} style={c.color ? { background: c.color } : undefined} />)}
    </span>
  );
}

/** The last 90 daily closes of the engine history on a day axis: [{open, regime, zscore, heat}] or null per day. */
export function engineDays(history, days = DAYS) {
  const rows = history?.engine?.["1d"] || [];
  if (!rows.length) return [];
  const byClose = new Map(rows.map((r) => [r.ts, r]));
  const end = rows[rows.length - 1].ts;
  return Array.from({ length: days }, (_, i) => {
    const close = end - (days - 1 - i) * DAY;
    return { open: close - DAY, row: byClose.get(close) || null };
  });
}

/** The current regime's run over the whole published history: "since 13 Jul · 82d", or "120d+" when it reaches the start. */
function regimeRun(history, regime) {
  const rows = history?.engine?.["1d"] || [];
  const [cur, n, start] = lastRun(rows.map((r) => r.regime ?? null));
  if (!cur || cur !== regime || start < 0) return null;
  const first = rows.findIndex((r) => r.regime != null);
  return start === first ? `${n}d+` : `since ${md(rows[start].ts - DAY)} · ${n}d`;
}

/** current: the 1D engine reading is fresh; status: its published status when it is not (e.g. "ready" but expired, "unavailable"). */
export function RegimeHeader({ row, row4, history, current = true, current4 = true, status = null }) {
  if (!row) return null;
  const early = warming(row);
  const four = row4 && current4 && !warming(row4);
  const fourStatus = row4 ? STATUS_NAMES[row4.data_status && row4.data_status !== "ready" ? row4.data_status : "stale"] : null;
  const days = engineDays(history);
  const cells = days.map(({ open, row: r }) => ({
    color: r?.regime ? REGIME_COLORS[r.regime] : null,
    title: `${md(open)} · ${r?.regime ? REGIME[r.regime] || title(r.regime) : "No reading"}`,
  }));
  const run = early ? null : regimeRun(history, row.regime);
  const bars = Math.min(FULL_HISTORY, row.history_bars || 0);
  const list = checks(row, null);
  // While warming up the regime cell already carries the bar count, so the signal cell needs no reason line.
  const why = current ? whyLine(row, list) : `Last reading at the ${dayTime(row.signal_bar_close_time)} close.`;
  return (
    <div className={`regime-head${early ? " early" : ""}`}>
      <div className="rh-cell rh-regime">
        <span className="rh-key">1D regime <Info label="About the regime">{REGIME_INFO} {!early && REGIME_LINE[row.regime]}</Info></span>
        {early ? (
          <>
            <strong style={{ "--rc": "var(--faint)" }}>Warming up</strong>
            <span className="rh-sub">{REGIME_SHORT.FLAT}</span>
            <div className="rh-strip">
              <span className="rh-meter" role="img" aria-label={`Price history ${bars} of ${FULL_HISTORY} bars`}><i style={{ width: `${(bars / FULL_HISTORY) * 100}%` }} /></span>
              <span className="rh-since mono">{row.history_bars ?? DASH} of {FULL_HISTORY} bars</span>
            </div>
          </>
        ) : (
          <>
            <strong style={{ "--rc": REGIME_COLORS[row.regime] || "var(--faint)" }}>{REGIME[row.regime] || title(row.regime)}{!current && <small className="rh-stale">{STATUS_NAMES[!status || status === "ready" ? "stale" : status] || STATUS_NAMES.unavailable}</small>}</strong>
            <span className="rh-sub">{REGIME_SHORT[row.regime]}</span>
            {cells.length > 0 && (
              <div className="rh-strip">
                <Strip cells={cells} label={`Daily regime over ${cells.length} days${run ? `, ${REGIME[row.regime]} ${run}` : ""}`} />
                {run && <span className="rh-since mono">{run}</span>}
              </div>
            )}
          </>
        )}
      </div>
      <div className="rh-cell rh-signal">
        <span className="rh-key">Signal {!early && SIGNAL_HELP[row.signal] && <Info label="About the signal">{SIGNAL_HELP[row.signal]}</Info>}</span>
        {early ? <b className="rh-none">No signal yet</b> : <Signal s={row.signal} explain={false} />}
        {!early && <span className="rh-why">{why}</span>}
      </div>
      <div className="rh-cell rh-four">
        <span className="rh-key">4H</span>
        <b>{four ? REGIME[row4.regime] || title(row4.regime) : fourStatus || "Unavailable"}</b>
        <span className="rh-sub">{four ? SIGNAL_LABEL[row4.signal] || DASH : DASH}</span>
      </div>
    </div>
  );
}

/** Linear gauge: track, shaded check range, coloured zones, 90-day range whisker, needle. */
function Gauge({ value, min, max, shade, zones = [], ticks, range, ends }) {
  const x = (v) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 100;
  const has = typeof value === "number" && Number.isFinite(value);
  const clipped = has && (value < min || value > max);
  return (
    <div className="gauge" aria-hidden="true">
      <div className="g-track">
        {zones.map(([a, b, cls]) => <i key={cls} className={`g-zone ${cls}`} style={{ left: `${x(a)}%`, width: `${x(b) - x(a)}%` }} />)}
        {shade && <i className="g-shade" style={{ left: `${x(shade[0])}%`, width: `${x(shade[1]) - x(shade[0])}%` }} />}
        {range && <i className="g-range" style={{ left: `${x(range[0])}%`, width: `${Math.max(0.6, x(range[1]) - x(range[0]))}%` }} />}
        {has && <i className={`g-needle${clipped ? " clipped" : ""}`} style={{ left: `${x(value)}%` }} />}
      </div>
      <div className="g-ticks mono">
        {ticks.map(([v, t]) => <span key={v} style={{ left: `${x(v)}%` }}>{t}</span>)}
      </div>
      {ends && <div className="g-ends"><span>{ends[0]}</span><span>{ends[1]}</span></div>}
    </div>
  );
}

const span = (vals) => {
  const v = vals.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? [Math.min(...v), Math.max(...v)] : null;
};

/** The ribbon trail's last 90 days, with the state at the last close and its run over the whole trail. */
export function ribbonView(trail, candles, days = DAYS) {
  const chars = (trail || "").split("");
  const all = chars.map((ch) => RIBBON_STATE[ch] || null);
  const last = all.length ? all[all.length - 1] : null;
  const [state, n, start] = last ? lastRun(all) : [null, 0, -1];
  const from = Math.max(0, chars.length - days);
  const cells = all.slice(from).map((s, i) => {
    const t = candles?.[from + i]?.[0];
    return { color: s ? `var(--ribbon-${s})` : null, title: `${Number.isFinite(t) ? md(t) : ""}${Number.isFinite(t) ? " · " : ""}${s ? title(s) : "No reading"}` };
  });
  return { state, run: n, open: start === 0, cells };
}

export function Readings({ row, history, ribbon, candles }) {
  if (!row) return null;
  const early = warming(row);
  const rows = engineDays(history).map((d) => d.row).filter(Boolean);
  const zr = span(rows.map((r) => r.zscore));
  const hr = span(rows.map((r) => r.heat));
  const rb = ribbonView(ribbon, candles);
  // Older site files carry no trail: the latest state alone, without a strip.
  const state = ribbon != null ? rb.state : row.ribbon?.state || null;
  const gate = bandGate(row);
  const z = early ? null : row.zscore;
  const heat = typeof row.heat === "number" ? row.heat : null;
  return (
    <div className="readings">
      <div className="rd-cell">
        <div className="rd-head"><span className="rh-key">Z-score <Info label="About the z-score">{Z_INFO}</Info></span>
          <b className="mono">{early ? <Empty /> : fmtZ(z)}</b>
          {early && <span className="rd-band">{STATUS_NAMES["warming up"]}</span>}</div>
        <Gauge value={z} min={-3} max={3} shade={[-0.5, 2.5]} range={early ? null : zr} ticks={[[-2, "−2"], [0, "0"], [2, "+2"]]} ends={["Below trend", "Above trend"]} />
      </div>
      <div className="rd-cell">
        <div className="rd-head"><span className="rh-key">Heat <Info label="About heat">{HEAT_INFO} {HEAT_PHASE[row.heat_phase] || ""}</Info></span>
          <b className="mono">{heat ?? <Empty />}</b>
          {gate && <span className={`rd-band ${gate.status}`}>{gate.status === "unknown" ? gate.value : `${gate.value} band`} <Info label="About the weekly band">{BAND_INFO}</Info></span>}</div>
        <Gauge value={heat} min={0} max={100} zones={[[85, 95, "warm"], [95, 100, "hot"]]} range={hr} ticks={[[0, "0"], [70, "70"], [85, "85"], [95, "95"]]} />
      </div>
      <div className="rd-cell">
        <div className="rd-head"><span className="rh-key">Ribbon <Info label="About the ribbon">{RIBBON_INFO}</Info></span>
          <b className={`ribbon-name ${state || "none"}`}>{state ? title(state) : <Empty />}</b>
          {state && rb.run > 0 && <span className="rd-len mono">{rb.open ? `${rb.run}d+` : `${rb.run}d`}</span>}</div>
        {rb.cells.length > 0 && <>
          <Strip cells={rb.cells} label={`Ribbon over ${rb.cells.length} days: ${state || "unavailable"}${state ? ` for ${rb.run} days` : ""}`} />
          <div className="g-ends"><span>{rb.cells.length}d</span><span>Today</span></div>
        </>}
      </div>
    </div>
  );
}

const MARK = { pass: "✓", fail: "×", unknown: "?" };
const MARK_LABEL = { pass: "Passed", fail: "Not passed", unknown: "Unavailable" };

export function Checks({ row, ctx }) {
  if (!row?.conditions_detail?.length) return null;
  const list = checks(row, ctx);
  const gate = bandGate(row);
  const passed = list.filter((c) => c.status === "pass").length;
  const notes = against(row, list, gate);
  return (
    <section className={`checks${notes.length ? "" : " solo"}`} aria-label="Entry checks">
      <div className="checks-list">
        <span className="rh-key">Checks · <b className="mono">{passed}/{list.length}</b> <Info label="About the checks">{CHECKS_INFO}</Info></span>
        <ul>
          {list.map((c) => (
            <li key={c.name} data-s={c.status}>
              <i aria-label={MARK_LABEL[c.status]}>{MARK[c.status]}</i>
              <span>{c.label}</span>
              <b className="mono">{c.value}</b>
              <Info label={`Rule: ${c.label}`}>{c.rule}</Info>
            </li>))}
        </ul>
        {gate && <p className="checks-gate" data-s={gate.status}><i aria-label={MARK_LABEL[gate.status]}>{MARK[gate.status]}</i>Weekly band <b className="mono">{gate.value}</b></p>}
      </div>
      {notes.length > 0 && (
        <div className="checks-against">
          <span className="rh-key">Against it now</span>
          <ul>{notes.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>)}
    </section>
  );
}
