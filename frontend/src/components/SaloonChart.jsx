import { useEffect, useRef } from "react";
import { cssVar } from "../lib/format.js";
import { money } from "../lib/questions.js";

/*
 * The Saloon's chart (owner, 7 October 2026: "the chart is probably the best way to represent and show where
 * prices are and how people should interact with Cowboy"). The coin's 4-hour candles on the left; to their
 * right one column per settlement date, each live answer a bubble at its level: Higher above the price (green),
 * Lower below it (red), the figure inside the most it makes for the board's amount, fees included. Levels
 * without room for a bubble are small dots that open up when zoomed in. Dragging a bubble slides it through the
 * real answers (up and down a date's levels, sideways to other dates) and lets go on the panel. A gold ring
 * marks answers the smart wallets hold positions toward (context, not a signal). Wheel, pinch and the buttons
 * zoom the price axis; dragging the chart moves it.
 */

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const fmtP = (v) => {
  const a = Math.abs(v), d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};
/** A level's short label: 86k, 2,750, 1.35. */
export const levelText = (k) => (k >= 10000 ? `${(k / 1000).toFixed(k % 1000 ? 1 : 0)}k` : fmtP(k));
/** Most it makes as a share of the total paid: "+78.4%", "+1,240%". */
export const returnPct = (make, total) => {
  const p = (make / total) * 100;
  return `+${p >= 100 ? Math.round(p).toLocaleString("en-US") : p.toFixed(1)}%`;
};
export const dayName = (ts) => new Date(ts * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const inText = (ts, now) => {
  const s = Math.max(0, ts - now), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d ? `in ${d}d ${h}h` : `in ${h}h`;
};
/** "7 long · 8 short": wallets on each side, the plain reading (owner, 7 October 2026: "keep it clean"). */
export const countText = (c) => `${c?.long || 0} long · ${c?.short || 0} short`;
/** The traders line's words for one date. */
export function traderText(t) {
  if (!t) return "Not available yet";
  if (t.score == null) return `${countText(t)}, too few traders to read`;
  return `${countText(t)}, most of the money ${t.state === "up" ? "long" : t.state === "defensive" ? "short" : "on both sides"}`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * The bubbles per date: every level once, with the side that bets toward it (above the price Higher, below it
 * Lower), or the other side when that one has no price. `dates` are [{expiry, settle, rows}], rows from boardRows.
 */
export function chartLevels(dates, index) {
  return dates.map((d) => {
    const ks = [...new Set(d.rows.map((r) => r.k))].sort((a, b) => a - b);
    const find = (k, side) => d.rows.find((r) => r.k === k && r.side === side);
    const levels = ks.map((k) => {
      const side = k >= index ? "yes" : "no";
      return { k, r: find(k, side) || find(k, side === "yes" ? "no" : "yes") };
    }).filter((l) => l.r);
    return { ...d, levels, find };
  }).filter((d) => d.levels.length);
}
export const smartOf = (r) => r?.level?.[r.side]?.smart || null;

/** Mixes two #rrggbb colours: t = 0 gives a, 1 gives b. */
export function mix(a, b, t) {
  const h = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = h(a), y = h(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function palette(theme) {
  const light = theme === "light";
  return {
    light,
    up: cssVar("--up") || "#9fe6c7", down: cssVar("--down") || "#f4968b",
    upFill: light ? cssVar("--up") || "#1f6b4d" : "#2f5a4a", downFill: light ? cssVar("--down") || "#a93a2e" : "#6a3530",
    upRing: light ? "#134a35" : cssVar("--up") || "#9fe6c7", downRing: light ? "#7a2219" : cssVar("--down") || "#f4968b",
    ink: "#ffffff", text1: cssVar("--text-1") || "#f7f3ed", text2: cssVar("--text-2") || "#e4ded5", text3: cssVar("--text-3") || "#c6beb2",
    border: cssVar("--border") || "#3b352f", strong: cssVar("--border-strong") || "#5a5148", ground: cssVar("--ground") || "#0e0d0b",
    surface: cssVar("--surface-2") || "#1e1b18", accent: cssVar("--accent") || "#ff5e00", gold: light ? "#a8740f" : "#e6b34a",
  };
}

function mount(host, cfg) {
  const { svg, tip, scroller } = host;
  let { und, index, candles, now, onOpen, theme } = cfg;
  const dates = chartLevels(cfg.dates, index);
  const cs = candles;
  const C = palette(theme);
  const lowC = Math.min(...cs.map((c) => c[3])), highC = Math.max(...cs.map((c) => c[2]));
  const HOME = [Math.min(lowC, index * 0.93), Math.max(highC, index * 1.07)];
  const ks = dates.flatMap((d) => d.rows.flatMap((r) => [r.lo, r.hi]));
  const ALL = [Math.min(HOME[0], ...ks) * 0.98, Math.max(HOME[1], ...ks) * 1.02];
  let view = cfg.view && cfg.view[0] >= ALL[0] && cfg.view[1] <= ALL[1] ? [...cfg.view] : [...HOME];
  let geo = null, current = cfg.selected || null, firstPaint = !cfg.view, drag = null;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clampView = ([a, b]) => {
    const span = Math.min(Math.max(b - a, index * 0.012), ALL[1] - ALL[0]);
    let mid = (a + b) / 2;
    mid = Math.min(Math.max(mid, ALL[0] + span / 2), ALL[1] - span / 2);
    return [mid - span / 2, mid + span / 2];
  };
  const setView = (v) => { view = v; cfg.onView?.(v); draw(); };

  function draw() {
    const phone = window.innerWidth < 700;
    const W = Math.max(scroller.clientWidth || 0, phone ? 820 : 900), H = phone ? 540 : 620;
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const lane = dates.some((d) => d.traders) ? (phone ? 92 : 104) : 0;
    const m = { l: 14, r: 78, t: 70, b: 34 + lane };
    const pw = W - m.l - m.r, pastW = pw * (phone ? 0.3 : 0.34), futX = m.l + pastW, colW = (pw - pastW) / Math.max(1, dates.length);
    const R = phone ? 23 : 26;
    const [lo, hi] = view;
    const y = (p) => m.t + ((hi - p) / (hi - lo)) * (H - m.t - m.b);
    const inv = (py) => hi - ((py - m.t) / (H - m.t - m.b)) * (hi - lo);
    const defs = el("defs", {}, svg);
    const g = el("linearGradient", { id: "sch-wash", x1: "0", x2: "1", y1: "0", y2: "0" }, defs);
    el("stop", { offset: "0", "stop-color": C.accent, "stop-opacity": C.light ? "0.07" : "0.10" }, g);
    el("stop", { offset: "1", "stop-color": C.accent, "stop-opacity": "0.02" }, g);
    // Bubbles read as lit glass spheres (owner, 7 October 2026: "more depth ... some sort of 3D effect"): light from
    // the top left, a highlight, a darker lower edge, and a soft shadow on the chart beneath.
    const orb = (id, base) => {
      const gr = el("radialGradient", { id, cx: "0.36", cy: "0.3", r: "0.78", fx: "0.32", fy: "0.24" }, defs);
      el("stop", { offset: "0", "stop-color": mix(base, "#ffffff", C.light ? 0.38 : 0.34) }, gr);
      el("stop", { offset: "0.5", "stop-color": base }, gr);
      el("stop", { offset: "1", "stop-color": mix(base, "#000000", C.light ? 0.22 : 0.32) }, gr);
    };
    orb("sch-orb-up", C.upFill);
    orb("sch-orb-down", C.downFill);
    const shine = el("radialGradient", { id: "sch-shine", cx: "0.5", cy: "0.5", r: "0.5" }, defs);
    el("stop", { offset: "0", "stop-color": "#ffffff", "stop-opacity": C.light ? "0.32" : "0.24" }, shine);
    el("stop", { offset: "1", "stop-color": "#ffffff", "stop-opacity": "0" }, shine);
    const halo = (id, base) => {
      const gr = el("radialGradient", { id, cx: "0.5", cy: "0.5", r: "0.5" }, defs);
      el("stop", { offset: "0.6", "stop-color": base, "stop-opacity": C.light ? "0.22" : "0.3" }, gr);
      el("stop", { offset: "1", "stop-color": base, "stop-opacity": "0" }, gr);
    };
    halo("sch-halo-up", C.up);
    halo("sch-halo-down", C.down);
    const gold = el("linearGradient", { id: "sch-gold", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    el("stop", { offset: "0", "stop-color": mix(C.gold, "#ffffff", 0.45) }, gold);
    el("stop", { offset: "0.55", "stop-color": C.gold }, gold);
    el("stop", { offset: "1", "stop-color": mix(C.gold, "#000000", 0.35) }, gold);
    // Warm orange light behind the future, so the bubbles' shadows have something to fall on.
    const glow = (id, op) => {
      const gr = el("radialGradient", { id, cx: "0.5", cy: "0.5", r: "0.5" }, defs);
      el("stop", { offset: "0", "stop-color": C.accent, "stop-opacity": op }, gr);
      el("stop", { offset: "1", "stop-color": C.accent, "stop-opacity": "0" }, gr);
    };
    glow("sch-glow-a", C.light ? "0.10" : "0.16");
    glow("sch-glow-b", C.light ? "0.07" : "0.11");
    const clip = el("clipPath", { id: "sch-plot" }, defs);
    el("rect", { x: 0, y: m.t - 8, width: W - m.r, height: H - m.t - m.b + 8 }, clip);
    // The future is where you act: a faint orange wash from now to the last settlement.
    el("rect", { x: futX, y: 0, width: pw - pastW, height: H - m.b, fill: "url(#sch-wash)" }, svg);
    {
      const fw = pw - pastW, yNow = Math.min(Math.max(m.t + (hi - index) / (hi - lo) * (H - m.t - m.b), m.t), H - m.b);
      const glows = el("g", { class: "sch-glows" }, svg);
      el("ellipse", { cx: futX + fw * 0.42, cy: yNow, rx: fw * 0.55, ry: (H - m.t - m.b) * 0.48, fill: "url(#sch-glow-a)" }, glows);
      el("ellipse", { cx: futX + fw * 0.9, cy: m.t + (H - m.t - m.b) * 0.18, rx: fw * 0.38, ry: (H - m.t - m.b) * 0.36, fill: "url(#sch-glow-b)" }, glows);
    }
    const plot = el("g", { "clip-path": "url(#sch-plot)" }, svg);
    const span = hi - lo, base = 10 ** Math.floor(Math.log10(span / 6));
    const step = [1, 2, 5, 10].map((x) => x * base).find((s) => span / s <= 8);
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      el("line", { x1: m.l, x2: W - m.r, y1: y(p), y2: y(p), stroke: C.border, "stroke-opacity": 0.6, "stroke-width": 1 }, plot);
      el("text", { x: W - m.r + 8, y: y(p) + 4, fill: C.text3, "font-size": 11 }, svg).textContent = fmtP(p);
    }
    const bw = pastW / cs.length;
    cs.forEach(([, o, h, l, c], i) => {
      const x = m.l + bw * (i + 0.5), col = c >= o ? C.up : C.down;
      el("line", { x1: x, x2: x, y1: y(h), y2: y(l), stroke: col, "stroke-width": 1 }, plot);
      el("rect", { x: x - bw * 0.32, y: y(Math.max(o, c)), width: bw * 0.64, height: Math.max(1, Math.abs(y(o) - y(c))), fill: col }, plot);
    });
    const days = Math.round((cs[cs.length - 1][0] - cs[0][0]) / 86400);
    [[0, `${days} days ago`], [cs.length - 1, "now"]].forEach(([i, label]) => {
      el("text", { x: m.l + bw * (i + 0.5), y: H - 12, fill: C.text3, "font-size": 11, "text-anchor": i ? "end" : "start" }, svg).textContent = label;
    });
    const yi = y(index);
    if (yi > m.t - 8 && yi < H - m.b) {
      el("line", { x1: m.l, x2: W - m.r, y1: yi, y2: yi, stroke: C.text1, "stroke-width": 1, "stroke-dasharray": "5 4", "stroke-opacity": 0.7 }, plot);
      el("rect", { x: W - m.r + 2, y: yi - 10, width: m.r - 4, height: 20, rx: 3, fill: C.text1 }, svg);
      el("text", { x: W - m.r + 8, y: yi + 4, fill: C.ground, "font-size": 11, "font-weight": 600 }, svg).textContent = fmtP(index);
    }
    el("line", { x1: futX, x2: futX, y1: 0, y2: H - m.b, stroke: C.strong, "stroke-width": 1 }, svg);
    const zone = el("g", {}, plot);
    const threads = el("g", {}, plot);
    geo = { y, inv, futX, colW, m, W, H, zone, threads, R, phone, cols: dates.map((_, i) => futX + colW * (i + 0.5)) };
    dates.forEach((d, i) => {
      const cx = geo.cols[i];
      el("line", { x1: cx, x2: cx, y1: m.t - 6, y2: H - m.b, stroke: C.text3, "stroke-opacity": 0.5, "stroke-dasharray": "3 5" }, svg);
      el("text", { x: cx, y: m.t - 44, fill: C.text1, "font-size": phone ? 12 : 13, "font-family": "Manrope, sans-serif", "font-weight": 700, "text-anchor": "middle" }, svg).textContent = dayName(d.settle);
      el("text", { x: cx, y: m.t - 26, fill: C.text3, "font-size": 11, "text-anchor": "middle" }, svg).textContent = phone ? inText(d.settle, now).replace(/ \d+h$/, "") : `08:00 · ${inText(d.settle, now)}`;
      // Full bubbles where there is room, nearest the price first; the rest small dots.
      const visible = d.levels.filter((l) => y(l.k) > m.t + R * 0.7 && y(l.k) < H - m.b - R * 0.7)
        .sort((a, b) => Math.abs(a.k - index) - Math.abs(b.k - index));
      const big = [];
      for (const l of visible) if (!big.some((b) => Math.abs(y(b.k) - y(l.k)) < R * 2 + 4)) big.push(l);
      for (const l of visible) if (!big.includes(l)) bubble(plot, d, l, cx, false, i);
      big.forEach((l, j) => bubble(plot, d, l, cx, true, i, j));
      const above = d.levels.filter((l) => y(l.k) <= m.t + R * 0.7), below = d.levels.filter((l) => y(l.k) >= H - m.b - R * 0.7);
      if (above.length) more(svg, cx, m.t - 2, true, above, d);
      if (below.length) more(svg, cx, H - m.b - 14, false, below, d);
    });
    if (lane) traderLane(svg, lane);
    if (current) paintSelected();
    firstPaint = false;
  }

  // Where directional traders lean on each date (net over gross delta of their open options): a line in its own
  // lane under the plot, up for Long, down for Short, a hollow dot where too few positions are open.
  function traderLane(parent, lane) {
    const { futX, cols, W, H, m } = geo;
    const top = H - m.b + 16, bot = H - 34 - 10, mid = (top + bot) / 2 + 6, half = (bot - top) / 2 - 2;
    const most = Math.max(1, ...dates.map((d) => d.traders?.gross_delta_usd || 0));
    const g = el("g", { class: "sch-lane" }, parent);
    el("rect", { x: futX, y: top - 6, width: W - m.r - futX, height: bot - top + 12, fill: C.text1, "fill-opacity": C.light ? 0.03 : 0.035 }, g);
    el("line", { x1: futX, x2: W - m.r, y1: mid, y2: mid, stroke: C.text3, "stroke-opacity": 0.5, "stroke-dasharray": "2 4" }, g);
    el("text", { x: futX - 10, y: mid - 3, fill: C.text2, "font-size": 11, "font-family": "Manrope, sans-serif", "font-weight": 600, "text-anchor": "end" }, g).textContent = "Directional traders";
    el("text", { x: futX - 10, y: mid + 11, fill: C.text3, "font-size": 10.5, "font-family": "Manrope, sans-serif", "text-anchor": "end" }, g).textContent = "where their positions lean";
    el("text", { x: W - m.r + 8, y: mid - half + 10, fill: C.up, "font-size": 10.5 }, g).textContent = "Long";
    el("text", { x: W - m.r + 8, y: mid + half + 2, fill: C.down, "font-size": 10.5 }, g).textContent = "Short";
    const pts = dates.map((d, i) => ({ d, x: cols[i], t: d.traders, y: d.traders?.score != null ? mid - d.traders.score * half : null }));
    let run = [];
    const flush = () => {
      if (run.length > 1) el("polyline", { points: run.map((p) => `${p.x},${p.y}`).join(" "), fill: "none", stroke: C.text2, "stroke-width": 1.5, "stroke-opacity": 0.8 }, g);
      run = [];
    };
    for (const p of pts) { if (p.y == null) flush(); else run.push(p); }
    flush();
    for (const p of pts) {
      if (!p.t) continue;
      const col = p.t.state === "up" ? C.up : p.t.state === "defensive" ? C.down : C.text3;
      const label = p.y == null ? "Too few" : countText(p.t);
      const dot = el("g", { class: "sch-lane-dot", tabindex: 0, role: "img", "aria-label": `Directional traders on ${dayName(p.d.settle)}: ${traderText(p.t)}` }, g);
      // The dot's size follows the money behind the reading, so a few positions never look like a crowd.
      const r = p.y == null ? 4 : 3.5 + 5 * Math.sqrt((p.t.gross_delta_usd || 0) / most);
      el("circle", { cx: p.x, cy: p.y ?? mid, r, fill: p.y == null ? C.surface : col, stroke: p.y == null ? C.text3 : col, "stroke-width": 1.5 }, dot);
      el("text", { x: p.x, y: (p.y ?? mid) - r - 5, fill: p.y == null ? C.text3 : col, "font-size": 10.5, "font-family": "Manrope, sans-serif", "font-weight": 600, "text-anchor": "middle" }, dot).textContent = label;
      const show = () => {
        tip.innerHTML = `<div class="t1">Directional traders, ${esc(dayName(p.d.settle))}</div><div>${esc(traderText(p.t))}</div><div class="sch-hint">Context, not a signal</div>`;
        tip.hidden = false;
        const sc = scroller.scrollLeft;
        tip.style.left = `${Math.max(8, Math.min(p.x - sc - 120, host.stage.clientWidth - tip.offsetWidth - 8))}px`;
        tip.style.top = `${Math.max(52, scroller.offsetTop + (p.y ?? mid) - tip.offsetHeight - 14)}px`;
      };
      dot.addEventListener("pointerenter", show); dot.addEventListener("focus", show);
      dot.addEventListener("pointerleave", () => { tip.hidden = true; }); dot.addEventListener("blur", () => { tip.hidden = true; });
      dot.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") e.stopPropagation(); });
    }
  }

  // "More levels this way": an arrow with how many, at the top or bottom of a date; a tap brings the nearest into view.
  function more(parent, cx, y0, up, list, d) {
    const n = list.length, word = `${n} more ${up ? "above" : "below"}`;
    const g = el("g", { class: "sch-more", tabindex: 0, role: "button", "aria-label": `${dayName(d.settle)}: ${word}. Show them` }, parent);
    el("rect", { x: cx - 34, y: y0 - 12, width: 68, height: 38, fill: "transparent" }, g); // the tap area
    const a = up ? `M${cx - 22} ${y0 + 10} l5 -5 l5 5` : `M${cx - 22} ${y0 + 5} l5 5 l5 -5`;
    el("path", { d: a, fill: "none", stroke: C.text2, "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    el("text", { x: cx - 9, y: y0 + 11, fill: C.text2, "font-size": 10.5, "text-anchor": "start" }, g).textContent = `${n} more`;
    const go = () => {
      const next = up ? Math.min(...list.map((l) => l.k)) : Math.max(...list.map((l) => l.k));
      const span = view[1] - view[0], shift = up ? next - view[1] + span * 0.25 : next - view[0] - span * 0.25;
      animateTo(clampView([view[0] + shift, view[1] + shift]));
    };
    g.addEventListener("pointerdown", (e) => { moved = false; if (e.pointerType !== "touch") e.stopPropagation(); });
    g.addEventListener("click", (e) => { e.stopPropagation(); if (!moved) go(); });
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }

  function bubble(parent, d, l, cx, full, col = 0, rank = 0) {
    const { y, R, phone } = geo, r = l.r, yes = r.side === "yes", by = y(l.k), smart = smartOf(r);
    const name = `${yes ? "Higher" : "Lower"} than ${money(l.k)} on ${dayName(d.settle)}, up to ${returnPct(r.make, r.total)}${smart ? ", smart wallets hold positions this way" : ""}`;
    const b = el("g", { class: full ? "sch-bubble" : "sch-bubble sch-dot", tabindex: 0, role: "button", "data-key": r.key,
      "aria-label": full ? `${name}. Drag to explore other levels and dates` : `${name}. Opens up when zoomed in` }, parent);
    if (current && current.key === r.key) b.classList.add("on");
    const seed = ((l.k / Math.max(1, index)) * 997 + col * 13) % 10;
    const pop = el("g", { class: firstPaint ? "sch-pop" : "", style: `--pd:${col * 90 + rank * 45}ms` }, b);
    const orbFill = `url(#sch-orb-${yes ? "up" : "down"})`, ring = yes ? C.upRing : C.downRing;
    // The shadow stays on the chart while the bubble floats above it.
    const sr = full ? R : 6;
    // A soft glow of the bubble's own colour on the side the light comes from (top left), so it lifts off the chart.
    el("circle", { cx: cx - sr * 0.14, cy: by - sr * 0.14, r: sr * 1.32, fill: `url(#sch-halo-${yes ? "up" : "down"})`, class: "sch-halo" }, pop);
    const fl = el("g", { class: "sch-float", style: `--dur:${(3.4 + seed * 0.18).toFixed(2)}s;--delay:-${(seed * 0.4).toFixed(2)}s` }, pop);
    const body = el("g", { class: "sch-body" }, fl);
    if (full) {
      if (smart) el("circle", { cx, cy: by, r: R + 5, fill: "none", stroke: "url(#sch-gold)", "stroke-width": 3, class: "sch-gold" }, body);
      el("circle", { cx, cy: by, r: R, fill: orbFill, stroke: ring, "stroke-width": 1.2, "stroke-opacity": 0.85 }, body);
      el("ellipse", { cx: cx - R * 0.28, cy: by - R * 0.42, rx: R * 0.42, ry: R * 0.24, fill: "url(#sch-shine)", class: "sch-shine" }, body);
      const label = returnPct(r.make, r.total), long = label.length > 6;
      el("text", { x: cx, y: by + 4, fill: C.ink, "font-size": long ? (phone ? 9.5 : 10.5) : phone ? 11 : 12, "font-weight": 700, "text-anchor": "middle",
        stroke: "rgba(0,0,0,.35)", "stroke-width": 2, "paint-order": "stroke", "stroke-linejoin": "round" }, body).textContent = label;
      el("text", { x: cx + R + (smart ? 11 : 6), y: by + 4, fill: C.text3, "font-size": 10.5 }, fl).textContent = levelText(l.k);
    } else {
      el("circle", { cx, cy: by, r: 6, fill: orbFill, stroke: smart ? "url(#sch-gold)" : ring, "stroke-width": smart ? 2 : 1 }, body);
      el("ellipse", { cx: cx - 1.8, cy: by - 2.4, rx: 2.6, ry: 1.6, fill: "url(#sch-shine)" }, body);
    }
    const show = () => { if (!drag) hover(d, r, cx, by, full); };
    b.addEventListener("pointerenter", show);
    b.addEventListener("focus", show);
    b.addEventListener("pointerleave", () => { if (!drag) unhover(); });
    b.addEventListener("blur", unhover);
    // On a touch screen a thumb on a bubble pans the chart like anywhere else, and a tap opens it (owner,
    // 7 October 2026); with a mouse a full bubble drags through the levels and dates, a dot zooms in.
    let touch = false;
    b.addEventListener("pointerdown", (e) => {
      touch = e.pointerType === "touch";
      moved = false; // a new press: an earlier pan never blocks this bubble's click
      if (touch) return;
      if (full) startDrag(e, b, d, l, cx, by);
      else e.stopPropagation();
    });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (moved) return;
      if (!full) zoomTo(d, l);
      else if (touch) open(r);
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (full) open(r); else zoomTo(d, l); }
    });
  }

  const dateOf = (r) => dates.find((d) => d.expiry === r.expiry);
  function paintZone(r) {
    const d = dateOf(r);
    if (!geo || !d) return;
    const { y, futX, cols, zone } = geo;
    zone.replaceChildren();
    const x2 = cols[dates.indexOf(d)], yes = r.side === "yes", far = view[1] - view[0];
    const band = (p1, p2, fill, op) => el("rect", { x: futX, y: Math.min(y(p1), y(p2)), width: x2 - futX, height: Math.abs(y(p1) - y(p2)), fill, "fill-opacity": op }, zone);
    band(r.lo, r.hi, C.text3, 0.14);
    if (yes) band(r.hi, Math.max(r.hi, view[1] + far), C.up, 0.16);
    else band(Math.min(r.lo, view[0] - far), r.lo, C.down, 0.16);
    el("line", { x1: futX, x2, y1: y(r.k), y2: y(r.k), stroke: C.text1, "stroke-width": 1, "stroke-dasharray": "2 3" }, zone);
  }
  // Threads: the same level on every date, so the payout's change with time shows.
  function paintThreads(k, side) {
    const { y, cols, threads, R } = geo;
    threads.replaceChildren();
    const pts = dates.map((d, i) => ({ i, r: d.find(k, side) })).filter((p) => p.r);
    if (pts.length < 2) return;
    el("polyline", { points: pts.map((p) => `${cols[p.i]},${y(k)}`).join(" "), fill: "none", stroke: side === "yes" ? C.up : C.down,
      "stroke-opacity": 0.45, "stroke-width": 1.5, "stroke-dasharray": "1 5", "stroke-linecap": "round" }, threads);
    for (const p of pts) el("text", { x: cols[p.i], y: y(k) - R - 8, fill: C.text2, "font-size": 10.5, "text-anchor": "middle" }, threads).textContent = returnPct(p.r.make, p.r.total);
  }
  function paintSelected() {
    if (!geo) return;
    geo.threads.replaceChildren();
    if (current) paintZone(current); else geo.zone.replaceChildren();
    svg.querySelectorAll(".sch-bubble.on").forEach((n) => n.classList.remove("on"));
    if (current) svg.querySelectorAll(".sch-bubble").forEach((n) => { if (n.dataset.key === current.key) n.classList.add("on"); });
  }

  function hover(d, r, cx, cy, full) {
    paintZone(r); paintThreads(r.k, r.side);
    const yes = r.side === "yes", smart = smartOf(r);
    tip.innerHTML = `<div class="t1">${yes ? "Higher" : "Lower"} than ${esc(money(r.k))}</div>`
      + `<div>${esc(dayName(d.settle))}, 08:00 UTC · <b>${r.buyCents}c</b> per $1</div>`
      + `<div>Pays in full ${yes ? `at <b>${esc(money(r.hi))}</b> or above` : `at <b>${esc(money(r.lo))}</b> or below`}</div>`
      + `<div>Up to <b>${returnPct(r.make, r.total)}</b> on ${esc(money(cfg.amount))}</div>`
      + (r.level?.smart_wallets ? `<div class="sch-smart">Smart wallets here: ${countText(r.level.smart_wallets)}</div>` : "")
      + `<div class="sch-hint">${full ? "Click to trade, or drag to other levels and dates" : "Click to zoom in"}</div>`;
    tip.hidden = false;
    const sc = scroller.scrollLeft, sw = host.stage.clientWidth;
    let left = cx - sc + 34;
    if (left + tip.offsetWidth > sw - 8) left = cx - sc - tip.offsetWidth - 34;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(52, scroller.offsetTop + cy - tip.offsetHeight / 2)}px`;
  }
  function unhover() {
    tip.hidden = true;
    if (geo) paintSelected();
  }
  function open(r) {
    current = r; tip.hidden = true; paintSelected();
    onOpen?.(r);
  }

  // Dragging a bubble slides it through the real answers; the number counts to each one's return.
  let countAnim = 0;
  function startDrag(e, node, d, l, cx, by) {
    e.stopPropagation();
    node.setPointerCapture?.(e.pointerId);
    drag = { node, x0: e.clientX, y0: e.clientY, cx, by, moved: false, target: { d, l }, shown: (l.r.make / l.r.total) * 100, ghost: null };
    const move = (ev) => {
      const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) { drag.moved = true; node.style.opacity = 0.25; tip.hidden = true; drag.ghost = makeGhost(); }
      const px = drag.cx + dx, py = Math.min(Math.max(drag.by + dy, geo.m.t), geo.H - geo.m.b);
      const ci = geo.cols.reduce((best, x, i) => (Math.abs(x - px) < Math.abs(geo.cols[best] - px) ? i : best), 0);
      const td = dates[ci];
      const tl = td.levels.reduce((best, x) => (Math.abs(geo.y(x.k) - py) < Math.abs(geo.y(best.k) - py) ? x : best), td.levels[0]);
      placeGhost(px, py, td, tl);
    };
    const up = () => {
      node.removeEventListener("pointermove", move); node.removeEventListener("pointerup", up); node.removeEventListener("pointercancel", up);
      const t = drag.target, ghost = drag.ghost;
      if (drag.moved) {
        const gx = geo.cols[dates.indexOf(t.d)], gy = geo.y(t.l.k);
        ghost.style.transition = reduced ? "none" : "transform 260ms cubic-bezier(.2,1.3,.4,1)";
        ghost.style.transform = `translate(${gx}px, ${gy}px)`;
        setTimeout(() => { ghost.remove(); node.style.opacity = ""; drag = null; open(t.l.r); }, reduced ? 0 : 270);
      } else { drag = null; open(l.r); }
    };
    node.addEventListener("pointermove", move); node.addEventListener("pointerup", up); node.addEventListener("pointercancel", up);
  }
  function makeGhost() {
    const g = el("g", { class: "sch-ghost", style: `transform: translate(${drag.cx}px, ${drag.by}px)` }, svg);
    el("rect", { x: -92, y: -geo.R - 30, width: 184, height: 22, rx: 6, fill: C.surface, stroke: C.strong }, g);
    el("circle", { cx: 0, cy: 0, r: geo.R + 5, fill: "none", stroke: "url(#sch-gold)", "stroke-width": 3, class: "gring" }, g);
    el("circle", { cx: 0, cy: 0, r: geo.R + 3, fill: "url(#sch-orb-up)", stroke: C.upRing, "stroke-width": 1.5, class: "gbody" }, g);
    el("ellipse", { cx: -(geo.R + 3) * 0.28, cy: -(geo.R + 3) * 0.42, rx: (geo.R + 3) * 0.5, ry: (geo.R + 3) * 0.3, fill: "url(#sch-shine)" }, g);
    el("text", { x: 0, y: 4, fill: C.ink, "font-size": 13, "font-weight": 700, "text-anchor": "middle", class: "gtext",
      stroke: "rgba(0,0,0,.35)", "stroke-width": 2, "paint-order": "stroke", "stroke-linejoin": "round" }, g);
    el("text", { x: 0, y: -geo.R - 14, fill: C.text1, "font-size": 11, "text-anchor": "middle", class: "glab" }, g);
    return g;
  }
  function placeGhost(px, py, td, tl) {
    const g = drag.ghost, r = tl.r, yes = r.side === "yes";
    g.style.transition = "none";
    g.style.transform = `translate(${px}px, ${py}px)`;
    g.querySelector(".gbody").setAttribute("fill", `url(#sch-orb-${yes ? "up" : "down"})`);
    g.querySelector(".gbody").setAttribute("stroke", yes ? C.upRing : C.downRing);
    g.querySelector(".gring").setAttribute("stroke-opacity", smartOf(r) ? 1 : 0);
    g.querySelector(".glab").textContent = `${yes ? "Higher" : "Lower"} ${money(tl.k)} · ${dayName(td.settle)}`;
    if (drag.target.d !== td || drag.target.l !== tl || !g.querySelector(".gtext").textContent) {
      drag.target = { d: td, l: tl };
      paintZone(r); paintThreads(tl.k, r.side);
      countTo(g.querySelector(".gtext"), (r.make / r.total) * 100);
    }
  }
  function countTo(node, to) {
    cancelAnimationFrame(countAnim);
    const from = drag.shown, t0 = performance.now(), dur = reduced ? 0 : 160;
    const fmt = (p) => `+${p >= 100 ? Math.round(p).toLocaleString("en-US") : p.toFixed(1)}%`;
    const tick = (t) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1, v = from + (to - from) * k;
      node.textContent = fmt(v);
      if (drag) drag.shown = v;
      if (k < 1) countAnim = requestAnimationFrame(tick);
    };
    countAnim = requestAnimationFrame(tick);
  }

  // Zoom so a level and its neighbours have room for full bubbles.
  function zoomTo(d, l) {
    const lks = d.levels.map((x) => x.k), i = lks.indexOf(l.k);
    const gaps = [lks[i] - lks[i - 1], lks[i + 1] - lks[i]].filter((x) => x > 0);
    const gap = Math.min(...gaps, index * 0.012), plotH = geo.H - geo.m.t - geo.m.b;
    const need = (gap * plotH) / (geo.R * 2 + 10);
    animateTo(clampView([l.k - need / 2, l.k + need / 2]));
  }
  const zoomBy = (f, at = (view[0] + view[1]) / 2) => animateTo(clampView([at - (at - view[0]) * f, at + (view[1] - at) * f]));
  let anim = 0;
  function animateTo(target) {
    cancelAnimationFrame(anim);
    const from = [...view], t0 = performance.now(), dur = reduced ? 0 : 260;
    const stepf = (t) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - (1 - k) ** 3;
      setView([from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e]);
      if (k < 1) anim = requestAnimationFrame(stepf);
    };
    anim = requestAnimationFrame(stepf);
  }

  // Wheel zooms around the pointer's price; dragging moves the axis; two fingers pinch.
  const onWheel = (e) => {
    e.preventDefault();
    const at = geo.inv(e.clientY - svg.getBoundingClientRect().top), f = Math.exp(e.deltaY * 0.0015);
    setView(clampView([at - (at - view[0]) * f, at + (view[1] - at) * f]));
  };
  const pts = new Map();
  let moved = false, start = null;
  // One finger or the mouse moves the chart both ways: up and down along the price axis, left and right
  // through the dates (the frame scrolls sideways when the chart is wider than the screen).
  // pts: pointer id -> [x, y]; a pan or pinch restarts from the pointers still down.
  const restart = () => {
    const ps = [...pts.values()];
    start = { view: [...view], ys: ps.map((q) => q[1]), x: ps[0][0], left: scroller.scrollLeft };
  };
  const onDown = (e) => {
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    restart();
  };
  const onMove = (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const plotH = geo.H - geo.m.t - geo.m.b, span = start.view[1] - start.view[0];
    if (pts.size === 1) {
      const dy = e.clientY - start.ys[0], dx = e.clientX - start.x;
      if (!moved && Math.hypot(dx, dy) > 6) { moved = true; svg.classList.add("drag"); tip.hidden = true; }
      if (moved) {
        scroller.scrollLeft = start.left - dx;
        if (Math.abs(dy) > 2) { const dp = (dy / plotH) * span; setView(clampView([start.view[0] + dp, start.view[1] + dp])); }
      }
    } else if (pts.size === 2 && start.ys.length === 2) {
      const [a, b] = [...pts.values()].map((q) => q[1]), d0 = Math.abs(start.ys[0] - start.ys[1]) || 1, d1 = Math.abs(a - b) || 1;
      moved = true;
      const f = d0 / d1, mid = (start.view[0] + start.view[1]) / 2;
      setView(clampView([mid - (span / 2) * f, mid + (span / 2) * f]));
    }
  };
  const onEnd = (e) => {
    pts.delete(e.pointerId);
    if (!pts.size) { start = null; svg.classList.remove("drag"); }
    else restart();
  };
  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onEnd);
  svg.addEventListener("pointercancel", onEnd);
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 120); };
  window.addEventListener("resize", onResize);
  draw();

  return {
    zoomIn: () => zoomBy(0.6), zoomOut: () => zoomBy(1.6), reset: () => animateTo([...HOME]),
    select: (r) => { current = r || null; paintSelected(); },
    destroy: () => {
      cancelAnimationFrame(anim); cancelAnimationFrame(countAnim); clearTimeout(rt);
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", onDown); svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onEnd); svg.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("resize", onResize);
      svg.replaceChildren(); tip.hidden = true;
    },
  };
}

/**
 * `dates`: [{expiry, settle, rows}] for one coin (rows from boardRows at `amount`); `candles`: the coin's
 * 4-hour [t, o, h, l, c] rows; `selected`: the open row, or null.
 */
export default function SaloonChart({ und, name, index, candles, dates, amount, now, theme, selected, onOpen }) {
  const svg = useRef(null), tip = useRef(null), scroller = useRef(null), stage = useRef(null);
  const api = useRef(null);
  const views = useRef({});
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const dataKey = dates.map((d) => `${d.expiry}:${d.traders?.score ?? "-"}/${d.traders?.long ?? "-"}/${d.traders?.short ?? "-"}:${d.rows.map((r) => `${r.key}=${r.total.toFixed(2)}/${r.payout.toFixed(2)}/${smartOf(r)?.wallets || 0}/${countText(r.level?.smart_wallets)}`).join(",")}`).join("|");
  const ready = candles?.length > 1 && dates.length > 0 && Number.isFinite(index);
  useEffect(() => {
    if (!ready || !svg.current) return undefined;
    const first = !(und in views.current);
    api.current = mount({ svg: svg.current, tip: tip.current, scroller: scroller.current, stage: stage.current }, {
      und, index, candles, dates, now: now || Date.now() / 1000, amount, theme, selected,
      view: views.current[und], onView: (v) => { views.current[und] = v; }, onOpen: (r) => openRef.current?.(r),
    });
    if (first && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
    return () => { api.current?.destroy(); api.current = null; };
  }, [ready, und, index, candles, dataKey, theme, amount]);
  useEffect(() => { api.current?.select(selected); }, [selected?.key]);
  if (!ready) return <p className="status">The {und} chart is not available right now.</p>;
  return (
    <div ref={stage} className="sch-stage">
      <div className="sch-zoom" role="group" aria-label="Zoom the price axis">
        <button type="button" aria-label="Zoom in" onClick={() => api.current?.zoomIn()}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => api.current?.zoomOut()}>&minus;</button>
        <button type="button" className="sch-reset" onClick={() => api.current?.reset()}>Reset</button>
      </div>
      <div ref={scroller} className="sch-scroller">
        <svg ref={svg} className="sch-svg" role="group" aria-label={`${name || und} 4-hour candles, then the Saloon's answers as bubbles on each settlement date`} />
      </div>
      <div ref={tip} className="sch-tip" hidden aria-hidden="true" />
    </div>
  );
}
