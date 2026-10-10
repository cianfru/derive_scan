import { describe, expect, it } from "vitest";
import { article, groupTrades, mergeRepeats, stories } from "./flowStories.js";

const W = "0x" + "a".repeat(40), V = "0x" + "b".repeat(40);
const leg = (instrument, direction, premium, ts, wallet = W, extra = {}) => ({ kind: "option", underlying: instrument.split("-")[0], instrument,
  direction, premium_usd: premium, notional_usd: 100000, ts, wallet, class: "directional", ...extra });
const T = 1791600000000;

describe("flow stories", () => {
  it("groups the legs one wallet sends together and names the trade in plain words", () => {
    const s = groupTrades([
      leg("BTC-20261016-86000-C", "buy", 765, T), leg("BTC-20261016-88000-C", "sell", 243, T + 1000),
      leg("BTC-20261013-80000-P", "sell", 264, T, V), leg("BTC-20261013-85000-C", "sell", 533, T + 2000, V),
      leg("ETH-20261030-2500-P", "sell", 5583, T + 9e5),
    ]);
    const by = Object.fromEntries(s.map((x) => [x.text, x]));
    expect(Object.keys(by).sort()).toEqual(["bought a BTC call spread", "sold ETH puts", "sold a BTC strangle"]);
    expect(by["bought a BTC call spread"]).toMatchObject({ paid: true, money: 522, gross: 1008 });
    expect(by["bought a BTC call spread"].detail).toBe("buy 86,000 call · sell 88,000 call · Oct 16");
    expect(by["sold a BTC strangle"]).toMatchObject({ paid: false, money: 797 });
    expect(by["sold ETH puts"]).toMatchObject({ paid: false, money: 5583, detail: "2,500 put · Oct 30" });
  });

  it("keeps legs apart when they are more than 5 seconds apart, on another coin or from another wallet", () => {
    expect(groupTrades([leg("BTC-20261016-86000-C", "buy", 1, T), leg("BTC-20261016-88000-C", "sell", 1, T + 6000)])).toHaveLength(2);
    expect(groupTrades([leg("BTC-20261016-86000-C", "buy", 1, T), leg("ETH-20261016-2600-C", "sell", 1, T)])).toHaveLength(2);
    expect(groupTrades([leg("BTC-20261016-86000-C", "buy", 1, T), leg("BTC-20261016-88000-C", "sell", 1, T, V)])).toHaveLength(2);
    expect(groupTrades([{ kind: "perp", underlying: "BTC", instrument: "BTC-PERP", ts: T, wallet: W }])).toEqual([]);
  });

  it("names a straddle, a roll and anything else by its legs", () => {
    const [straddle] = groupTrades([leg("ETH-20261030-2600-P", "buy", 100, T), leg("ETH-20261030-2600-C", "buy", 120, T)]);
    expect(straddle).toMatchObject({ text: "bought an ETH straddle", paid: true, money: 220 });
    const [roll] = groupTrades([leg("ETH-20261010-2600-P", "buy", 50, T), leg("ETH-20261023-2600-P", "sell", 400, T)]);
    expect(roll).toMatchObject({ text: "rolled ETH puts to Oct 23", paid: false, money: 350 });
    expect(roll.detail).toBe("buy 2,600 put Oct 10 · sell 2,600 put Oct 23");
    const [three] = groupTrades([leg("BTC-20261016-80000-P", "buy", 10, T), leg("BTC-20261016-84000-P", "sell", 30, T), leg("BTC-20261016-90000-C", "buy", 5, T)]);
    expect(three.text).toBe("sold a BTC 3-option trade");
  });

  it("reads the same trade repeated within 30 minutes as one line with its count", () => {
    const spread = (ts) => [leg("ETH-20261030-2800-C", "buy", 2000, ts), leg("ETH-20261030-3500-C", "sell", 200, ts)];
    const out = mergeRepeats(groupTrades([...spread(T), ...spread(T + 60_000), ...spread(T + 120_000), ...spread(T + 4 * 3600_000)]));
    expect(out.map((x) => x.times)).toEqual([3, 1]);
    expect(out[0]).toMatchObject({ text: "bought an ETH call spread", money: 5400, paid: true });
  });

  it("orders by the money paid or collected, or by time", () => {
    const list = [leg("BTC-20261016-86000-C", "buy", 900, T), leg("ETH-20261030-2500-P", "sell", 5000, T - 1e6, V), leg("XRP-20261030-1_8-C", "buy", 50, T + 1e6, V)];
    expect(stories(list).map((s) => s.und)).toEqual(["ETH", "BTC", "XRP"]);
    expect(stories(list, "latest").map((s) => s.und)).toEqual(["XRP", "BTC", "ETH"]);
    expect(stories(list).find((s) => s.und === "XRP").detail).toBe("1.8 call · Oct 30");
  });

  it("uses an before coins read with a vowel sound", () => {
    expect(["ETH", "XRP", "BTC", "HYPE"].map(article)).toEqual(["an", "an", "a", "a"]);
  });
});
