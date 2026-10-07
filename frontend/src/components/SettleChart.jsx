import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, ColorType, CrosshairMode, LineStyle } from "lightweight-charts";
import { cssVar, price } from "../lib/format.js";
import { money } from "../lib/questions.js";
import { recentBars, useLivePrice } from "../lib/livePrice.js";

const STEP = { "4h": 14400, "1d": 86400 };
// Up to 10 days to settlement the 4-hour candles, beyond that the daily ones (the Saloon's 7- and 30-day windows).
export const settleFrame = (settleTs, now = Date.now() / 1000) => (settleTs - now <= 10 * 86400 ? "4h" : "1d");

/** The candles to show and the empty future up to the settlement time, so it sits at its true distance. */
export function settleBars(candles, settleTs, tf, keep = 120) {
  const rows = (candles || []).slice(-keep);
  const bars = rows.map(([t, o, h, l, c]) => ({ time: t, open: o, high: h, low: l, close: c }));
  if (!bars.length) return bars;
  const step = STEP[tf];
  for (let t = bars[bars.length - 1].time + step; t < settleTs; t += step) bars.push({ time: t });
  if (settleTs > bars[bars.length - 1].time) bars.push({ time: settleTs });
  bars.push({ time: Math.max(settleTs, bars[bars.length - 1].time) + step }); // a little room after the settlement
  return bars;
}

/** Where an answer pays at settlement, in price: the full-payout side and the pays-in-part zone. */
export function payZones(lo, hi, side) {
  const part = { from: lo, to: hi };
  if (side === "yes") return { full: { from: hi, to: Infinity }, part };
  if (side === "no") return { full: { from: -Infinity, to: lo }, part };
  return { full: null, part };
}

/**
 * The coin's candles and, to their right, the time left to the settlement (a line at 08:00 UTC on the date),
 * with the levels that decide what an answer pays drawn into that future: where it pays in full (tinted in the
 * answer's colour), where it pays in part (a faint band), the breakeven, and the price now. Without an answer
 * (the board's quick look) it draws the date's levels as dotted lines.
 */
export default function SettleChart({ und, candles, index, settleTs, lo = null, hi = null, side = null, breakeven = null,
  levels = [], theme, compact = false, label, payout = null }) {
  const box = useRef(null);
  const over = useRef(null);
  const tip = useRef(null);
  const applyLive = useRef(null);
  const lp = useLivePrice(und);
  const lpRef = useRef(lp);
  lpRef.current = lp;
  const payRef = useRef(payout);
  payRef.current = payout;
  const tf = settleFrame(settleTs);
  const rows = candles?.[tf];
  useEffect(() => {
    if (!box.current || !rows?.length || !settleTs) return;
    const c = (n) => cssVar(n);
    const chart = createChart(box.current, {
      autoSize: true,
      localization: { priceFormatter: price, locale: "en-US" },
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c("--muted"), fontFamily: "Chivo Mono, monospace", fontSize: compact ? 10 : 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: c("--seam") + "99" } },
      rightPriceScale: { borderColor: c("--seam") },
      timeScale: { borderColor: c("--seam"), timeVisible: tf === "4h", rightOffset: 0, fixLeftEdge: true },
      crosshair: { mode: compact ? CrosshairMode.Hidden : CrosshairMode.Normal, vertLine: { color: c("--faint"), labelBackgroundColor: c("--plate-3") }, horzLine: { color: c("--faint"), labelBackgroundColor: c("--plate-3") } },
      handleScroll: !compact, handleScale: !compact,
    });
    const up = c("--up"), down = c("--down");
    const bes = [].concat(breakeven ?? []).filter((v) => Number.isFinite(v));
    const marks = [lo, hi, ...bes, index, ...levels].filter((v) => Number.isFinite(v));
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down, lastValueVisible: false, priceLineVisible: false,
      // Keep every level in view, not only the candles.
      autoscaleInfoProvider: (base) => {
        const r = base();
        if (!r || !marks.length) return r;
        const span = Math.max(...marks, r.priceRange.maxValue) - Math.min(...marks, r.priceRange.minValue);
        return { ...r, priceRange: { minValue: Math.min(...marks, r.priceRange.minValue) - span * 0.04, maxValue: Math.max(...marks, r.priceRange.maxValue) + span * 0.04 } };
      },
    });
    // About two to three times as much past as future, so the time left to the settlement stays readable.
    const keep = tf === "4h" ? (compact ? 48 : 72) : (compact ? 45 : 60);
    const bars = settleBars(rows, settleTs, tf, keep);
    candle.setData(bars);
    const line = (p, color, title, style = LineStyle.Dotted, width = 1) => candle.createPriceLine({ price: p, color, lineWidth: width, lineStyle: style, axisLabelVisible: !compact || title === "Now", title: compact ? "" : title });
    const nowLine = Number.isFinite(index) ? line(index, c("--fg"), "Now", LineStyle.Solid) : null;
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      line(hi, side === "yes" ? up : c("--muted"), side === "yes" ? "Full payout" : "");
      line(lo, side === "no" ? down : c("--muted"), side === "no" ? "Full payout" : "");
    }
    for (const k of levels) line(k, c("--muted"), "");
    for (const b of bes) line(b, c("--fg"), "Breakeven", LineStyle.Dashed, 1);
    let lastT = rows[rows.length - 1][0];
    let last = { ...bars.find((b) => b.time === lastT) };
    // Live prices from Derive's index feed: the last candle moves with each one, the next opens when its period
    // starts, and the Now line follows.
    applyLive.current = (p, at) => {
      const step = STEP[tf];
      if (at >= lastT + step) {
        const t = lastT + Math.floor((at - lastT) / step) * step;
        if (!bars.some((b) => b.time === t)) return;
        last = { time: t, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p };
        lastT = t;
      } else if (at >= lastT) {
        last = { ...last, high: Math.max(last.high, p), low: Math.min(last.low, p), close: p };
      } else return;
      try { candle.update(last, true); } catch { return; }
      nowLine?.applyOptions({ price: p });
      schedule();
    };
    // The settlement line and the pay zones are drawn over the chart, from the last candle to the settlement.
    const draw = () => {
      const host = over.current;
      if (!host || !box.current) return;
      const ts = chart.timeScale();
      const pane = ts.width();
      const xNow = ts.timeToCoordinate(lastT), xSet = ts.timeToCoordinate(settleTs);
      const y = (p) => (p === Infinity ? 0 : p === -Infinity ? box.current.clientHeight - 26 : candle.priceToCoordinate(p));
      const parts = [];
      if (xSet != null && xSet <= pane) {
        parts.push(`<span class="sc-settle" style="left:${xSet}px"></span>`);
        if (!compact) parts.push(`<span class="sc-settle-tag" style="left:${xSet}px">Settles 08:00 UTC</span>`);
      }
      if (xNow != null && xSet != null && Number.isFinite(lo) && Number.isFinite(hi)) {
        const left = Math.max(0, xNow), width = Math.max(0, Math.min(pane, xSet) - left);
        const band = (from, to, cls) => {
          const a = y(to), b = y(from);
          if (a == null || b == null) return;
          const top = Math.max(0, Math.min(a, b)), h = Math.max(0, Math.abs(b - a));
          parts.push(`<span class="${cls}" style="left:${left}px;width:${width}px;top:${top}px;height:${h}px"></span>`);
        };
        const z = payZones(lo, hi, side);
        band(z.part.from, z.part.to, "sc-part");
        if (z.full) band(z.full.from, z.full.to, `sc-full ${side}`);
      }
      host.innerHTML = parts.join("");
    };
    // Pointing at the future (owner, 7 October 2026): what the amount pays if the coin settles at that price.
    const onMove = (param) => {
      const el = tip.current;
      if (!el) return;
      const fn = payRef.current;
      const t = param?.time;
      if (!fn || !param?.point || t == null || t <= lastT) { el.hidden = true; return; }
      const p = candle.coordinateToPrice(param.point.y);
      if (!Number.isFinite(p) || p <= 0) { el.hidden = true; return; }
      const o = fn(p);
      if (!o) { el.hidden = true; return; }
      const sign = o.pl > 0.004 ? "+" : o.pl < -0.004 ? "-" : "";
      el.innerHTML = `<span>If ${und} settles at <b>${money(p)}</b></span><span>you get <b>${money(o.payout, { cents: true })}</b> <em class="${o.pl > 0.004 ? "up" : o.pl < -0.004 ? "down" : ""}">${sign}${money(Math.abs(o.pl), { cents: true })}</em></span>`;
      el.hidden = false;
      const w = box.current.clientWidth, x = param.point.x, y = param.point.y;
      el.style.left = `${Math.min(Math.max(8, x + 14), w - el.offsetWidth - 70)}px`;
      el.style.top = `${Math.max(4, y - el.offsetHeight - 10)}px`;
    };
    chart.subscribeCrosshairMove(onMove);
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    // Everything from the first candle to just past the settlement: the future is the point of this chart.
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: bars.length - 1 });
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    ro?.observe(box.current);
    schedule();
    if (lpRef.current) applyLive.current(lpRef.current.price, lpRef.current.ts);
    // The file holds closed bars only: catch up to now (the forming bar too) from Derive's own candles.
    let gone = false;
    recentBars(und, STEP[tf], lastT).then((fresh) => {
      if (gone) return;
      for (const [t, o, h, l, cl] of fresh) {
        if (t < lastT || !bars.some((b) => b.time === t)) continue;
        last = { time: t, open: o, high: h, low: l, close: cl };
        lastT = t;
        try { candle.update(last, true); } catch { return; }
      }
      if (!fresh.length) return;
      nowLine?.applyOptions({ price: last.close });
      if (lpRef.current) applyLive.current?.(lpRef.current.price, lpRef.current.ts);
      schedule();
    }).catch(() => {});
    return () => { gone = true; applyLive.current = null; cancelAnimationFrame(frame); ro?.disconnect(); chart.unsubscribeCrosshairMove(onMove); chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule); chart.remove(); };
  }, [rows, settleTs, tf, lo, hi, side, [].concat(breakeven ?? []).join(","), index, levels.join(","), theme, compact]);
  useEffect(() => { if (lp) applyLive.current?.(lp.price, lp.ts); }, [lp]);
  if (!rows?.length) return <p className="status">The {und} chart is not available right now.</p>;
  const what = side ? `${side === "yes" ? "Higher" : "Lower"} pays in full ${side === "yes" ? `at ${money(hi)} or above` : `at ${money(lo)} or below`}` : "the date's levels";
  return (
    <div className={`sc-frame${compact ? " compact" : ""}${payout ? " tall" : ""}`} role="img" aria-label={label || `${und} ${tf === "4h" ? "4-hour" : "daily"} candles up to the settlement, with ${what}`}>
      <div ref={box} className="sc-box" />
      <div ref={over} className="sc-over" aria-hidden="true" />
      {payout && <div ref={tip} className="sc-tip" hidden aria-hidden="true" />}
    </div>
  );
}
