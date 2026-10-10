import { test, expect } from "@playwright/test";
import { mockPublicData } from "./fixtures.js";

// Owner's rules (8 October 2026, after they slipped): the landing's first screen shows the hero alone,
// board tiles never overflow, and the landing example reads in percentages like the Saloon.

test("the landing's first screen shows the hero alone", async ({ page }) => {
  for (const height of [664, 844]) {
    await page.setViewportSize({ width: page.viewportSize().width, height });
    await page.goto("/");
    const r = await page.evaluate(() => {
      const stage = document.querySelector(".hero-stage");
      return { next: stage.nextElementSibling.getBoundingClientRect().top, vh: innerHeight };
    });
    expect(r.next).toBeGreaterThanOrEqual(r.vh - 1);
  }
});

test("the landing example shows returns as percentages", async ({ page }) => {
  await page.goto("/");
  const labels = await page.locator(".sd-bubble b").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) expect(l).toMatch(/^\+\d+%$/);
});

test("board tiles keep their figures inside", async ({ page }) => {
  await mockPublicData(page);
  await page.goto("/saloon?view=list");
  await expect(page.locator(".bd-choice").first()).toBeVisible();
  const spill = await page.evaluate(() => [...document.querySelectorAll(".bd-choice")].filter((t) => {
    const box = t.getBoundingClientRect();
    return [...t.querySelectorAll("*")].some((c) => c.getBoundingClientRect().right > box.right + 1);
  }).length);
  expect(spill).toBe(0);
});

// The card home (owner, 10 October 2026: the widgets clipped and overlapped on smaller screens): from 901px
// wide the grid fits the first screen above the footer, nothing leaves its card, no figure runs under a +
// (an open position's P&L included), no caption, group name or axis row is cut, a long codename never runs
// under its P&L, phones never scroll sideways and the tablet grid leaves no empty cell.
const T = 1791036600;
const homeDocs = () => {
  const align = (wallets, score) => ({ version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: { "30d": {
    engine: { status: "ready", state: "up", signal: "WAIT", timeframe: "1d", observed_at: T - 3600 },
    wallets: wallets ? { status: "ready", state: wallets, score, gross_delta_usd: 1e6, gross_complete: true, estimated_positions: 0,
      missing_positions: 0, positions: 3, valuation_at: T - 60 } : { status: "insufficient_exposure" } } } });
  const coin = (und, regime, z, wallets, score, oi) => ({ und, has_options: true, regime_1d: regime, z_1d: z, oi_usd: oi,
    engine_comparison: { "1d": { status: "ready", timeframe: "1d", observed_at: T - 3600 } }, align: align(wallets, score) });
  const PNL = ["Money Printer", "Smart Money", "Grinder", "Humble Earner", "Exit Liquidity", "Semi-Rekt", "Full Rekt", "Giga-Rekt"];
  const large = Array.from({ length: 40 }, (_, i) => ({ ts: (T - 86000 + i * 2100) * 1000, kind: "option", direction: i % 3 ? "buy" : "sell",
    instrument: `${i % 2 ? "ETH" : "BTC"}-20261030-${i % 2 ? 3000 + i * 10 : 80000 + i * 500}-${i % 4 < 2 ? "C" : "P"}`, premium_usd: 1000 + ((i * 7919) % 40000) }));
  return {
    "markets.json": { generated_at: T, bars: { "1d": T - 3600 }, context: {}, consensus: {}, coins: [
      coin("BTC", "MARKUP", 0.8, "up", 0.3, 9e6), coin("ETH", "MARKUP", 0.5, "up", 0.45, 8e6), coin("HYPE", "REACC", -1.7, "up", 0.3, 7e6),
      coin("SOL", "MARKUP", 0.6, "defensive", -0.9, 6e6), coin("XRP", "MARKUP", 0.75, "defensive", -0.5, 5e5), coin("XAUT", "MARKUP", 1.3, "up", 0.95, 4e5),
      coin("ZEC", "MARKUP", 0.7, "neutral", -0.2, 3e5), coin("LIT", "REACC", -0.2, "neutral", 0, 2e5), coin("PUMP", "MARKUP", 0.9, "up", 0.99, 1e5),
      coin("ADA", "MARKUP", 1.2, null, null, 3e4), coin("CC", "MARKUP", 0.2, null, null, 2e4), coin("VVV", "REACC", -0.9, null, null, 1e4)] },
    // The longest codenames run to 20 characters ("Wandering Woodpecker").
    "traders.json": { traders: [["0x" + "a".repeat(40), 1, 10051791], [`0x${"0".repeat(36)}6c78`, 4, -1234567], ["0x" + "f".repeat(40), 7, 495024]]
      .map(([address, rank, pnl]) => ({ address, rank, tier: "top", class: "directional", option_pnl: pnl })),
      cohorts: { pnl: [3, 33, 132, 2353, 6750, 295, 34, 2].map((wallets, i) => ({ name: PNL[i], wallets })) } },
    "flow.json": { generated_at: T, since: T - 86400, coverage: { ready: true, end: T }, classes_ready: true, large,
      by_coin: { BTC: { call: { buy_premium_usd: 90000 }, put: { buy_premium_usd: 60000 } }, ETH: { call: { buy_premium_usd: 17000 }, put: { buy_premium_usd: 87000 } } } },
  };
};

test("the card home fits the first screen and keeps every card's contents inside", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run covers every viewport");
  // 22 page loads (11 sizes in two themes): about 25 s locally, longer on CI's runners than the 30 s default.
  test.setTimeout(120_000);
  await mockPublicData(page);
  const extra = homeDocs();
  await page.route("**/site-data/**", (route) => {
    const path = new URL(route.request().url()).pathname.split("/site-data/")[1];
    return path in extra ? route.fulfill({ json: extra[path] }) : route.fallback();
  });
  // Measured at rest: the once-per-tab rise is played already. One open position, priced from the BTC board.
  await page.addInitScript(() => {
    sessionStorage.setItem("cowboy-home-entered", "1");
    localStorage.setItem("cowboy-questions", JSON.stringify([{ key: "e2e", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000,
      contracts: 0.04407, paid: 103.01, legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both", settle_ts: 1791532800 }]));
  });
  for (const theme of ["dark", "light"]) {
    for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [901, 700], [960, 700], [820, 1180], [601, 900], [390, 844], [320, 640]]) {
      await page.setViewportSize({ width, height });
      await page.addInitScript((t) => localStorage.setItem("cowboy-theme", t), theme);
      await page.goto("/home");
      await expect(page.locator(".hl-posses .bn")).toBeVisible();
      await expect(page.locator(".hl-radar .hl-pt").first()).toBeVisible();
      await expect(page.locator(".hl-pos .bn")).toBeVisible();
      const r = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const cards = [...document.querySelectorAll(".home-card")];
        const outside = cards.flatMap((card) => {
          const c = box(card);
          return [...card.querySelectorAll("*")].filter((el) => !el.closest(".sr-only")).map((el) => [el, box(el)])
            .filter(([, e]) => e.width && e.height && (e.left < c.left - 1 || e.right > c.right + 1 || e.top < c.top - 1 || e.bottom > c.bottom + 1))
            .map(([el]) => `${card.querySelector(".home-label").textContent}: ${el.className.baseVal ?? el.className}`);
        });
        const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
        const underPlus = cards.flatMap((card) => {
          const plus = box(card.querySelector(".home-plus"));
          return [...card.querySelectorAll(".hl, .home-line, .home-card h2:not(.sr-only)")].filter((el) => hit(box(el), plus)).map((el) => el.className);
        });
        const tops = cards.slice(-2).map((c) => Math.round(box(c).top));
        // Nothing that carries a reading is cut: no clamped caption, no ellipsis on a group name or axis word.
        const cut = [...document.querySelectorAll(".home-card :is(.hl-cap, .hl-cap > span, .hl-grp-name, .home-line, .hl-xw > span, .hl-ends, .hl-sub)")]
          .filter((el) => el.getClientRects().length && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1))
          .map((el) => `${el.className}: ${el.textContent}`);
        // A codename may end in an ellipsis (its full name is in its title), never under the P&L beside it.
        const rows = [...document.querySelectorAll(".home-card .hl-row")].filter((r) => {
          const name = r.querySelector(".hl-name"), pnl = r.querySelector(".n:last-child");
          return box(name).right > box(pnl).left - 4 || box(pnl).right > box(r).right + 1;
        }).map((r) => r.textContent);
        return { outside, underPlus, cut, rows, last: Math.max(...cards.map((c) => box(c).bottom)), foot: box(document.querySelector(".foot")).top,
          vh: innerHeight, scrollX: document.documentElement.scrollWidth > innerWidth, tops };
      });
      const at = `${width}x${height} ${theme}`;
      expect(r.outside, at).toEqual([]);
      expect(r.underPlus, at).toEqual([]);
      expect(r.cut, at).toEqual([]);
      expect(r.rows, at).toEqual([]);
      expect(r.scrollX, at).toBe(false);
      if (width >= 901) {
        expect(r.last, at).toBeLessThanOrEqual(r.vh);
        expect(r.last, at).toBeLessThan(r.foot);
      }
      if (width === 820) expect(r.tops[0], at).toBe(r.tops[1]);
    }
  }
});
