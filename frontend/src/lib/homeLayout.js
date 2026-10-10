// Pixel layouts for the home cards' small charts (components/HomeLive.jsx), pure so they can be tested.
// Every mark keeps its exact place along the axis that carries its reading; crowding only moves marks
// along the other axis, and never across the line that splits long from short or calls from puts.

/**
 * Pushes overlapping icons apart vertically. Each centre stays inside the plot and inside its own half:
 * `half` 1 keeps it above the midline (long), -1 below (short), 0 anywhere. Mutates and returns `pts`
 * ({px, py, s, half, y}); icons that cannot all fit keep their nearest places and overlap a little.
 */
export function separate(pts, { top, bottom, mid, rounds = 80 }) {
  const lo = (p) => (p.half < 0 ? Math.max(mid, top + p.s / 2) : top + p.s / 2);
  const hi = (p) => (p.half > 0 ? Math.min(mid, bottom - p.s / 2) : bottom - p.s / 2);
  for (let k = 0; k < rounds; k++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      const need = (a.s + b.s) / 2 + 1;
      const dx = Math.abs(a.px - b.px);
      if (dx >= need) continue;
      const want = Math.sqrt(need * need - dx * dx);
      const dy = b.py - a.py;
      if (Math.abs(dy) >= want - 0.01) continue;
      // The higher reading goes up; equal places split by reading, then by order.
      const dir = dy !== 0 ? Math.sign(dy) : (b.y ?? 0) <= (a.y ?? 0) ? 1 : -1;
      const push = (want - Math.abs(dy)) / 2;
      a.py -= dir * push; b.py += dir * push;
      moved = true;
    }
    for (const p of pts) p.py = Math.min(Math.max(lo(p), p.py), Math.max(lo(p), hi(p)));
    if (!moved) break;
  }
  return pts;
}

export const RADAR = { axis: 14, lane: 20, gap: 3 };

/**
 * The home radar in pixels for a band of {w, h}: the plot (across: the 1D price stretch, exact; up: the
 * Smart balance from -1 to 1), the lane under it for coins without a wallet reading (outside the plot,
 * so none reads as short), and the axis words' row. With no wallet reading at all the plot becomes one
 * stretch line. Where a lane would leave the plot under 76px, the coins without a reading stay off the
 * card (counted under it as `offMap`) and in the pop-out and on the page.
 * `points` {und, x, y, lead}, `strip` {und, x, lead}.
 */
export function radarLayout(points, strip, { w, h }) {
  const flat = !points.length;
  const axis = h >= 48 ? RADAR.axis : 0;
  let lane = !flat && strip.length ? RADAR.lane : 0;
  let ph = h - (axis ? axis + RADAR.gap : 0) - (lane ? lane + RADAR.gap : 0);
  if (lane && ph < 76) { ph += lane + RADAR.gap; lane = 0; }
  // Icons scale with the field's height and, in a narrow card, its width, so a crowded cluster overlaps less.
  const s = Math.round(Math.max(14, Math.min(26, ph / 3, w / 15)));
  const inPlot = flat ? strip : points;
  const shown = lane ? [...points, ...strip] : inPlot;
  const span = Math.max(0.25, ...shown.map((p) => Math.abs(p.x))) * 1.04;
  const pad = (s + 6) / 2 + 2;
  const X = (x) => pad + ((x / span + 1) / 2) * (w - 2 * pad);
  const mid = ph / 2;
  const marks = inPlot.map((p) => {
    const size = p.lead ? s + 6 : s;
    const y = flat ? 0 : Math.max(-1, Math.min(1, p.y));
    return { ...p, s: size, half: flat ? 0 : Math.sign(y), px: X(p.x), py: mid - y * (mid - size / 2 - 1) };
  });
  separate(marks, { top: 0, bottom: ph, mid });
  const laneY = ph + RADAR.gap + lane / 2, ls = Math.min(s, 18);
  const laneMarks = lane ? strip.map((p) => ({ ...p, s: p.lead ? ls + 4 : ls, px: X(p.x), py: laneY })) : [];
  // The wallet words ("Wallets long" / "short", just "Long" / "Short" in a short field, none under 44px,
  // where the tint alone says it) sit in the field's top and bottom edges where they cover the fewest
  // coins: the left corners first, else the first clear place across, else the least covered.
  const zero = X(0), long = ph >= 64, WW = long ? 104 : 52, WH = Math.min(24, ph / 2);
  const covered = (l) => [[0, WH], [ph - WH, ph]].reduce((n, [t, b]) => n + marks.filter((p) =>
    p.px + p.s / 2 > l && p.px - p.s / 2 < l + WW && p.py + p.s / 2 > t && p.py - p.s / 2 < b).length, 0);
  const spots = [0, w - WW];
  for (let l = 24; l < w - WW - 24; l += 24) spots.push(l);
  const wordsAt = spots.reduce((a, l) => (covered(l) < covered(a) ? l : a), 0);
  return { flat, ph, lane, laneY, axis, s, zero, marks, laneMarks, wordsAt,
    words: long ? ["Wallets long", "Wallets short"] : ph >= 44 ? ["Long", "Short"] : null,
    offMap: !flat && !lane ? strip.length : 0 };
}


/**
 * The coin icon size for the Markets card's regime groups: the largest, up to 40px, at which every
 * group's overlapping icons and its name (12px, taken as 6.6px a character) fit the band's width, with
 * room under the icons for the group's rule and name (`named` false: the rule alone, in a band too short
 * for the names).
 */
export function groupIconSize(groups, { w, h }, named = true) {
  const nameW = (g) => (named ? g.name.length * 6.6 + 6 : 0);
  const width = (s) => groups.reduce((t, g) => t + Math.max(g.n * s * 0.78 + s * 0.22, nameW(g)), 0) + 16 * (groups.length - 1);
  let s = Math.floor(Math.min(40, h - (named ? 34 : 12)));
  while (s > 14 && width(s) > w) s--;
  return Math.max(14, s);
}

/** Trader counts under the Posses ladder in four characters at most: 3, 132, 2.4K, 12K, 1.2M. */
export function compactCount(n) {
  if (!Number.isFinite(n)) return "0";
  if (n >= 999500) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 9950) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}
