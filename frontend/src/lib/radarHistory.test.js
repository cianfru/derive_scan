import { describe, it, expect } from "vitest";
import { radarFrames, frameAt, trailAt, closeLabel, decodeFlags, engineAt, nearest, TRAIL, REPLAY } from "./radarHistory.js";
import { radarPoint } from "./presentation.js";

const DAY = 86400;
const LAST = 1790985600; // 3 Oct 2026 00:00 UTC: the 2 Oct bar's close
const closes = Array.from({ length: 30 }, (_, i) => LAST - (29 - i) * DAY);
const now = LAST + 13 * 3600;

function liveCoin(und, z, score, gross, at = now) {
  return { und, z_1d: z, align: { version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: {
    "30d": { engine: { status: "ready", state: "up", signal: "LIGHT_LONG", timeframe: "1d", observed_at: at - 3600 },
      wallets: { status: "ready", state: "up", valuation_at: at - 300, score, gross_delta_usd: gross, gross_complete: true, positions: 9, estimated_positions: 0, missing_positions: 0 } },
    "7d": {} } } };
}
function hist(coins, extra = {}) {
  return { version: 1, generated_at: now, through: "2026-10-02", cohort: "smart", closes, coins, ...extra };
}
const series = (fn) => Array.from({ length: 30 }, (_, k) => fn(k));

describe("radar history frames", () => {
  it("spans the last 30 closes and ends with the live radarPoint", () => {
    const btc = liveCoin("BTC", 1.32, 0.292, 62_638_085);
    const p = radarPoint(btc, "30d", now);
    const H = radarFrames(hist({ BTC: { z: series((k) => 1 + k / 100), w: { "30d": series((k) => [0.1 + k / 100, 1e6 + k, 2]), "7d": series(() => null) }, e: "-".repeat(27) + "uuu" } }), [p], "30d", now, [btc]);
    expect(H.steps).toHaveLength(REPLAY + 1);
    expect(H.steps.slice(0, -1)).toEqual(closes);
    expect(H.steps[H.last]).toBe(now);
    const row = H.frames.get("BTC");
    expect(row).toHaveLength(31);
    expect(row[H.last]).toMatchObject({ x: p.x, y: p.y, gross: p.gross, modelled: false, roll: false, live: true });
    expect(frameAt(row, H.last)).toMatchObject({ x: 1.32, y: 0.292, gross: 62_638_085 });
    expect(row[0]).toMatchObject({ x: 1, y: 0.1, gross: 1e6, modelled: true, roll: false, engine: null });
    expect(row[29].engine).toBe("up");
  });

  it("decodes the flags: bit 0 roll, bit 1 modelled", () => {
    expect(decodeFlags(0)).toEqual({ roll: false, modelled: false });
    expect(decodeFlags(1)).toEqual({ roll: true, modelled: false });
    expect(decodeFlags(2)).toEqual({ roll: false, modelled: true });
    expect(decodeFlags(3)).toEqual({ roll: true, modelled: true });
    expect(decodeFlags(undefined)).toEqual({ roll: false, modelled: false });
    const H = radarFrames(hist({ ETH: { z: series(() => 1), w: { "30d": series((k) => [0.2, 5e5, k % 4]) }, e: "" } }), [], "30d", now);
    const row = H.frames.get("ETH");
    expect(row.slice(0, 4).map((f) => [f.roll, f.modelled])).toEqual([[false, false], [true, false], [false, true], [true, true]]);
  });

  it("reads the engine's saved reading per close", () => {
    const c = { e: "ud-n" };
    expect([0, 1, 2, 3, 4].map((k) => engineAt(c, k))).toEqual(["up", "defensive", null, "neutral", null]);
  });

  it("keeps a coin with a stretch but no wallet reading off the map, in the series", () => {
    const H = radarFrames(hist({ ADA: { z: series(() => 1.5), w: { "30d": series(() => null) }, e: "" } }), [], "30d", now);
    expect(H.frames.has("ADA")).toBe(false);
    expect(H.series.get("ADA").z.slice(0, 30).every((v) => v === 1.5)).toBe(true);
    expect(nearest(H.series.get("ADA").z, 12.4)).toBe(1.5);
  });

  it("returns null without a usable radar.json", () => {
    expect(radarFrames(null, [], "30d", now)).toBeNull();
    expect(radarFrames({ version: 2, closes }, [], "30d", now)).toBeNull();
    expect(radarFrames({ version: 1, closes: [] }, [], "30d", now)).toBeNull();
  });
});

describe("gaps are never bridged", () => {
  const f = (x) => ({ x, y: x / 10, gross: 100, roll: false, modelled: true });
  const row = [f(0), f(1), null, f(3), f(4), f(5)];

  it("frameAt is null at a missing close and never interpolates across it", () => {
    expect(frameAt(row, 2)).toBeNull();
    expect(frameAt(row, 1.3)).toMatchObject({ x: 1, at: 1 });   // nearer close, no tween into the gap
    expect(frameAt(row, 1.7)).toBeNull();
    expect(frameAt(row, 2.6)).toMatchObject({ x: 3, at: 3 });
    expect(frameAt(row, 3.5)).toMatchObject({ x: 3.5, y: 0.35 });
    expect(frameAt(row, 3.5).at).toBeUndefined();
  });

  it("trailAt stops at the gap", () => {
    expect(trailAt(row, 5).map((p) => p.i)).toEqual([3, 4, 5]);
    expect(trailAt(row, 4.5).map((p) => p.i)).toEqual([3, 4, 4.5]);
    expect(trailAt(row, 1).map((p) => p.i)).toEqual([0, 1]);
    expect(trailAt(row, 2)).toEqual([]);
    expect(trailAt(row, 3).map((p) => p.i)).toEqual([3]);
  });

  it("trails hold at most TRAIL closes behind the head", () => {
    const long = Array.from({ length: 31 }, (_, k) => f(k));
    expect(trailAt(long, 30)).toHaveLength(TRAIL + 1);
    expect(trailAt(long, 30)[0].i).toBe(30 - TRAIL);
    expect(trailAt(long, 20.4)).toHaveLength(TRAIL + 1);
    expect(trailAt(long, 20.4).at(-1)).toMatchObject({ head: true, i: 20.4 });
  });

  it("does not join a live step to closes more than a day behind", () => {
    const late = LAST + 3 * DAY;
    const btc = liveCoin("BTC", 1.3, 0.3, 5e7, late);
    const p = radarPoint(btc, "30d", late);
    const H = radarFrames(hist({ BTC: { z: series(() => 1), w: { "30d": series(() => [0.2, 1e6, 0]) }, e: "" } }), [p], "30d", late, [btc]);
    expect(H.brk).toBe(true);
    const row = H.frames.get("BTC");
    expect(trailAt(row, H.last).map((q) => q.i)).toEqual([H.last]);
    expect(frameAt(row, H.last - 0.7)).toMatchObject({ x: 1, at: H.last - 1 });
    expect(frameAt(row, H.last - 0.3)).toMatchObject({ x: 1.3, at: H.last });
    // About an hour after 00:00 UTC the engine is a close ahead of radar.json: still joined.
    const soon = LAST + DAY + 3600, btcSoon = liveCoin("BTC", 1.3, 0.3, 5e7, soon);
    const early = radarFrames(hist({ BTC: { z: series(() => 1), w: { "30d": series(() => [0.2, 1e6, 0]) }, e: "" } }), [radarPoint(btcSoon, "30d", soon)], "30d", soon, [btcSoon]);
    expect(early.brk).toBe(false);
    expect(trailAt(early.frames.get("BTC"), early.last)).toHaveLength(TRAIL + 1);
  });
});

describe("close labels", () => {
  it("names the day the bar covered, in UTC", () => {
    expect(closeLabel(LAST)).toBe("2 Oct");
    expect(closeLabel(closes[0])).toBe("3 Sep");
  });
});
