import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import vercel from "../../vercel.json";
import middleware, { allowed } from "../../middleware.js";
import btcQuestions from "../fixtures/questions/BTC.json";
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
const fri = 1791532800; // Fri 9 Oct 2026, 08:00 UTC
const coin = {
  candles: { "1d": Array.from({ length: 40 }, (_, i) => [now - (40 - i) * day, 0, 0, 0, 80000 + i * 150]) },
  options: {
    status: "ready",
    chain_status: "ready",
    chain_at: now,
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
    engine_comparison: { "1d": { status: "ready", observed_at: now, timeframe: "1d" } },
    align: { version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: { "30d": {
      engine: { state: "up", status: "ready", observed_at: now, timeframe: "1d" },
      wallets: { state: i === 2 ? "up" : "neutral", status: "ready", valuation_at: now },
      options: { state: "up", status: "ready", observed_at: now },
    } } },
  })),
};
const trade = (instrument, direction, premium) => ({ kind: "option", instrument, direction, premium_usd: premium, notional_usd: premium * 20, wallet: "0x15eECd2e60E8Adb788826E71ef46d6921524E041" });

describe("cards", () => {
  it("prices the Friday range from the first Friday expiry", () => {
    const m = rangeModel(coin, "BTC", now);
    expect(m.head.expiry).toBe(fri);
    expect(m.cone).toHaveLength(3);
    expect(Math.round(m.swing)).toBe(12);
    expect(m.past.n).toBe(3);
    expect(ORIGINAL.find((c) => c.id === "range").angles(m)[0]).toContain("daily closes and today's index");
  });

  it("counts the herd and names the coins where all three point up", () => {
    const m = herdModel(markets, now);
    expect(m.up).toBe(3);
    expect(m.both).toEqual(["SOL"]);
    expect(m.rows[0].und).toBe("SOL");
  });

  it("builds a Friday ladder straddling the index", () => {
    const m = ladderModel(btcQuestions, btcQuestions.prices_ts);
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
    expect(m.biggest.name).toBe("Full Rekt");
  });

  it("reads the last settlement around its price", () => {
    const m = settledModel({ settled: [{ settle_ts: now, label: "Tue 6 Oct", settle_price: 2704, zone: 200, levels: Array.from({ length: 20 }, (_, i) => ({ id: `L${i}`, k: 2500 + i * 50, lo: 2400 + i * 50, hi: 2600 + i * 50, paid: Math.min(1, Math.max(0, (2704 - (2400 + i * 50)) / 200)) })) }] }, "ETH");
    expect(m.levels).toHaveLength(7);
    expect(m.levels.some((l) => l.paid > 0 && l.paid < 1)).toBe(true);
  });

  it("drafts posts that tag Derive, stay short and carry no links or forecast words", () => {
    const drafts = [
      ...ORIGINAL[0].angles(herdModel(markets, now)), ...ORIGINAL[1].angles(rangeModel(coin, "BTC", now)), ...ORIGINAL[2].angles(ladderModel(btcQuestions, btcQuestions.prices_ts)),
      ...CATALOGUE.find((c) => c.id === "mood").angles(moodModel(markets)),
      ...CATALOGUE.find((c) => c.id === "movers").angles(moversModel(markets)),
    ];
    expect(drafts.length).toBeGreaterThan(10);
    for (const text of drafts) {
      expect(checkText(text)).toEqual([]);
      expect(text).not.toMatch(FORECAST);
    }
    render(<>{ORIGINAL.map((c) => <c.View key={c.id} m={c.id === "herd" ? herdModel(markets, now) : c.id === "range" ? rangeModel(coin, "BTC", now) : ladderModel(btcQuestions, btcQuestions.prices_ts)} />)}</>);
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

  it("withholds stale, future and unavailable range snapshots", () => {
    expect(rangeModel(coin, "BTC", now + 30 * 60 + 1)).toBeNull();
    expect(rangeModel(coin, "BTC", now - 1)).toBeNull();
    const missing = structuredClone(coin);
    missing.options.status = "unavailable";
    expect(rangeModel(missing, "BTC", now)).toBeNull();
    missing.options.status = "ready";
    missing.options.features.rr25_30d = null;
    expect(rangeModel(missing, "BTC", now)).toBeNull();
  });

  it("withholds a range rebuilt from a stale strike snapshot even when its features are current", () => {
    const c = structuredClone(coin);
    c.options.chain_at = now - 1801;
    expect(rangeModel(c, "BTC", now)).toBeNull();
    c.options.chain_at = now;
    c.options.chain_status = "stale";
    expect(rangeModel(c, "BTC", now)).toBeNull();
  });

  it("ignores expired Friday ranges and rejects malformed priced bands", () => {
    const c = structuredClone(coin);
    c.options.implied.unshift({ ...c.options.implied[1], expiry: fri - 7 * day });
    expect(rangeModel(c, "BTC", now).head.expiry).toBe(fri);
    for (const e of c.options.implied) e.q = [80000, 82000, null, 87000, 89000];
    expect(rangeModel(c, "BTC", now)).toBeNull();
  });

  it("holds back stale herd files and counts only current daily regimes", () => {
    expect(herdModel(markets, now + 35 * 60 + 1)).toBeNull();
    expect(herdModel(markets, now - 1)).toBeNull();
    const m = structuredClone(markets);
    m.coins[2].engine_comparison["1d"].observed_at = now - day - 1201;
    const model = herdModel(m, now);
    expect(model.up).toBe(2);
    expect(model.total).toBe(5);
    expect(model.missing).toBe(1);
    expect(model.both).toEqual([]);
    expect(model.rows.find((r) => r.und === "SOL").regime).toBeNull();
    const card = ORIGINAL.find((c) => c.id === "herd");
    expect(card.angles(model)[0]).toContain("current daily readings");
  });

  it.each(["stale", "unavailable", "coverage"])("does not claim all three agree when wallet context is %s", (state) => {
    const m = structuredClone(markets);
    const a = m.coins[2].align;
    if (state === "stale") a.readings["30d"].wallets.valuation_at = now - 1801;
    else if (state === "coverage") a.wallet_coverage.ready = false;
    else a.readings["30d"].wallets.status = "insufficient_data";
    const model = herdModel(m, now);
    expect(model.both).toEqual([]);
    expect(model.rows.find((r) => r.und === "SOL").wallets).toBeNull();
  });

  it("keeps a current skew-only options reading, but not a stale one", () => {
    const m = structuredClone(markets);
    const o = m.coins[2].align.readings["30d"].options;
    o.status = "skew_only";
    expect(herdModel(m, now).both).toEqual(["SOL"]);
    o.observed_at = now - 1801;
    expect(herdModel(m, now).both).toEqual([]);
  });

  it("does not invent a zero weekly price change when it is absent", () => {
    const m = structuredClone(markets);
    m.coins[2].chg_7d = null;
    const model = herdModel(m, now);
    expect(model.rows.find((r) => r.und === "SOL").chg).toBeNull();
    const card = ORIGINAL.find((c) => c.id === "herd");
    const { container } = render(<card.View m={model} />);
    expect(container.querySelector(".tile.all .chg").textContent).toBe("—7d");
  });

  it("omits the hottest-week angle when no weekly change was measured", () => {
    const m = structuredClone(markets);
    m.coins.forEach((c) => { c.chg_7d = null; });
    const model = herdModel(m, now);
    expect(model.hot).toBeNull();
    const card = ORIGINAL.find((c) => c.id === "herd");
    expect(card.angles(model)).toHaveLength(2);
    expect(card.angles(model).join(" ")).not.toContain("Hottest week");
  });

  it("compares month-ago regimes over the same coin set and leaves missing history unknown", () => {
    const m = structuredClone(markets);
    m.breadth_1d = { cols: ["MARKUP"], members: Array.from({ length: 31 }, () => [["BTC", "ETH", "SOL", "XRP", "ADA", "HYPE"]]) };
    m.coins[2].engine_comparison["1d"].observed_at = now - day - 1201;
    const model = herdModel(m, now);
    expect(model.total).toBe(5);
    expect(model.ago).toBe(5);
    m.breadth_1d.members[0] = [null];
    expect(herdModel(m, now).ago).toBeNull();
  });

  it("does not describe unanimous defensive readings as disagreement or invent rarity", () => {
    const m = structuredClone(markets);
    for (const c of m.coins) for (const r of Object.values(c.align.readings["30d"])) r.state = "defensive";
    const model = herdModel(m, now);
    const angles = ORIGINAL.find((c) => c.id === "herd").angles(model);
    expect(model.both).toEqual([]);
    expect(angles[1]).toContain("No coin has a current upward reading in all three layers");
    expect(angles.join(" ")).not.toMatch(/disagree on every coin|doesn't happen often/);
  });

  it("withholds paused, stale and future ladder snapshots", () => {
    const ts = btcQuestions.prices_ts;
    expect(ladderModel({ ...btcQuestions, paused: true }, ts)).toBeNull();
    expect(ladderModel(btcQuestions, ts + 35 * 60 + 1)).toBeNull();
    expect(ladderModel(btcQuestions, ts - 1)).toBeNull();
  });

  it.each(["expired", "settling", "off-board", "retired", "screen-wide", "tail", "no-quote", "no-size"])("never advertises a %s Friday ladder", (state) => {
    const q = structuredClone(btcQuestions);
    q.dates = q.dates.filter((d) => new Date(d.settle_ts * 1000).getUTCDay() === 5).slice(0, 1);
    const d = q.dates[0];
    const clock = state === "expired" ? d.settle_ts : state === "settling" ? d.settle_ts - 900 : q.prices_ts;
    q.prices_ts = clock;
    if (state === "off-board") d.board = false;
    for (const l of d.levels) {
      if (state === "retired") l.state = "retired";
      else if (state === "screen-wide") l.yes.state = "screen_wide";
      else if (state === "tail") l.yes.state = "tail";
      else if (state === "no-quote") l.yes.state = "no_quote";
      else if (state === "no-size") l.yes.size = 0;
    }
    expect(ladderModel(q, clock)).toBeNull();
  });

  it("rounds ladder buy prices upward like the Saloon instead of advertising a better price", () => {
    const q = structuredClone(btcQuestions);
    const friday = q.dates.find((d) => d.expiry === "20261009");
    friday.levels.find((l) => l.k === 85000).yes.buy = 0.5001;
    const model = ladderModel(q, q.prices_ts);
    const card = ORIGINAL.find((c) => c.id === "ladder");
    expect(card.angles(model)[0]).toContain("costs 51¢ today");
  });
});
