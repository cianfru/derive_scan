import { describe, expect, it } from "vitest";
import { bubbleLayout, dayLayout, flowCoins, leanOf, leanParts, leanWords } from "./flowBubbles.js";
import { separate } from "./homeLayout.js";

const coins = flowCoins({
  ETH: { call: { buy_premium_usd: 187857 * 0.45, sell_premium_usd: 93918 }, put: { buy_premium_usd: 17735, sell_premium_usd: 104256 } },
  BTC: { call: { buy_premium_usd: 28533 }, put: { buy_premium_usd: 8687 } },
  HYPE: { call: { buy_premium_usd: 13162 }, put: { buy_premium_usd: 17586 } },
  ZEC: { call: { sell_premium_usd: 24499 }, put: { sell_premium_usd: 4542 } },
  XRP: { call: { buy_premium_usd: 2489 }, put: { buy_premium_usd: 2891 } },
  XAUT: { call: { buy_premium_usd: 3598 }, put: { buy_premium_usd: 377 } },
  LIT: { call: { buy_premium_usd: 305 }, put: { buy_premium_usd: 524 } },
  SOL: { call: { buy_premium_usd: 123 }, put: { buy_premium_usd: 89 } },
  PUMP: { call: { buy_premium_usd: 10 }, put: { buy_premium_usd: 80 } },
  ADA: { call: {}, put: {} },
});

describe("flow bubbles", () => {
  it("reads each coin's money and which way it points, most money first, coins without money left out", () => {
    expect(coins.map((c) => c.und)).toEqual(["ETH", "BTC", "HYPE", "ZEC", "XRP", "XAUT", "LIT", "SOL", "PUMP"]);
    const zec = coins.find((c) => c.und === "ZEC");
    // Calls sold gain if it falls, puts sold if it rises.
    expect(zec).toMatchObject({ rise: 4542, fall: 24499, lean: "down" });
    expect(leanWords(zec)).toBe("84% on a fall");
    expect(leanWords(coins.find((c) => c.und === "BTC"))).toBe("77% on a rise");
    expect(leanWords(coins.find((c) => c.und === "XRP"))).toBe("about even");
    expect([0.55, 0.549, 0.5, 0.451, 0.45].map(leanOf)).toEqual(["up", "even", "even", "even", "down"]);
    expect(leanParts(zec)).toEqual({ pct: 84, word: "fall" });
    expect(leanParts(coins.find((c) => c.und === "XRP"))).toBeNull();
  });

  it("places each bubble by its share exactly, larger for more money, inside the field and touching no other", () => {
    for (const [w, h] of [[780, 96], [1300, 290], [326, 270], [300, 70]]) {
      const L = bubbleLayout(coins, { w, h, rMin: 10, rMax: 58, labels: 9, label: (c) => `${c.und} $00.0K` });
      const by = Object.fromEntries(L.marks.map((m) => [m.und, m]));
      // Left to right in the order of their shares.
      const order = [...L.marks].sort((a, b) => a.x - b.x).map((m) => m.und);
      expect(order).toEqual([...coins].sort((a, b) => a.share - b.share).map((c) => c.und));
      expect(by.ETH.r).toBeGreaterThan(by.BTC.r);
      expect(by.BTC.r).toBeGreaterThanOrEqual(by.PUMP.r);
      for (const m of L.marks) {
        expect(m.x - m.r).toBeGreaterThanOrEqual(0);
        expect(m.x + m.r).toBeLessThanOrEqual(w);
        expect(m.y - m.r).toBeGreaterThanOrEqual(0);
        expect(m.y + m.r).toBeLessThanOrEqual(L.ph);
      }
      if (h >= 96) for (let i = 0; i < L.marks.length; i++) for (let j = i + 1; j < L.marks.length; j++) {
        const a = L.marks[i], b = L.marks[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${w}x${h} ${a.und}/${b.und}`).toBeGreaterThanOrEqual(a.r + b.r);
      }
      // Labels sit inside the field and never on a bubble or another label.
      const boxes = L.marks.filter((m) => m.label).map((m) => ({ l: m.label.x, r: m.label.x + m.label.w, t: m.label.y, b: m.label.y + 16 }));
      for (const b of boxes) {
        expect(b.l).toBeGreaterThanOrEqual(0); expect(b.r).toBeLessThanOrEqual(w);
        for (const m of L.marks) {
          const cx = Math.min(b.r, Math.max(b.l, m.x)), cy = Math.min(b.b, Math.max(b.t, m.y));
          expect(Math.hypot(cx - m.x, cy - m.y)).toBeGreaterThanOrEqual(m.r);
        }
        for (const o of boxes) if (o !== b) expect(b.r <= o.l || b.l >= o.r || b.b <= o.t || b.t >= o.b).toBe(true);
      }
    }
  });

  it("keeps two large coins with almost the same share apart on the home card's short bands", () => {
    const close = flowCoins({ BTC: { call: { buy_premium_usd: 52000 }, put: { buy_premium_usd: 48000 } },
      ETH: { call: { buy_premium_usd: 45900 }, put: { buy_premium_usd: 44100 } },
      HYPE: { call: { buy_premium_usd: 9000 }, put: { buy_premium_usd: 11000 } }, SOL: { call: { buy_premium_usd: 300 } } });
    for (const [w, h] of [[690, 64], [780, 97], [550, 80], [336, 99], [320, 124]]) {
      const L = bubbleLayout(close, { w, h, rMin: 10, rMax: 32 });
      for (let i = 0; i < L.marks.length; i++) for (let j = i + 1; j < L.marks.length; j++) {
        const a = L.marks[i], b = L.marks[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${w}x${h} ${a.und}/${b.und}`).toBeGreaterThanOrEqual(a.r + b.r);
      }
      for (const m of L.marks) { expect(m.y - m.r).toBeGreaterThanOrEqual(0); expect(m.y + m.r).toBeLessThanOrEqual(L.ph + 0.01); }
    }
    // Moved apart together (one above the line, one below) rather than shrunk to fit: at 780x97 they keep about 18px.
    expect(bubbleLayout(close, { w: 780, h: 97, rMin: 10, rMax: 32 }).marks[0].r).toBeGreaterThan(15);
  });

  it("keeps every trade wholly on its side of the line, even when repeats crowd together", () => {
    const from = 0, to = 86400, h = 172, mid = h / 2;
    const trades = [...Array.from({ length: 6 }, (_, i) => ({ key: `r${i}`, ts: 3600 + i * 120, money: 20000, side: "rise" })),
      ...Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, ts: 3600 + i * 120, money: 20000, side: "fall" }))];
    const marks = separate(dayLayout(trades, { w: 1300, h, from, to }), { top: 0, bottom: h, mid, margin: 2 });
    for (const m of marks) {
      if (m.side === "rise") expect(m.py + m.s / 2).toBeLessThanOrEqual(mid);
      else expect(m.py - m.s / 2).toBeGreaterThanOrEqual(mid);
      expect(m.py - m.s / 2).toBeGreaterThanOrEqual(0);
      expect(m.py + m.s / 2).toBeLessThanOrEqual(h);
    }
  });

  it("puts a coin's trades on its day: by time across, rise above the line and fall below", () => {
    const from = 1000, to = 1000 + 86400;
    const marks = dayLayout([{ key: "a", ts: from, money: 100, side: "rise" }, { key: "b", ts: to, money: 400, side: "fall" }], { w: 600, h: 150, from, to });
    expect(marks[0].px).toBeLessThan(marks[1].px);
    expect(marks[0].py).toBeLessThan(75);
    expect(marks[1].py).toBeGreaterThan(75);
    expect(marks[1].s).toBeGreaterThan(marks[0].s);
  });
});
