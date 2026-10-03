// A wallet's emblem: a machined badge in Torq's style, drawn from the address. A plate with the
// logo's cut corners carries one mechanical mark (gear, hex nut, bolt circle, chevrons, gauge,
// piston, rivet grid, crosshair), its size, count and turn set by the address hash, in one of
// a few accent colours kept off green and red so a wallet never looks like profit or loss.
// Pure data and SVG paths, no requests. The same address always gives the same emblem.

import { draw, walletSeed } from "./walletName.js";

export const EMBLEM_VIEW = 36;
const C = EMBLEM_VIEW / 2;
// Accents: orange family, brass, steel blue, slate, ivory. `on` is the mark colour on the plate.
export const EMBLEM_ACCENTS = ["#ff6a1a", "#ff9a4d", "#d9a441", "#8fb0cf", "#a7b0bb", "#e8e2d4"];
export const EMBLEM_MARKS = ["gear", "nut", "bolts", "chevrons", "gauge", "piston", "grid", "cross"];

// The plate: a square with two cut corners (top left, bottom right), echoing the logo.
export const PLATE = "M8 1H35V28L28 35H1V8Z";

const f = (n) => Number(n.toFixed(2));
const polar = (r, a) => [f(C + r * Math.cos(a)), f(C + r * Math.sin(a))];

function gear(teeth, rIn, rOut, turn) {
  const pts = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = turn + (i * Math.PI) / teeth, a1 = turn + ((i + 1) * Math.PI) / teeth;
    const r = i % 2 ? rIn : rOut;
    pts.push(polar(r, a0 + 0.08), polar(r, a1 - 0.08));
  }
  return "M" + pts.map((p) => p.join(" ")).join("L") + "Z";
}
function polygon(sides, r, turn) {
  return "M" + Array.from({ length: sides }, (_, i) => polar(r, turn + (i * 2 * Math.PI) / sides).join(" ")).join("L") + "Z";
}
const circle = (x, y, r) => `M${f(x - r)} ${f(y)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;

/** Everything the emblem needs, from the address. */
export function emblemSpec(address) {
  const seed = walletSeed(address);
  const r = (k) => draw(seed, 0x5bd1e995 * (k + 1));
  const mark = EMBLEM_MARKS[r(0) % EMBLEM_MARKS.length];
  const accent = EMBLEM_ACCENTS[r(1) % EMBLEM_ACCENTS.length];
  return { mark, accent, n: r(2), turn: ((r(3) % 8) * Math.PI) / 4 / (mark === "gear" || mark === "nut" ? 4 : 1), stripe: r(4) % 3 };
}

/** The mark as a list of paths: { d, fill?: true, stroke?: true, faint?: true }. */
export function emblemShapes(s) {
  const out = [];
  switch (s.mark) {
    case "gear": {
      const teeth = 6 + (s.n % 5);
      out.push({ d: gear(teeth, 8.2, 11, s.turn), fill: true }, { d: circle(C, C, 3.6), hole: true });
      break;
    }
    case "nut":
      out.push({ d: polygon(6, 11, s.turn + Math.PI / 6), fill: true }, { d: circle(C, C, 4.6), hole: true });
      break;
    case "bolts": {
      const n = 3 + (s.n % 4);
      out.push({ d: circle(C, C, 10.5), stroke: true, faint: true });
      for (let i = 0; i < n; i++) {
        const [x, y] = polar(10.5, s.turn + (i * 2 * Math.PI) / n);
        out.push({ d: circle(x, y, 2.3), fill: true });
      }
      out.push({ d: circle(C, C, 3.2), fill: true });
      break;
    }
    case "chevrons": {
      const n = 2 + (s.n % 2);
      for (let i = 0; i < n; i++) {
        const y = 12 + i * (n === 2 ? 7 : 5.5);
        out.push({ d: `M10 ${f(y + 5)}L18 ${f(y - 1)}L26 ${f(y + 5)}`, stroke: true, wide: true });
      }
      break;
    }
    case "gauge": {
      const a = Math.PI * (0.85 + (s.n % 7) * 0.12);
      out.push({ d: `M${polar(10, Math.PI * 0.8).join(" ")}A10 10 0 1 1 ${polar(10, Math.PI * 0.2).join(" ")}`, stroke: true, faint: true },
        { d: `M${C} ${C}L${polar(9, a).join(" ")}`, stroke: true, wide: true }, { d: circle(C, C, 2.4), fill: true });
      break;
    }
    case "piston": {
      const h = 5 + (s.n % 5);
      out.push({ d: `M11 8H25V${f(8 + h)}H11Z`, fill: true }, { d: `M18 ${f(8 + h)}V28`, stroke: true, wide: true },
        { d: circle(18, 28, 2.6), fill: true });
      break;
    }
    case "grid": {
      const n = 2 + (s.n % 2), gap = n === 2 ? 9 : 7;
      const start = C - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
        out.push({ d: circle(start + i * gap, start + j * gap, (i + j + s.n) % 3 ? 1.9 : 2.8), fill: true });
      break;
    }
    default: {
      out.push({ d: circle(C, C, 9.5), stroke: true }, { d: `M${C} 6.5V13M${C} 23V29.5M6.5 ${C}H13M23 ${C}H29.5`, stroke: true, wide: true },
        { d: circle(C, C, 2.2), fill: true });
    }
  }
  return out;
}
