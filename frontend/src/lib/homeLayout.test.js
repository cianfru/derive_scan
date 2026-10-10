import { describe, expect, it } from "vitest";
import { compactCount, groupIconSize, radarLayout, separate, swarm } from "./homeLayout.js";

const overlap = (a, b) => Math.hypot(a.px - b.px, a.py - b.py) < (a.s + b.s) / 2 - 0.5;

describe("home card layouts", () => {
  it("radar: long above the midline, short below, exact across, the trend at the middle", () => {
    const pts = [{ und: "BTC", x: 0.8, y: 0.3 }, { und: "SOL", x: 0.6, y: -0.8 }, { und: "HYPE", x: -1.7, y: 0.3, lead: true }];
    const L = radarLayout(pts, [], { w: 300, h: 120 });
    const at = Object.fromEntries(L.marks.map((m) => [m.und, m]));
    const mid = L.ph / 2;
    expect(at.BTC.py).toBeLessThan(mid);
    expect(at.SOL.py).toBeGreaterThan(mid);
    expect(at.HYPE.px).toBeLessThan(L.zero);
    expect(at.BTC.px).toBeGreaterThan(at.SOL.px);
    expect(L.zero).toBeCloseTo(150, 5);
    expect(at.HYPE.s).toBe(L.s + 6); // the most stretched coin is drawn larger
  });

  it("radar: coins without a wallet reading get their own lane under the field, or stay off a short card", () => {
    const pts = [{ und: "BTC", x: 0.8, y: -1 }, { und: "ETH", x: 0.5, y: 0.4 }];
    const strip = [{ und: "ADA", x: 1.2, y: null }];
    const tall = radarLayout(pts, strip, { w: 300, h: 140 });
    expect(tall.lane).toBeGreaterThan(0);
    expect(tall.laneMarks.map((m) => m.und)).toEqual(["ADA"]);
    expect(tall.laneY).toBeGreaterThan(tall.ph); // below the field, never at y = -1 inside it
    expect(Math.max(...tall.marks.map((m) => m.py + m.s / 2))).toBeLessThanOrEqual(tall.ph + 0.01);
    expect(tall.offMap).toBe(0);
    const short = radarLayout(pts, strip, { w: 300, h: 80 });
    expect(short.lane).toBe(0);
    expect(short.laneMarks).toEqual([]);
    expect(short.offMap).toBe(1);
    expect(short.words).toEqual(["Long", "Short"]);
    expect(tall.words).toEqual(["Wallets long", "Wallets short"]);
    const tiny = radarLayout(pts, strip, { w: 220, h: 52 });
    expect(tiny.axis).toBeGreaterThan(0); // the trend words stay
    expect(tiny.words).toBeNull(); // the tint alone says long and short
  });

  it("radar: with no wallet reading at all, every coin sits on one stretch line", () => {
    const L = radarLayout([], [{ und: "BTC", x: 0.8 }, { und: "HYPE", x: -1.7 }], { w: 300, h: 100 });
    expect(L.flat).toBe(true);
    expect(L.marks.map((m) => m.und)).toEqual(["BTC", "HYPE"]);
    expect(L.marks.every((m) => Math.abs(m.py - L.ph / 2) < 0.01)).toBe(true);
    expect(L.lane).toBe(0);
  });

  it("separate: pushes crowded icons apart without crossing the midline", () => {
    const pts = [0.3, 0.32, 0.35].map((y, i) => ({ px: 100 + i, py: 50 - y * 40, s: 18, half: 1, y }))
      .concat([{ px: 101, py: 60, s: 18, half: -1, y: -0.2 }]);
    separate(pts, { top: 0, bottom: 100, mid: 50 });
    for (const p of pts) expect(p.half > 0 ? p.py <= 50 : p.py >= 50).toBe(true);
    const longs = pts.filter((p) => p.half > 0);
    expect(overlap(longs[0], longs[1]) || overlap(longs[1], longs[2]) || overlap(longs[0], longs[2])).toBe(false);
  });

  it("swarm: calls above the line and puts below, at their exact times, stacked rather than piled", () => {
    const dots = [{ px: 50, r: 10, side: -1 }, { px: 52, r: 6, side: -1 }, { px: 51, r: 8, side: 1 }, { px: 200, r: 4, side: 1 }];
    const out = swarm(dots, { mid: 50, lo: 0, hi: 100 });
    for (const d of out) {
      expect(d.side < 0 ? d.py < 50 : d.py > 50).toBe(true);
      expect(d.py - d.r).toBeGreaterThanOrEqual(-0.01);
      expect(d.py + d.r).toBeLessThanOrEqual(100.01);
    }
    expect(out.map((d) => d.px).sort((a, b) => a - b)).toEqual([50, 51, 52, 200]);
    const [big, small] = [out.find((d) => d.r === 10), out.find((d) => d.r === 6)];
    expect(Math.hypot(big.px - small.px, big.py - small.py)).toBeGreaterThanOrEqual(big.r + small.r);
    expect(Math.abs(big.py - 50)).toBeLessThan(Math.abs(small.py - 50)); // the largest nearest the line
  });

  it("group icons shrink to fit the width, and never under 14px", () => {
    const groups = [{ n: 9, name: "Trending up 9" }, { n: 3, name: "Cooling off 3" }];
    const wide = groupIconSize(groups, { w: 354, h: 90 });
    const narrow = groupIconSize(groups, { w: 249, h: 90 });
    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBeLessThanOrEqual(40);
    const width = (s) => groups.reduce((t, g) => t + Math.max(g.n * s * 0.78 + s * 0.22, g.name.length * 6.6 + 6), 0) + 16;
    expect(width(narrow)).toBeLessThanOrEqual(249);
    expect(groupIconSize(groups, { w: 60, h: 90 })).toBe(14);
  });

  it("compact counts stay within four characters", () => {
    expect([3, 132, 2353, 6750, 9999, 12345, 123456, 999999, 1234567].map(compactCount))
      .toEqual(["3", "132", "2.4K", "6.8K", "10K", "12K", "123K", "1M", "1.2M"]);
  });
});
