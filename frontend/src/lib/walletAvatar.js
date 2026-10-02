// Address-seeded Torq emblems. The existing palette and seed preserve wallet colors;
// only the decorative avatar changes. No remote images or wallet data are involved.
import { draw, walletSeed } from "./walletName.js";

export const AVATAR_PALETTE = [
  { c: "#5eead4", light: "#0f766e" }, // teal
  { c: "#38bdf8", light: "#0369a1" }, // sky
  { c: "#818cf8", light: "#4f46e5" }, // indigo
  { c: "#c084fc", light: "#7e22ce" }, // violet
  { c: "#f472b6", light: "#be185d" }, // pink
  { c: "#fb923c", light: "#c2410c" }, // orange
  { c: "#fbbf24", light: "#a16207" }, // amber
  { c: "#bef264", light: "#4d7c0f" }, // lime
  { c: "#e7c9a0", light: "#8a6a2f" }, // sand
  { c: "#94a3b8", light: "#475569" }, // slate
];
export const AVATAR_VIEW = 36;
export const AVATAR_OUTLINE = "M7 1H29L35 7V29L29 35H7L1 29V7Z";

// Solid silhouettes stay readable at table size. The second face adds a cut-metal facet.
const EMBLEMS = [
  ["M8 9H15L24 18L15 27H8L17 18Z", "M19 9H26L35 18L26 27H19L28 18Z"],
  ["M18 6L30 18L18 30L6 18ZM18 12L12 18L18 24L24 18Z", "M18 6L30 18L24 18L18 12Z"],
  ["M7 8H13V28H7ZM17 8H23V28H17Z", "M27 8H31V28H27Z"],
  ["M7 7H17V17H7ZM19 19H29V29H19Z", "M20 7H29V16H20ZM7 20H16V29H7Z"],
  ["M18 6L23 15L18 18L13 15ZM18 30L13 21L18 18L23 21Z", "M6 18L15 13L18 18L15 23ZM30 18L21 23L18 18L21 13Z"],
  ["M7 7H29V13H13V29H7Z", "M17 17H29V29H23V23H17Z"],
  ["M7 7H18L29 18V29L18 18H7Z", "M20 7H29V16ZM7 20H16V29H7Z"],
  ["M8 6H14V22H26V28H8Z", "M18 8H28V18H22V14H18Z"],
];

export function avatarSpec(address) {
  const seed = walletSeed(address);
  const color = AVATAR_PALETTE[draw(seed, 0x2545f491) % AVATAR_PALETTE.length];
  return {
    body: color.c,
    bodyLight: color.light,
    motif: draw(seed, 0x4a8be922) % EMBLEMS.length,
    rotate: (draw(seed, 0x6fd1ddb3) % 4) * 90,
  };
}

export function avatarShapes(spec) {
  return EMBLEMS[spec.motif].map((d, i) => ({
    d,
    fill: spec.body,
    fillRule: "evenodd",
    opacity: i === 0 ? 1 : 0.48,
  }));
}

// Matching SVG for non-React consumers, without document-wide clip IDs.
export function avatarSvg(address, size = 28) {
  const s = avatarSpec(address);
  const paths = avatarShapes(s).map(({ d, fill, opacity }) =>
    `<path d="${d}" fill="${fill}" fill-rule="evenodd" opacity="${opacity}"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">`
    + `<path d="${AVATAR_OUTLINE}" fill="#171f20"/>`
    + `<path d="${AVATAR_OUTLINE}" fill="${s.body}" fill-opacity=".08" stroke="${s.body}" stroke-opacity=".35"/>`
    + `<g transform="rotate(${s.rotate} 18 18) translate(3 3) scale(.833333)">${paths}</g></svg>`;
}

export const walletColor = (address, light = false) => {
  const s = avatarSpec(address);
  return light ? s.bodyLight : s.body;
};
