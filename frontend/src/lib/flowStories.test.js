import { describe, expect, it } from "vitest";
import { article, groupTrades, largestTrade, mergeRepeats, sentence, stories } from "./flowStories.js";

const W = "0x" + "a".repeat(40), V = "0x" + "b".repeat(40);
const leg = (instrument, direction, premium, ts, wallet = W, extra = {}) => ({ kind: "option", underlying: instrument.split("-")[0], instrument,
  direction, premium_usd: premium, notional_usd: 100000, ts, wallet, class: "directional", ...extra });
const T = 1791600000000;
const plain = (t) => t.replace(/\u00a0/g, " "); // details keep each leg whole with no-break spaces

describe("flow stories", () => {
  it("groups the legs one wallet sends together and names the trade in plain words", () => {
    const s = groupTrades([
      leg("BTC-20261016-86000-C", "buy", 765, T), leg("BTC-20261016-88000-C", "sell", 243, T + 1000),
      leg("BTC-20261013-80000-P", "sell", 264, T, V), leg("BTC-20261013-85000-C", "sell", 533, T + 2000, V),
      leg("ETH-20261030-2500-P", "sell", 5583, T + 9e5),
    ]);
    const by = Object.fromEntries(s.map((x) => [x.text, x]));
    expect(Object.keys(by).sort()).toEqual(["bought a BTC call spread", "sold ETH puts", "sold a BTC strangle"]);
    expect(by["bought a BTC call spread"]).toMatchObject({ paid: true, money: 522, gross: 1008, rise: 765, fall: 243, side: "rise" });
    // Calls sold gain if the price falls, puts sold if it rises: the strangle's calls outweigh its puts.
    expect(by["sold a BTC strangle"]).toMatchObject({ rise: 264, fall: 533, side: "fall" });
    expect(by["sold ETH puts"]).toMatchObject({ rise: 5583, fall: 0, side: "rise" });
    expect(plain(by["bought a BTC call spread"].detail)).toBe("buy 86,000 call · sell 88,000 call · Oct 16");
    expect(by["sold a BTC strangle"]).toMatchObject({ paid: false, money: 797 });
    expect(by["sold ETH puts"]).toMatchObject({ paid: false, money: 5583 });
    expect(plain(by["sold ETH puts"].detail)).toBe("2,500 put · Oct 30");
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
    expect(plain(roll.detail)).toBe("buy 2,600 put Oct 10 · sell 2,600 put Oct 23");
    const [three] = groupTrades([leg("BTC-20261016-80000-P", "buy", 10, T), leg("BTC-20261016-84000-P", "sell", 30, T), leg("BTC-20261016-90000-C", "buy", 5, T)]);
    expect(three.text).toBe("traded 3 BTC options together");
    // Two dates far from settling are not a roll; unequal sizes are not a spread.
    const [dates] = groupTrades([leg("ETH-20261030-2600-P", "buy", 50, T), leg("ETH-20261127-2600-P", "sell", 400, T)]);
    expect(dates.text).toBe("traded ETH puts on two dates");
    const [ratio] = groupTrades([leg("BTC-20261016-86000-C", "buy", 765, T, W, { amount: 1 }), leg("BTC-20261016-88000-C", "sell", 243, T, W, { amount: 2 })]);
    expect(ratio.text).toBe("traded 2 BTC options together");
  });

  it("reads the same trade repeated within 30 minutes as one line with its count", () => {
    const spread = (ts) => [leg("ETH-20261030-2800-C", "buy", 2000, ts), leg("ETH-20261030-3500-C", "sell", 200, ts)];
    const out = mergeRepeats(groupTrades([...spread(T), ...spread(T + 60_000), ...spread(T + 120_000), ...spread(T + 4 * 3600_000)]));
    expect(out.map((x) => x.times)).toEqual([3, 1]);
    expect(out[0]).toMatchObject({ text: "bought an ETH call spread", money: 5400, single: 1800, paid: true, lastTs: (T + 120_000) / 1000 });
    // Another coin, other sizes or the other side of the money are other trades.
    const other = mergeRepeats(groupTrades([...spread(T), leg("XAUT-20261030-2800-C", "buy", 2000, T + 1000, W), leg("XAUT-20261030-3500-C", "sell", 200, T + 1000, W),
      leg("ETH-20261030-2800-C", "buy", 2000, T + 9000, W, { amount: 1 }), leg("ETH-20261030-3500-C", "sell", 200, T + 9000, W, { amount: 3 })]));
    expect(other.map((x) => x.times)).toEqual([1, 1, 1]);
  });

  it("orders by the money paid or collected, or by time", () => {
    const list = [leg("BTC-20261016-86000-C", "buy", 900, T), leg("ETH-20261030-2500-P", "sell", 5000, T - 1e6, V), leg("XRP-20261030-1_8-C", "buy", 50, T + 1e6, V)];
    expect(stories(list).map((s) => s.und)).toEqual(["ETH", "BTC", "XRP"]);
    expect(stories(list, "latest").map((s) => s.und)).toEqual(["XRP", "BTC", "ETH"]);
    expect(plain(stories(list).find((s) => s.und === "XRP").detail)).toBe("1.8 call · Oct 30");
  });

  it("the card's largest trade is one trade, never repeats added up", () => {
    const spread = (ts) => [leg("ETH-20261030-2800-C", "buy", 2000, ts), leg("ETH-20261030-3500-C", "sell", 200, ts)];
    const list = [...spread(T), ...spread(T + 60_000), ...spread(T + 120_000), leg("ZEC-20261030-1100-C", "sell", 2500, T, V)];
    expect(stories(list)[0]).toMatchObject({ und: "ETH", times: 3, money: 5400 });
    expect(largestTrade(list)).toMatchObject({ und: "ZEC", money: 2500, text: "sold ZEC calls" });
    expect(sentence("sold ZEC calls")).toBe("Sold ZEC calls");
  });

  it("uses an before coins read with a vowel sound", () => {
    expect(["ETH", "XRP", "BTC", "HYPE"].map(article)).toEqual(["an", "an", "a", "a"]);
  });
});
