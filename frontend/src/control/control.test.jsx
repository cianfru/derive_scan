import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import vercel from "../../vercel.json";
import middleware, { allowed } from "../../middleware.js";
import btcSnapshot from "../fixtures/questions/BTC.json";
import { ORIGINAL, herdModel, ladderModel, rangeModel } from "./cards.jsx";
import { checkText, todaysCard, todaysPicks } from "./ControlPage.jsx";
import { CATALOGUE, ENTRIES, GROUPS, buildModel } from "./index.js";
import { TAG } from "./kit.jsx";
import { fundingModel, moodModel, moversModel } from "./cards/market.jsx";
import { cohortModel, plainTrade, smartModel } from "./cards/traders.jsx";
import { settledModel } from "./cards/saloon.jsx";

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
const btcQuestions = { ...btcSnapshot, prices_ts: now };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now * 1000); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const fri = 1791532800; // Fri 9 Oct 2026, 08:00 UTC
const coin = {
  generated_at: now,
  candles: { "1d": Array.from({ length: 40 }, (_, i) => [now - (40 - i) * day, 0, 0, 0, 80000 + i * 150]) },
  options: {
    status: "ready",
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
  context: { sentiment: { fear_greed_value: 73, fear_greed_label: "Greed" }, sentiment_at: now, stablecoin: { change_7d_pct: -0.1, total_cap: 2.58e11 }, global_metrics: { btc_dominance: 59.3 } },
  consensus_detail: { "1d": { counts: { markup: 12, total: 15 } } },
  coins: ["BTC", "ETH", "SOL", "XRP", "ADA", "HYPE"].map((und, i) => ({
    und, has_options: true, chg_7d: i * 3 - 6, regime_1d: i < 3 ? "MARKUP" : "REACC", funding_ann: 0.1095,
    align: { readings: { "30d": { engine: { state: "up", status: "ready", observed_at: now, timeframe: "1d" },
      wallets: { state: i === 2 ? "up" : "neutral", status: "ready", valuation_at: now },
      options: { state: "up", status: "ready", observed_at: now } } } },
  })),
};
const trade = (instrument, direction, premium) => ({ kind: "option", instrument, direction, premium_usd: premium, notional_usd: premium * 20, wallet: "0x15eECd2e60E8Adb788826E71ef46d6921524E041" });

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

  it("sits a card out when the data has nothing to say", () => {
    expect(fundingModel(markets)).toBeNull();
    expect(moodModel({ context: {} })).toBeNull();
    expect(smartModel({ coins: {} })).toBeNull();
  });

  it("says in plain words what each kind of options trade does", () => {
    expect(plainTrade(trade("BTC-20261030-88000-C", "buy", 2230))).toBe("paid $2K to bet on BTC above $88,000 on 30 Oct");
    expect(plainTrade(trade("BTC-20261030-80000-P", "buy", 1000))).toMatch(/^paid \$1K for protection if BTC ends below \$80,000/);
    expect(plainTrade(trade("ETH-20270326-5500-C", "sell", 39000))).toMatch(/^collected \$39K to give up ETH's gains above \$5,500/);
    expect(plainTrade(trade("XRP-20261030-1_35-P", "sell", 500))).toMatch(/at \$1.35 if it ends below/);
  });

  it("splits the winners from the losers by what they hold", () => {
    const w = { generated_at: now, cohorts: { pnl: [
      { name: "Money Printer", wallets: 3, "7d": { net_delta_usd: 575000, positions: 47 } },
      { name: "Grinder", wallets: 132, "7d": { net_delta_usd: 20000, positions: 18 } },
      { name: "Full Rekt", wallets: 37, "7d": { net_delta_usd: -47.7e6, positions: 10 } },
    ] } };
    const m = cohortModel(w, "BTC");
    expect(m.win).toBeGreaterThan(0);
    expect(m.lose).toBeLessThan(0);
    expect(m.biggest.name).toBe("Busted"); // shown under its Western name
  });

  it("reads the last settlement around its price", () => {
    const m = settledModel({ settled: [{ settle_ts: now, label: "Tue 6 Oct", settle_price: 2704, zone: 200, levels: Array.from({ length: 20 }, (_, i) => ({ id: `L${i}`, k: 2500 + i * 50, lo: 2400 + i * 50, hi: 2600 + i * 50, paid: Math.min(1, Math.max(0, (2704 - (2400 + i * 50)) / 200)) })) }] }, "ETH");
    expect(m.levels).toHaveLength(7);
    expect(m.levels.some((l) => l.paid > 0 && l.paid < 1)).toBe(true);
  });

  it("drafts posts that tag Derive, stay short and carry no links or forecast words", () => {
    const drafts = [
      ...ORIGINAL[0].angles(herdModel(markets)), ...ORIGINAL[1].angles(rangeModel(coin, "BTC")), ...ORIGINAL[2].angles(ladderModel(btcQuestions)),
      ...CATALOGUE.find((c) => c.id === "mood").angles(moodModel(markets)),
      ...CATALOGUE.find((c) => c.id === "movers").angles(moversModel(markets)),
    ];
    expect(drafts.length).toBeGreaterThan(10);
    for (const text of drafts) {
      expect(checkText(text)).toEqual([]);
      expect(text).not.toMatch(FORECAST);
    }
    render(<>{ORIGINAL.map((c) => <c.View key={c.id} m={c.id === "herd" ? herdModel(markets) : c.id === "range" ? rangeModel(coin, "BTC") : ladderModel(btcQuestions)} />)}</>);
    expect(screen.getAllByText("cowboy.trading").length).toBe(3);
  });

  it("loads a card's second file only when the first asks for it", async () => {
    const card = { files: () => ["a.json"], model: ([a]) => ({ need: [`b-${a.x}.json`], then: ([b]) => ({ x: a.x, y: b.y }) }) };
    const seen = [];
    const m = await buildModel(card, null, async (p) => { seen.push(p); return p === "a.json" ? { x: 1 } : { y: 2 }; });
    expect(m).toEqual({ x: 1, y: 2 });
    expect(seen).toEqual(["a.json", "b-1.json"]);
  });

  it("offers over twenty cards across every group, each with at least two angles", () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CATALOGUE.map((c) => c.id)).size).toBe(CATALOGUE.length);
    for (const g of GROUPS) expect(CATALOGUE.some((c) => c.group === g)).toBe(true);
    expect(ENTRIES.length).toBeGreaterThan(CATALOGUE.length);
  });

  it("turns over the cards and picks across groups each day", () => {
    const d = new Date(Date.UTC(2026, 9, 6, 12));
    const ids = ["a", "b", "c"];
    expect(todaysCard(ids, new Date(d.getTime() + 86400000))).not.toBe(todaysCard(ids, d));
    const picks = todaysPicks(ENTRIES, d);
    expect(picks).toHaveLength(4);
    expect(new Set(picks.map((p) => p.card.group)).size).toBe(4);
    expect(todaysPicks(ENTRIES, new Date(d.getTime() + 86400000)).map((p) => p.key)).not.toEqual(picks.map((p) => p.key));
  });
});
