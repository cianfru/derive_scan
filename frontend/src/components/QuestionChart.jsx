import { useEffect, useRef, useState } from "react";
import { createChart, LineSeries, ColorType, LineStyle } from "lightweight-charts";
import { cssVar } from "../lib/format.js";
import { money } from "../lib/questions.js";
import { Tabs } from "./ui.jsx";

/** The series of one question from its date's history file: per $1 (mark, buy, sell-back) or the
 * coin's index, each [time, value]. */
export function questionSeries(hist, id, side = "yes") {
  const col = hist?.rows?.[id];
  if (!col) return { fair: [], buy: [], sell: [], index: [] };
  // Every series keeps every hour (a missing value is a whitespace point), so all share one time axis.
  const pick = (key, flip = false) => col.i.map((i, j) => {
    const v = col[key][j];
    return v == null ? { time: hist.ts[i] } : { time: hist.ts[i], value: Math.round((flip ? 1 - v : v) * 10000) / 100 };
  });
  return {
    fair: pick("fair", side === "no"),
    buy: pick(side === "no" ? "nb" : "yb"),
    sell: pick(side === "no" ? "ns" : "ys"),
    index: col.i.map((i) => hist.index[i] == null ? { time: hist.ts[i] } : { time: hist.ts[i], value: hist.index[i] }),
  };
}

const RANGES = [["1d", "1D"], ["1w", "1W"], ["all", "All"]];

export default function QuestionChart({ hist, id, side, level, und, theme }) {
  const box = useRef(null);
  const [view, setView] = useState("q");
  const [range, setRange] = useState("all");
  const s = questionSeries(hist, id, side);
  const n = s.fair.filter((p) => p.value != null).length;
  useEffect(() => {
    if (!box.current || !n) return;
    const c = (v) => cssVar(v);
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c("--muted"), fontFamily: "IBM Plex Mono, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: c("--seam") + "66" } },
      rightPriceScale: { borderColor: c("--seam") },
      timeScale: { borderColor: c("--seam"), timeVisible: true },
      localization: { priceFormatter: view === "q" ? (v) => `${v.toFixed(0)}c` : (v) => money(v) },
      handleScroll: false, handleScale: false,
    });
    const last = s.fair[s.fair.length - 1].time;
    const from = range === "1d" ? last - 86400 : range === "1w" ? last - 7 * 86400 : -Infinity;
    const cut = (arr) => arr.filter((p) => p.time >= from);
    if (view === "q") {
      const band = { color: c("--border-strong"), lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
      chart.addSeries(LineSeries, band).setData(cut(s.buy));
      chart.addSeries(LineSeries, band).setData(cut(s.sell));
      chart.addSeries(LineSeries, { color: c("--fg"), lineWidth: 2, priceLineVisible: false }).setData(cut(s.fair));
    } else {
      const ix = chart.addSeries(LineSeries, { color: c("--fg"), lineWidth: 2, priceLineVisible: false });
      ix.setData(cut(s.index));
      ix.createPriceLine({ price: level.k, color: c("--accent"), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "" });
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [hist, id, side, view, range, theme, n]);
  return (
    <div className="q-chart">
      <div className="q-chart-head">
        <Tabs label="Chart range" value={range} onChange={setRange} items={RANGES} />
        <Tabs label="Chart series" value={view} onChange={setView} items={[["q", "Question"], ["coin", und]]} />
      </div>
      {n > 1 ? <div ref={box} className="q-chart-box" aria-label={view === "q" ? "Mark per $1, hourly, with the buy and sell-back prices" : `${und} index, hourly, with the level dotted`} />
        : <p className="status">The chart fills in hourly from the first recorded hour.</p>}
    </div>
  );
}
