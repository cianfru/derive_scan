// A wallet's brand: a cattle brand drawn from the address, the way a ranch marks its herd.
// Read in the ranchers' fixed grammar: a base letter or numeral, optionally with modifiers
// (Bar, Circle, Box, Half Circle, Rocking, Lazy, Tumbling, Flying, Walking, Running,
// Connected, Double), so a wallet reads as "Rocking R" or "Bar Lazy 8".
// One stroke weight like a branding iron (round caps and joins), monoline glyphs drawn here
// (not font outlines), centred with breathing room on a soft charcoal tile.
// Accents are warm and cool tones kept off green and red, so a wallet never looks like profit
// or loss. Pure data and SVG paths, no requests. The same address always gives the same brand.
// Same API shape as walletEmblem.js (view, spec, shapes, tile) so it can replace it.

import { draw, walletSeed } from "./walletName.js";

export const BRAND_VIEW = 36;
const C = BRAND_VIEW / 2;
/** The iron: one stroke weight for every line of every brand (view units). */
export const BRAND_STROKE = 2.8;
const SW = BRAND_STROKE;

/** The tile: a soft charcoal square with a gentle radius and a thin border. */
export const BRAND_TILE = {
  d: "M8.5 .5H27.5A8 8 0 0 1 35.5 8.5V27.5A8 8 0 0 1 27.5 35.5H8.5A8 8 0 0 1 .5 27.5V8.5A8 8 0 0 1 8.5 .5Z",
  radius: 8,
  dark: { fill: "#25211d", stroke: "#3a342d" },
  light: { fill: "#f2ede5", stroke: "#ddd4c6" },
};

/** Accents: `dark` on the charcoal tile, `light` on the light tile. None is green or red. Warm and
 * cool alternate in this order; `family` groups the ones that look alike at 22 px. */
export const BRAND_ACCENTS = [
  { name: "ember", family: "orange", dark: "#ff7a2e", light: "#bf4a06" },
  { name: "steel", family: "blue", dark: "#93b4d4", light: "#3b638a" },
  { name: "amber", family: "gold", dark: "#e6b04c", light: "#8f6510" },
  { name: "ivory", family: "light", dark: "#efe9dc", light: "#3d372f" },
  { name: "apricot", family: "orange", dark: "#ffad6b", light: "#a9561a" },
  { name: "denim", family: "blue", dark: "#7a98d2", light: "#2f4f8f" },
  { name: "sand", family: "gold", dark: "#d2b78a", light: "#7a6545" },
];

// ---------------------------------------------------------------------------------------------
// Glyphs: monoline capitals and numerals, 20 units tall (y down), drawn with lines and cubic
// curves only, so any rotation, slant or scale stays exact. `top` and `bottom` are free stroke
// ends ([x, y, outward]) where Flying wings and Walking feet attach.

const K4 = (a, b) => (4 / 3) * Math.tan((b - a) / 4);
// Elliptical arc from angle a0 to a1 (degrees, y down, 0 = right), as cubic segments.
function arc(cx, cy, rx, ry, a0, a1) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
  let out = "";
  for (let i = 0; i < n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180, b = ((a0 + ((a1 - a0) * (i + 1)) / n) * Math.PI) / 180;
    const k = K4(a, b);
    const p0 = [cx + rx * Math.cos(a), cy + ry * Math.sin(a)], p3 = [cx + rx * Math.cos(b), cy + ry * Math.sin(b)];
    const c1 = [p0[0] - k * rx * Math.sin(a), p0[1] + k * ry * Math.cos(a)];
    const c2 = [p3[0] + k * rx * Math.sin(b), p3[1] - k * ry * Math.cos(b)];
    out += `C${c1.join(" ")} ${c2.join(" ")} ${p3.join(" ")}`;
  }
  return out;
}
const at = (cx, cy, rx, ry, a) => [cx + rx * Math.cos((a * Math.PI) / 180), cy + ry * Math.sin((a * Math.PI) / 180)].join(" ");

const GLYPHS = {
  A: { w: 14, d: "M0 20L7 0L14 20M2.45 13H11.55", bottom: [[0, 20, -1], [14, 20, 1]] },
  B: { w: 11.5, d: "M0 10H5.6C8.4 10 10.2 8 10.2 5C10.2 2 8.4 0 5.6 0H0V20H6.3C9.6 20 11.5 17.8 11.5 15C11.5 12.2 9.6 10 6.3 10H0" },
  C: { w: 13.6, d: `M${at(8.4, 10, 8.4, 10, -48)}${arc(8.4, 10, 8.4, 10, -48, -312)}` },
  D: { w: 12.5, d: "M0 0V20H4.2C9.4 20 12.5 15.8 12.5 10C12.5 4.2 9.4 0 4.2 0Z" },
  E: { w: 11, d: "M11 0H0V20H11M0 10H9.4" },
  H: { w: 13, d: "M0 0V20M13 0V20M0 10H13", top: [[0, 0, -1], [13, 0, 1]], bottom: [[0, 20, -1], [13, 20, 1]] },
  J: { w: 10.5, d: "M10.5 0V13.4C10.5 17.4 8.4 20 5.3 20C2.5 20 .5 18.2 0 15.2" },
  K: { w: 12.5, d: "M0 0V20M12 0L0 12M4.8 7.2L12.5 20", top: [[0, 0, -1], [12, 0, 1]], bottom: [[0, 20, -1], [12.5, 20, 1]] },
  L: { w: 10.5, d: "M0 0V20H10.5" },
  M: { w: 16, d: "M0 20V0L8 12.5L16 0V20", bottom: [[0, 20, -1], [16, 20, 1]] },
  N: { w: 13, d: "M0 20V0L13 20V0" },
  R: { w: 12.5, d: "M0 20V0H6.3C9.7 0 12 2.3 12 5.6C12 8.9 9.7 11.2 6.3 11.2H0M6.3 11.2L12.5 20", bottom: [[0, 20, -1], [12.5, 20, 1]] },
  S: { w: 12, d: `M${at(6, 5, 5.5, 5, -35)}${arc(6, 5, 5.5, 5, -35, -270)}${arc(6, 15, 6, 5, -90, 145)}` },
  T: { w: 14, d: "M0 0H14M7 0V20", top: [[0, 0, -1], [14, 0, 1]] },
  U: { w: 12, d: "M0 0V12.4C0 17 2.6 20 6 20C9.4 20 12 17 12 12.4V0", top: [[0, 0, -1], [12, 0, 1]] },
  V: { w: 14, d: "M0 0L7 20L14 0" },
  W: { w: 19, d: "M0 0L4.6 20L9.5 5.5L14.4 20L19 0" },
  X: { w: 13, d: "M0 0L13 20M13 0L0 20", top: [[0, 0, -1], [13, 0, 1]], bottom: [[0, 20, -1], [13, 20, 1]] },
  Y: { w: 14, d: "M0 0L7 10L14 0M7 10V20", top: [[0, 0, -1], [14, 0, 1]] },
  Z: { w: 12.5, d: "M0 0H12.5L0 20H12.5" },
  2: { w: 12, d: "M.6 4.6C1.5 1.8 3.7 0 6.3 0C9.6 0 11.8 2.3 11.8 5.4C11.8 7.9 10.5 9.6 8.4 11.6L0 20H12" },
  3: { w: 12, d: "M.6 0H11.2L5.6 7.8C9.4 7.8 12 10.4 12 14C12 17.6 9.4 20 6 20C3.4 20 1.2 18.6 .2 16.5" },
  4: { w: 13, d: "M9.5 20V0L0 13.6H13" },
  7: { w: 12, d: "M0 0H12L3.8 20" },
  8: { w: 12, d: `M${at(6, 4.7, 4.9, 4.7, 90)}${arc(6, 4.7, 4.9, 4.7, 90, 450)}M${at(6, 14.7, 6, 5.3, -90)}${arc(6, 14.7, 6, 5.3, -90, 270)}` },
};

/** The base set: letters and numerals that read well small. */
export const BRAND_BASES = Object.keys(GLYPHS);

// Which modifiers each base takes. Left out on purpose: shapes that read as a UI symbol (check
// mark, arrow, chevron, link, plus, close, text tool, step number, smile or frown), a well-known
// mark (a coin's logo, an app icon, a registered or copyright sign, sigma, a helipad) or something rude:
// Circle A B C D H J K L M R T V W X Z and numerals; Box B E H M N T V W X Y and numerals; Half
// Circle A C R; Lazy A B C D J L M U V Y 3 7; Tumbling all but D E K R Y 3; Flying V and W; Running W; T Bar and 7
// Bar (they read as I and Z); Double C D H K S V W 8; Diamond A S T V W M (a mountain, a superhero
// crest, a road sign, a gem) and wide letters (they shrink too far inside it). Tumbling E reads as a back arrow; Half Circle 7 and J as a question mark or power icon; Running V as a check mark; Circle S as an app logo.
const ALLOW = {
  circle: "ENUY",
  box: "ACDJKLRSUZ",
  half: "BDEHKLMNSTUVXYZ2348",
  lazy: "EKRST248",
  diamond: "JL27",
  tumbling: "DKRY3",
  running: "ACDEHJKLMNRSTUYZ23478",
  flying: "HKTXYU",
  walking: "AHKMRX",
  double: "AEJLMNRTUYZ2347",
};
const NO_BAR_UNDER = "T7";
/** Pairs that share a stem (the right stem of the first is the stem of the second). */
export const BRAND_CONNECTED = ["HE", "HK", "HL", "HR", "HD", "NE", "NK", "NR", "ND", "ME", "MK", "MR", "ML"];

const POSE_WORD = { lazy: "Lazy", tumbling: "Tumbling", running: "Running", flying: "Flying", walking: "Walking" };
const FRAME_WORD = { circle: "Circle", box: "Box", diamond: "Diamond", half: "Half Circle", rocking: "Rocking" };

// What may surround the figure, by its kind or pose. The number is each brand's weight: every
// allowed combination is one brand in the catalogue, picked in proportion to its weight, so the
// herd spreads evenly while clean classics (a plain letter, a circle) come up more often than
// busy ones (a bar over a rocker under a running letter).
const FRAMES_FOR = {
  upright: [["none", 14], ["barOver", 9], ["barUnder", 9], ["circle", 12], ["box", 10], ["diamond", 12], ["half", 9], ["rocking", 10], ["rockingBar", 4]],
  lazy: [["none", 8]], // with a bar, a letter on its side reads as a character of another script
  tumbling: [["none", 6]],
  running: [["none", 6], ["barUnder", 3], ["barOver", 3], ["rocking", 3]], // a slant is subtle at 22 px, so kept rarer
  flying: [["none", 12], ["barUnder", 9]],
  walking: [["none", 12], ["barOver", 9]],
  double: [["none", 6], ["barUnder", 4], ["barOver", 4]], // pairs are busy at 22 px, kept rarer
  connected: [["none", 6], ["barUnder", 4], ["barOver", 4], ["rocking", 3]], // one family (H, N or M sharing a stem), kept rarer
};
const POSES = ["upright", "lazy", "tumbling", "running", "flying", "walking"];
function frameOk(frame, kind, pose, b) {
  if (frame === "barUnder" && kind === "single" && (pose === "upright" || pose === "running") && NO_BAR_UNDER.includes(b)) return false;
  const f = frame === "rockingBar" ? "rocking" : frame;
  if (kind === "single" && pose === "upright" && ALLOW[f]) return ALLOW[f].includes(b);
  return true;
}

/** Every brand the herd can carry, in a fixed order (the order is part of each wallet's identity). */
export const BRAND_CATALOGUE = (() => {
  const out = [];
  const add = (letters, kind, pose, dir, frame, w) => {
    const bar = frame === "barOver" || frame === "rockingBar" ? "over" : frame === "barUnder" ? "under" : null;
    const enclosure = frame === "rockingBar" ? "rocking" : frame === "none" || frame.startsWith("bar") ? null : frame;
    out.push({ letters, kind, pose, dir, enclosure, bar, w });
  };
  for (const b of BRAND_BASES) for (const pose of POSES) {
    if (pose !== "upright" && !ALLOW[pose].includes(b)) continue;
    // S and 8 look the same lying either way, so they lie one way only.
    for (const dir of pose === "tumbling" || (pose === "lazy" && !"S8".includes(b)) ? [1, -1] : [1])
      for (const [frame, w] of FRAMES_FOR[pose]) if (frameOk(frame, "single", pose, b)) add([b], "single", pose, dir, frame, w);
  }
  for (const b of ALLOW.double) for (const [frame, w] of FRAMES_FOR.double) add([b, b], "double", "upright", 1, frame, w);
  for (const p of BRAND_CONNECTED) for (const [frame, w] of FRAMES_FOR.connected) add(p.split(""), "connected", "upright", 1, frame, w);
  let acc = 0;
  for (const e of out) { acc += e.w; e.cum = acc; }
  return out;
})();
const TOTAL = BRAND_CATALOGUE[BRAND_CATALOGUE.length - 1].cum;

/** Everything the brand needs, from the address. */
export function brandSpec(address) {
  const seed = walletSeed(address);
  const r = (k) => draw(seed, Math.imul(0x2c1b3c6d, k + 1) >>> 0);
  const accent = BRAND_ACCENTS[r(0) % BRAND_ACCENTS.length];
  const x = r(1) % TOTAL;
  let lo = 0, hi = BRAND_CATALOGUE.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (BRAND_CATALOGUE[mid].cum > x) hi = mid; else lo = mid + 1; }
  const { letters, kind, pose, dir, enclosure, bar } = BRAND_CATALOGUE[lo];
  const modifiers = [];
  if (bar === "over") modifiers.push("bar-over");
  if (enclosure) modifiers.push(enclosure);
  if (pose !== "upright") modifiers.push(pose);
  if (kind !== "single") modifiers.push(kind);
  if (bar === "under") modifiers.push("bar-under");
  return { base: letters.join(""), kind, letters, pose, dir, enclosure, bar, modifiers, index: lo,
    accent: accent.dark, accentLight: accent.light, accentName: accent.name };
}

/** Brands for the wallets shown together: two wallets in one view that carry the same brand are
 * told apart by colour. The first keeps its own; a later twin whose colour looks like one its
 * brand already has here takes the next accent along of a family not yet used by that brand
 * (the brand itself never changes, and a wallet without a twin in the view keeps its colour).
 * Map: lowercase address -> spec. */
export function viewBrands(addresses) {
  const out = new Map(), used = new Map();
  for (const a of addresses || []) {
    const key = String(a || "").trim().toLowerCase();
    if (!key || out.has(key)) continue;
    const s = brandSpec(key);
    const taken = used.get(s.index) || [];
    let i = BRAND_ACCENTS.findIndex((x) => x.name === s.accentName);
    const clash = (x) => taken.some((t) => t.family === x.family);
    if (clash(BRAND_ACCENTS[i])) {
      const order = BRAND_ACCENTS.map((_, k) => (i + k) % BRAND_ACCENTS.length);
      const free = order.find((k) => !clash(BRAND_ACCENTS[k])) ?? order.find((k) => !taken.includes(BRAND_ACCENTS[k]));
      if (free !== undefined) i = free;
    }
    const acc = BRAND_ACCENTS[i];
    taken.push(acc);
    used.set(s.index, taken);
    out.set(key, { ...s, accent: acc.dark, accentLight: acc.light, accentName: acc.name });
  }
  return out;
}

/** The brand's name in the ranchers' reading order, e.g. "Bar Rocking R", "Lazy 8", "HK Connected". */
export function brandName(s) {
  const w = [];
  if (s.bar === "over") w.push("Bar");
  if (s.enclosure) w.push(FRAME_WORD[s.enclosure]);
  if (s.pose !== "upright") w.push(POSE_WORD[s.pose]);
  if (s.kind === "double") w.push("Double", s.letters[0]);
  else if (s.kind === "connected") w.push(s.letters.join(""), "Connected");
  else w.push(s.letters[0]);
  if (s.bar === "under") w.push("Bar");
  return w.join(" ");
}

// ---------------------------------------------------------------------------------------------
// Geometry: paths as subpaths of points and segments, transformed point by point.

function parse(d) {
  const tok = d.match(/[MLHVCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) || [];
  const subs = [];
  let cur = null, pt = [0, 0], i = 0, cmd = null;
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[A-Z]/i.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === "M") { pt = [num(), num()]; cur = { start: pt, segs: [], closed: false }; subs.push(cur); cmd = "L"; }
    else if (cmd === "L") { pt = [num(), num()]; cur.segs.push({ to: pt }); }
    else if (cmd === "H") { pt = [num(), pt[1]]; cur.segs.push({ to: pt }); }
    else if (cmd === "V") { pt = [pt[0], num()]; cur.segs.push({ to: pt }); }
    else if (cmd === "C") { const c1 = [num(), num()], c2 = [num(), num()]; pt = [num(), num()]; cur.segs.push({ c1, c2, to: pt }); }
    else if (cmd === "Z") { cur.closed = true; pt = cur.start; cmd = null; }
  }
  return subs;
}
const mapPath = (subs, fn) => subs.map((s) => ({ start: fn(s.start), closed: s.closed,
  segs: s.segs.map((g) => (g.c1 ? { c1: fn(g.c1), c2: fn(g.c2), to: fn(g.to) } : { to: fn(g.to) })) }));
const f = (n) => { const v = Math.round(n * 100) / 100; return Object.is(v, -0) ? 0 : v; };
function toD(subs) {
  return subs.map((s) => `M${f(s.start[0])} ${f(s.start[1])}` + s.segs.map((g) => (g.c1
    ? `C${f(g.c1[0])} ${f(g.c1[1])} ${f(g.c2[0])} ${f(g.c2[1])} ${f(g.to[0])} ${f(g.to[1])}`
    : `L${f(g.to[0])} ${f(g.to[1])}`)).join("") + (s.closed ? "Z" : "")).join("");
}
function samples(subs) {
  const out = [];
  for (const s of subs) {
    let p = s.start;
    out.push(p);
    for (const g of s.segs) {
      if (g.c1) for (let k = 1; k <= 12; k++) {
        const t = k / 12, u = 1 - t;
        out.push([u * u * u * p[0] + 3 * u * u * t * g.c1[0] + 3 * u * t * t * g.c2[0] + t * t * t * g.to[0],
          u * u * u * p[1] + 3 * u * u * t * g.c1[1] + 3 * u * t * t * g.c2[1] + t * t * t * g.to[1]]);
      } else out.push(g.to);
      p = g.to;
    }
  }
  return out;
}
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
const PARSED = Object.fromEntries(Object.entries(GLYPHS).map(([k, g]) => [k, parse(g.d)]));

// The figure (one letter or a pair) in glyph units, its centre at the origin, with its free ends.
function figure(s) {
  const L = s.letters, g0 = GLYPHS[L[0]];
  let subs = PARSED[L[0]], top = g0.top || [], bottom = g0.bottom || [], w = g0.w;
  if (L.length === 2) {
    const off = s.kind === "connected" ? g0.w : g0.w + 5;
    subs = subs.concat(mapPath(PARSED[L[1]], ([x, y]) => [x + off, y]));
    w = off + GLYPHS[L[1]].w;
    top = []; bottom = [];
  }
  const centre = ([x, y]) => [x - w / 2, y - 10];
  subs = mapPath(subs, centre);
  top = top.map(([x, y, o]) => [x - w / 2, y - 10, o]);
  bottom = bottom.map(([x, y, o]) => [x - w / 2, y - 10, o]);
  // Pose: Lazy lies on its side, Tumbling tilts, Running slants.
  let fn = null;
  if (s.pose === "lazy" || s.pose === "tumbling") {
    const a = (s.dir * (s.pose === "lazy" ? 90 : 45) * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
    fn = ([x, y]) => [x * c - y * si, x * si + y * c];
  } else if (s.pose === "running") fn = ([x, y]) => [x - 0.3 * y, y];
  if (fn) subs = mapPath(subs, fn);
  return { subs, top, bottom };
}

// Scale that fits the figure's points under every limit given (bbox height and width, and the
// distance of any point from the figure's centre).
function fitScale(pts, { h = Infinity, w = Infinity, radius = Infinity, l1 = Infinity }) {
  const b = bbox(pts);
  let rMax = 0, lMax = 0;
  for (const [x, y] of pts) { rMax = Math.max(rMax, Math.hypot(x - b.cx, y - b.cy)); lMax = Math.max(lMax, Math.abs(x - b.cx) + Math.abs(y - b.cy)); }
  return Math.min(h / b.h, w / b.w, radius / rMax, l1 / lMax);
}

// Centreline distance between two separate strokes: the iron plus air. Frames sit a little closer.
const GAP = SW + 2.4, EGAP = SW + 2.0;
const RING = { circle: 12.8, box: 11.4, diamond: 13.8, half: 12.6 };
// Inside the diamond the air is a little tighter, so the letter keeps its size.
const DGAP = SW + 1.3;

/** The brand as a list of stroked paths: { d, width, part } in the 36 x 36 view. */
export function brandShapes(s) {
  const fig = figure(s);
  const pts = samples(fig.subs);
  const pair = s.letters.length === 2;
  const enc = s.enclosure;
  // Room for the figure, by what surrounds it.
  const lim = { h: pair ? 15 : 18, w: pair ? 25 : 21 };
  if (s.bar || enc === "rocking") lim.h = pair ? 13 : 14.5;
  if (s.bar && enc === "rocking") lim.h = 12;
  if (s.pose === "flying") { lim.w -= 9; lim.h -= 3; }
  if (s.pose === "walking") lim.w -= 5;
  if (enc === "circle") Object.assign(lim, { radius: RING.circle - EGAP, h: 14 });
  if (enc === "box") Object.assign(lim, { h: 2 * (RING.box - EGAP), w: 2 * (RING.box - EGAP) });
  if (enc === "diamond") Object.assign(lim, { l1: RING.diamond - DGAP * Math.SQRT2, h: 14 });
  if (enc === "half") Object.assign(lim, { w: 2 * (RING.half - GAP) - 1, h: 14 });
  const k = fitScale(pts, lim);
  const b0 = bbox(pts);
  const place = ([x, y]) => [(x - b0.cx) * k, (y - b0.cy) * k];
  let subs = mapPath(fig.subs, place);
  const parts = [{ subs, part: "figure" }];
  let fb = bbox(samples(subs));
  if (enc === "half") {
    // The figure sits under the half circle: its upper half inside the dome.
    const R = RING.half;
    let dy = 0;
    const up = samples(subs);
    // The lowest arc centre that leaves a stroke of air between the arc and every point above it.
    for (let c = fb.y0 - 1; c < fb.y1; c += 0.1) {
      const ok = up.every(([x, y]) => y > c || Math.hypot(x, y - c) <= R - GAP);
      if (!ok) break;
      dy = c;
    }
    const cyA = dy;
    const arcD = `M${-R} ${cyA}${arc(0, cyA, R, R, 180, 360)}`;
    parts.push({ subs: parse(arcD), part: "half" });
  }
  // Wings and feet: fixed size, so they read the same on any letter.
  if (s.pose === "flying") {
    const wing = fig.top.map(([x, y, o]) => {
      const [px, py] = place([x, y]);
      return `M${px} ${py}C${px + o * 2.4} ${py} ${px + o * 4.4} ${py - 0.8} ${px + o * 5.2} ${py - 4}`;
    }).join("");
    parts.push({ subs: parse(wing), part: "wings" });
  }
  if (s.pose === "walking") {
    const feet = fig.bottom.map(([x, y, o]) => { const [px, py] = place([x, y]); return `M${px} ${py}H${px + 4.4}`; }).join("");
    parts.push({ subs: parse(feet), part: "feet" });
  }
  fb = bbox(parts.flatMap((p) => samples(p.subs)));
  const figW = bbox(samples(subs)).w;
  if (enc === "rocking") {
    // A wide, shallow runner, broader than the figure like a rocking chair's, a stroke of air
    // below it (lower still where its ends would come close to a wide figure's lower corners).
    const w = Math.min(26, Math.max(20, figW + 10)), lift = 2.4, ink = parts.flatMap((p) => samples(p.subs));
    const rocker = (y) => parse(`M${-w / 2} ${y - lift}C${-w / 4.6} ${y + lift / 3} ${w / 4.6} ${y + lift / 3} ${w / 2} ${y - lift}`);
    let y = fb.y1 + GAP;
    const clear = (y) => samples(rocker(y)).every(([x1, y1]) => ink.every(([x2, y2]) => Math.hypot(x1 - x2, y1 - y2) >= GAP));
    while (!clear(y)) y += 0.2;
    parts.push({ subs: rocker(y), part: "rocker" });
  }
  if (s.bar) {
    const all = bbox(parts.flatMap((p) => samples(p.subs)));
    const w = Math.min(22, Math.max(14, figW + 5));
    const y = s.bar === "over" ? (enc === "rocking" ? fb.y0 : all.y0) - GAP : all.y1 + GAP;
    parts.push({ subs: parse(`M${-w / 2} ${y}H${w / 2}`), part: "bar" });
  }
  // Centre the group, then draw the closed frames around the centre.
  let g = bbox(parts.flatMap((p) => samples(p.subs)));
  if (enc === "circle" || enc === "box" || enc === "diamond") g = { cx: 0, cy: 0 };
  const shift = ([x, y]) => [x - g.cx + C, y - g.cy + C];
  const out = parts.map((p) => ({ d: toD(mapPath(p.subs, shift)), width: SW, part: p.part }));
  if (enc === "circle") out.push({ d: toD(parse(`M${C + RING.circle} ${C}${arc(C, C, RING.circle, RING.circle, 0, 360)}Z`)), width: SW, part: "circle" });
  if (enc === "diamond") { const a = RING.diamond; out.push({ d: `M${C} ${C - a}L${C + a} ${C}L${C} ${C + a}L${C - a} ${C}Z`, width: SW, part: "diamond" }); }
  if (enc === "box") { const a = RING.box; out.push({ d: `M${C - a} ${C - a}H${C + a}V${C + a}H${C - a}Z`, width: SW, part: "box" }); }
  return out;
}

/** The outer bounds of a brand's ink (centrelines plus half the iron), for checks. */
export function brandBounds(shapes) {
  const b = bbox(shapes.flatMap((x) => samples(parse(x.d))));
  return { x0: b.x0 - SW / 2, y0: b.y0 - SW / 2, x1: b.x1 + SW / 2, y1: b.y1 + SW / 2 };
}

/** A whole brand as an SVG string (tile, then the iron), for sheets and server renders. */
export function brandSVG(address, { size = 36, theme = "dark" } = {}) {
  const s = brandSpec(address), t = BRAND_TILE[theme], col = theme === "light" ? s.accentLight : s.accent;
  const paths = brandShapes(s).map((x) => `<path d="${x.d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${BRAND_VIEW} ${BRAND_VIEW}">`
    + `<path d="${BRAND_TILE.d}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="1"/>`
    + `<g fill="none" stroke="${col}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

// Drop-in names matching walletEmblem.js.
export const EMBLEM_VIEW = BRAND_VIEW;
export const PLATE = BRAND_TILE.d;
export const emblemSpec = brandSpec;
export const emblemShapes = brandShapes;
