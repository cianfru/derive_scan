import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, BaselineSeries, createSeriesMarkers, ColorType, CrosshairMode, LineStyle } from "lightweight-charts";
import { cssVar, SIGNAL_LABEL, signalTone } from "../lib/format.js";

const TF_SEC = { "4h": 14400, "1d": 86400 };
const RIBBON = [32, 58];

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = e;
  const k = 2 / (n + 1);
  for (let i = n; i < values.length; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

const TONE_VAR = { strong: "--sig-strong", long: "--sig-long", acc: "--sig-acc", wait: "--sig-wait", exit: "--sig-exit" };

const HORIZON_DAYS = { "4h": 21, "1d": 120 };

const pctFrom = (v, base) => `${v >= base ? "+" : ""}${((v / base - 1) * 100).toFixed(1)}%`;

/** Candles with volume, the ribbon (fast and slow EMAs), a marker wherever the signal changed and,
 * when options exist: the middle half of the outcomes option prices imply for each upcoming
 * expiry (upper edge in the up colour, lower edge in the down colour, so any lean shows), and
 * the levels where open interest sits (call and put walls, max pain). */
export default function CandleChart({ candles, signals, tf, theme, backfilled = 0, implied = null, levels = null }) {
  const box = useRef(null);
  useEffect(() => {
    if (!box.current || !candles?.length) return;
    const c = (n) => cssVar(n);
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c("--muted"), fontFamily: "IBM Plex Mono, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: c("--seam") + "66" }, horzLines: { color: c("--seam") + "66" } },
      rightPriceScale: { borderColor: c("--seam") },
      timeScale: { borderColor: c("--seam"), timeVisible: tf === "4h", rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: c("--faint"), labelBackgroundColor: c("--plate-3") }, horzLine: { color: c("--faint"), labelBackgroundColor: c("--plate-3") } },
    });
    const up = c("--up"), down = c("--down");
    const candle = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
    const bars = candles.map(([t, o, h, l, cl]) => ({ time: t, open: o, high: h, low: l, close: cl }));
    const step = TF_SEC[tf], lastT = candles[candles.length - 1][0], lastC = candles[candles.length - 1][4];
    const cone = (implied || []).filter((e) => e.days <= HORIZON_DAYS[tf]);
    if (cone.length) { // empty future bars so dates in the future sit at their true distance
      const end = cone[cone.length - 1].expiry;
      for (let t = lastT + step; t <= end + step; t += step) bars.push({ time: t });
    }
    candle.setData(bars);
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    vol.setData(candles.map(([t, o, , , cl, v], i) => ({ time: t, value: v, color: (cl >= o ? up : down) + (i < backfilled ? "00" : "55") })));
    const closes = candles.map((k) => k[4]);
    RIBBON.forEach((n, j) => {
      const e = ema(closes, n);
      const s = chart.addSeries(LineSeries, { color: j ? c("--faint") : c("--orange"), lineWidth: j ? 1 : 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      s.setData(candles.map((k, i) => (e[i] == null ? null : { time: k[0], value: e[i] })).filter(Boolean));
    });
    if (cone.length) {
      const snap = (t) => lastT + Math.max(1, Math.round((t - lastT) / step)) * step;
      const path = (qi) => [{ time: lastT, value: lastC }, ...cone.map((e) => ({ time: snap(e.expiry), value: e.q[qi] }))];
      const none = "rgba(0,0,0,0)";
      // Each edge is filled from today's price, so the upside and downside areas compare at a glance.
      [[3, up], [1, down]].forEach(([qi, color]) => {
        const s = chart.addSeries(BaselineSeries, { baseValue: { type: "price", price: lastC }, lineWidth: 2,
          topLineColor: qi === 3 ? color : none, bottomLineColor: qi === 1 ? color : none,
          topFillColor1: qi === 3 ? color + "40" : none, topFillColor2: qi === 3 ? color + "08" : none,
          bottomFillColor1: qi === 1 ? color + "08" : none, bottomFillColor2: qi === 1 ? color + "40" : none,
          priceLineVisible: false, crosshairMarkerVisible: false, lastValueVisible: true, title: "" });
        const d = path(qi);
        s.setData(d);
        s.applyOptions({ title: pctFrom(d[d.length - 1].value, lastC) });
      });
      const mid = chart.addSeries(LineSeries, { color: c("--fg"), lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false,
        priceLineVisible: false, crosshairMarkerVisible: false });
      mid.setData(path(2));
    }
    if (levels) {
      [["call_wall", "Call wall", up], ["put_wall", "Put wall", down], ["max_pain", "Max pain", c("--muted")]].forEach(([k, label, color]) => {
        if (levels[k]) candle.createPriceLine({ price: levels[k], color, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: label });
      });
    }
    // A marker on each bar where the published signal changed.
    const markers = [];
    let prev = null;
    for (const row of signals || []) {
      const [close, sig] = row;
      if (sig !== prev && prev !== null) {
        const tone = signalTone(sig);
        const entry = ["strong", "long", "acc"].includes(tone);
        markers.push({ time: close - TF_SEC[tf], position: entry ? "belowBar" : "aboveBar", shape: entry ? "arrowUp" : tone === "exit" ? "arrowDown" : "circle",
          color: c(TONE_VAR[tone]), text: SIGNAL_LABEL[sig] || sig });
      }
      prev = sig;
    }
    createSeriesMarkers(candle, markers);
    const ahead = bars.length - candles.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - (tf === "4h" ? 180 : 160)), to: candles.length + Math.max(3, ahead + 2) });
    return () => chart.remove();
  }, [candles, signals, tf, theme, backfilled, implied, levels]);
  return <div ref={box} className="chart-box" />;
}
