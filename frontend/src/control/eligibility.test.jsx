import { afterEach, beforeEach, expect, it, vi } from "vitest";
import btc from "../fixtures/questions/BTC.json";
import { ORIGINAL, herdModel, ladderModel, rangeModel } from "./cards.jsx";
import { buildModel, CATALOGUE } from "./index.js";
import { eligibleQuotes } from "./eligibility.js";

const now = btc.prices_ts + 600;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now * 1000); });
afterEach(() => vi.useRealTimers());
const markets = () => ({ generated_at: now, coins: ["BTC", "ETH", "HYPE", "SOL"].map((und) => ({ und, has_options: true, regime_1d: "MARKUP",
  align: { readings: { "30d": { engine: { state: "up", status: "ready", observed_at: now, timeframe: "1d" },
    wallets: { state: "up", status: "ready", valuation_at: now }, options: { state: "up", status: "ready", observed_at: now } } } } })) });

it("withholds stale, paused, retired, settling, credit and over99c exported prices", () => {
  expect(ladderModel({ ...btc, prices_ts: now - 36 * 60 })).toBeNull();
  expect(ladderModel({ ...btc, paused: true })).toBeNull();
  const q = structuredClone(btc), levels = q.dates.find((d) => d.board).levels.filter((l) => l.state === "open");
  levels[0].state = "retired"; levels[1].yes.form = "credit"; levels[2].yes.buy = 0.995;
  levels[3].state = "settling";
  const filtered = eligibleQuotes(q).dates.flatMap((d) => d.levels);
  expect(filtered.find((l) => l.id === levels[0].id).yes.buy).toBeNull();
  expect(filtered.find((l) => l.id === levels[1].id).yes.buy).toBeNull();
  expect(filtered.find((l) => l.id === levels[2].id).yes.buy).toBeNull();
  expect(filtered.find((l) => l.id === levels[3].id).yes.buy).toBeNull();
});

it("requires current reading coverage and leaves unknown weekly changes unknown", () => {
  const m = markets(); m.coins[0].align.readings["30d"].wallets.status = "backfilling";
  m.coins[1].align.readings["30d"].options.observed_at = now - 3600;
  const model = herdModel(m);
  expect(model.both).toEqual(["HYPE", "SOL"]);
  expect(model.rows.find((r) => r.und === "BTC").wallets).toBeNull();
  expect(model.rows.every((r) => r.chg === null)).toBe(true);
  expect(model.hot).toBeNull();
  expect(ORIGINAL[0].angles(model).join(" ")).not.toMatch(/hottest|doesn't happen often|disagree on every/);
  expect(herdModel({ ...m, generated_at: now - 3600 })).toBeNull();
});

it("does not equate missing upward agreement with disagreement", () => {
  const m = markets(); for (const c of m.coins) for (const r of Object.values(c.align.readings["30d"])) r.state = "neutral";
  expect(ORIGINAL[0].angles(herdModel(m)).join(" ")).not.toMatch(/disagree|rare|often/);
});

it("shares eligibility and provenance across catalogue builds", async () => {
  const herd = CATALOGUE.find((c) => c.id === "herd");
  const fresh = await buildModel(herd, null, async () => ({ ...markets(), publication_revision: "one" }));
  expect(fresh.provenance).toMatchObject({ revision: "one", sources: [{ path: "markets.json", observedAt: now }] });
  expect(fresh.provenance.eligible()).toBe(true);
  vi.setSystemTime((now + 31 * 60) * 1000);
  expect(fresh.provenance.eligible()).toBe(false);
  vi.setSystemTime(now * 1000);
  const movers = CATALOGUE.find((c) => c.id === "movers");
  expect(await buildModel(movers, null, async () => ({ ...markets(), generated_at: now - 3600 }))).toBeNull();
  const spotlight = CATALOGUE.find((c) => c.id === "spotlight");
  await expect(buildModel(spotlight, "BTC", async (p) => ({ generated_at: now, publication_revision: p === "markets.json" ? "one" : "two" }))).rejects.toThrow(/different publications/);
});

it("rechecks second-file freshness at export without mutating shared dependency arrays", async () => {
  const primary = Object.freeze(["markets.json"]), secondary = Object.freeze(["flow.json"]);
  const card = { ...CATALOGUE.find((c) => c.id === "movers"), files: () => primary,
    model: ([m]) => ({ need: secondary, then: ([f]) => ({ ts: m.generated_at, value: f.value }) }) };
  const m = await buildModel(card, null, async (path) => ({ generated_at: path === "flow.json" ? now - 20 * 60 : now, value: 1 }));
  expect(primary).toEqual(["markets.json"]);
  expect(secondary).toEqual(["flow.json"]);
  expect(m.provenance.eligible()).toBe(true);
  vi.setSystemTime((now + 16 * 60) * 1000);
  expect(m.provenance.eligible()).toBe(false);
});

it("keeps recorded history eligible for a current price-movement card", async () => {
  const q = eligibleQuotes(btc);
  const rows = Object.fromEntries(q.dates.flatMap((d) => d.levels).map((l) => [l.id,
    { i: [0, 1, 2, 3, 4, 5], yb: [0.3, 0.32, 0.35, 0.4, 0.42, 0.45], nb: [0.7, 0.68, 0.65, 0.6, 0.58, 0.55] }]));
  const history = { generated_at: now - 86400, ts: Array.from({ length: 6 }, (_, i) => now - 86400 + i * 3600), index: Array(6).fill(btc.index), rows };
  const m = await buildModel(CATALOGUE.find((c) => c.id === "moves"), "BTC", async (path) => path.startsWith("questions/history/") ? history : btc);
  expect(m).not.toBeNull();
  expect(m.provenance.eligible()).toBe(true);
  vi.setSystemTime((now + 10 * 60) * 1000);
  expect(m.provenance.eligible()).toBe(true);
});

it("rejects unavailable ranges and removes unsupported future comparisons", () => {
  expect(rangeModel({ options: { status: "stale", ts: now }, candles: { "1d": [[now, 1, 1, 1, 1]] } })).toBeNull();
  const friday = Date.UTC(2026, 9, 9, 8) / 1000;
  const coin = { options: { status: "ready", ts: now, features: { index_price: 85000, atm_iv_30d: 0.4, rr25_30d: 0 },
    implied: [{ expiry: friday, days: 6, q: [80000, 82000, 85000, 88000, 90000] }] }, candles: { "1d": Array.from({ length: 10 }, (_, i) => [now - (10 - i) * 86400, 1, 1, 1, 83000 + i * 100]) } };
  const model = rangeModel(coin);
  const text = ORIGINAL[1].angles(model).join(" ");
  expect(text).not.toMatch(/calmer|busier|rises cost more|drops cost more/);
  expect(text).toContain("balanced");
});
