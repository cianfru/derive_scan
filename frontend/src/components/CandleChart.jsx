import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, ColorType, CrosshairMode } from "lightweight-charts";
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

/** Candles with volume, the ribbon (fast and slow EMAs) and a marker wherever the signal changed. */
export default function CandleChart({ candles, signals, tf, theme, backfilled = 0 }) {
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
    candle.setData(candles.map(([t, o, h, l, cl]) => ({ time: t, open: o, high: h, low: l, close: cl })));
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    vol.setData(candles.map(([t, o, , , cl, v], i) => ({ time: t, value: v, color: (cl >= o ? up : down) + (i < backfilled ? "00" : "55") })));
    const closes = candles.map((k) => k[4]);
    RIBBON.forEach((n, j) => {
      const e = ema(closes, n);
      const s = chart.addSeries(LineSeries, { color: j ? c("--faint") : c("--orange"), lineWidth: j ? 1 : 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      s.setData(candles.map((k, i) => (e[i] == null ? null : { time: k[0], value: e[i] })).filter(Boolean));
    });
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
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - (tf === "4h" ? 180 : 160)), to: candles.length + 3 });
    return () => chart.remove();
  }, [candles, signals, tf, theme, backfilled]);
  return <div ref={box} className="chart-box" />;
}
