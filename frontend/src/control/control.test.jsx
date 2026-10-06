import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import vercel from "../../vercel.json";
import middleware, { allowed } from "../../middleware.js";
import btcQuestions from "../fixtures/questions/BTC.json";
import { CARDS, TAG, herdModel, ladderModel, rangeModel } from "./cards.jsx";
import { todaysCard } from "./ControlPage.jsx";

const basic = (user, pass) => "Basic " + btoa(`${user}:${pass}`);
const FORECAST = /\b(will|expect|likely|predict|target|probability|odds)\b/i;

describe("control gate", () => {
  it("lets in only the right password and stays shut without one", () => {
    expect(allowed(basic("any", "s3cret"), "s3cret")).toBe(true);
    expect(allowed(basic("any", "s3cre"), "s3cret")).toBe(false);
    expect(allowed(basic("any", "s3cret"), undefined)).toBe(false);
    expect(allowed(basic("any", ""), "")).toBe(false);
    expect(allowed("Bearer x", "s3cret")).toBe(false);
    expect(allowed("Basic !!!", "s3cret")).toBe(false);
    expect(allowed(basic("a", "x:y"), "x:y")).toBe(true);
  });

  it("answers 401 with a login prompt", () => {
    const res = middleware(new Request("https://cowboy.trading/control"));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Basic/);
  });

  it("routes /control to its own page, never the app", () => {
    const config = vercel;
    expect(config.rewrites[0]).toEqual({ source: "/control", destination: "/control.html" });
    const spa = new RegExp("^" + config.rewrites.at(-1).source.replace("(.*)", ".*") + "$");
    expect(spa.test("/control")).toBe(false);
    expect(spa.test("/saloon")).toBe(true);
  });
});

const day = 86400;
const now = 1791286200; // Tue 6 Oct 2026, 11:30 UTC
const fri = 1791532800; // Fri 9 Oct 2026, 08:00 UTC
const coin = {
  candles: { "1d": Array.from({ length: 40 }, (_, i) => [now - (40 - i) * day, 0, 0, 0, 80000 + i * 150]) },
  options: {
    ts: now,
    features: { index_price: 86215, atm_iv_30d: 0.42, rr25_30d: -0.03 },
    levels: { call_wall: 88000 },
    implied: [
      { expiry: fri - 2 * day, days: 0.8, q: [85000, 85600, 86200, 86800, 87400] },
      { expiry: fri, days: 2.8, q: [83912, 84994, 86213, 87450, 88578] },
      { expiry: fri + 7 * day, days: 9.8, q: [81000, 83500, 86200, 89000, 91500] },
    ],
  },
};
const markets = {
  generated_at: now,
  coins: ["BTC", "ETH", "SOL", "XRP", "ADA"].map((und, i) => ({
    und, has_options: true, chg_7d: i - 1, regime_1d: i < 3 ? "MARKUP" : "REACC",
    align: { readings: { "30d": { engine: { state: "up" }, wallets: { state: i === 2 ? "up" : "neutral" }, options: { state: "up" } } } },
  })),
};

describe("cards", () => {
  it("prices the Friday range from the first Friday expiry", () => {
    const m = rangeModel(coin, "BTC");
    expect(m.head.expiry).toBe(fri);
    expect(m.cone).toHaveLength(3);
    expect(Math.round(m.swing)).toBe(12);
  });

  it("counts the herd and names the coins where all three point up", () => {
    const m = herdModel(markets);
    expect(m.up).toBe(3);
    expect(m.both).toEqual(["SOL"]);
    expect(m.rows[0].und).toBe("SOL");
  });

  it("builds a Friday ladder straddling the index", () => {
    const m = ladderModel(btcQuestions);
    expect(m).not.toBeNull();
    expect(new Date(m.settle * 1000).getUTCDay()).toBe(5);
    expect(m.levels.some((l) => l.k < m.idx) && m.levels.some((l) => l.k >= m.idx)).toBe(true);
  });

  it("drafts posts that tag Derive, stay short and carry no links or forecast words", () => {
    const models = { range: rangeModel(coin), herd: herdModel(markets), ladder: ladderModel(btcQuestions) };
    for (const card of CARDS) {
      const m = models[card.id];
      if (!m) continue;
      const text = card.text(m);
      expect(text).toContain(TAG);
      expect(text.length).toBeLessThanOrEqual(280);
      expect(text).not.toMatch(/https?:|www\.|0x[0-9a-f]/i);
      expect(text).not.toMatch(FORECAST);
      render(<card.Card m={m} />);
    }
    expect(screen.getAllByText("cowboy.trading").length).toBeGreaterThan(0);
  });

  it("turns over one card a day", () => {
    const ids = ["a", "b", "c"];
    const d = new Date(Date.UTC(2026, 9, 6, 12));
    expect(todaysCard(ids, new Date(d.getTime() + 86400000))).not.toBe(todaysCard(ids, d));
  });
});
