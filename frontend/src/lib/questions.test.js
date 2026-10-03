import { describe, it, expect, beforeEach, vi } from "vitest";
import btc from "../fixtures/questions/BTC.json";
import {
  centsUp, centsDown, gap, priceAge, ticket, parseId, copyText, orderedLegs, findLevel, deriveLink, closeTicket, payAt,
} from "./questions.js";
import { loadPositions, savePositions, addPosition, _resetMemory, valuePosition } from "./positions.js";

const T14 = 1791036000;
const lv = findLevel(btc, "BTC-20261009-A-83000-89000").level;
const eth = {
  index: 2680.74, spec: { tick: 0.1, min: 0.1, step: 0.01, taker: 0.0003, base: 0.5, cap: 0.125 },
};
const ethLevel = { id: "ETH-20261009-A-2600-2800", k: 2700, lo: 2600, hi: 2800, fair: 0.4305, state: "open",
  yes: { state: "no_quote", buy: 0.4605, sell: 0.404, size: 40, form: "debit",
    legs: [["ETH-20261009-2600-C", "buy", 106], ["ETH-20261009-2800-C", "sell", 13.9]] } };

describe("prices per $1", () => {
  it("rounds buys up and sell-backs down, to whole cents", () => {
    expect(centsUp(lv.yes.buy)).toBe(38);
    expect(centsDown(lv.yes.sell)).toBe(34);
    expect(centsUp(lv.no.buy)).toBe(66);
    expect(centsUp(0.38)).toBe(38);
    expect(centsDown(0.34)).toBe(34);
    expect(gap(lv.yes)).toBe(4);
  });
  it("marks prices stale at 35 minutes and paused at 90", () => {
    expect(priceAge(T14, T14 + 35 * 60).state).toBe("fresh");
    expect(priceAge(T14, T14 + 36 * 60).state).toBe("stale");
    expect(priceAge(T14, T14 + 90 * 60).state).toBe("stale");
    expect(priceAge(T14, T14 + 91 * 60).state).toBe("paused");
    expect(priceAge(T14, T14 + 60, true).state).toBe("paused");
  });
  it("parses fractional strikes", () => {
    expect(parseId("XRP-20261030-A-1_3-1_4")).toEqual({ und: "XRP", expiry: "20261030", lo: 1.3, hi: 1.4, k: 1.35 });
  });
  it("pays in a straight line across the zone, and No is the mirror", () => {
    expect(payAt(86000, 83000, 89000)).toBe(0.5);
    expect(payAt(90000, 83000, 89000, "no")).toBe(0);
    expect(payAt(82000, 83000, 89000, "no")).toBe(1);
  });
});

describe("the amount panel", () => {
  it("reproduces BTC above $86,000 on Fri 9 Oct for $100", () => {
    const t = ticket(lv, "yes", 100, btc);
    expect(t.contracts).toBe(0.04407);
    expect(t.premium.toFixed(2)).toBe("99.99");
    expect(t.fees.toFixed(2)).toBe("3.01");
    expect(t.payout.toFixed(2)).toBe("264.42");
    expect(t.atK.toFixed(2)).toBe("132.21");
    expect(t.minPayout).toBe(60);
    expect(t.capped).toBe(false);
  });
  it("reproduces ETH above $2,700: 1.08 contracts, and caps $100 at the size shown", () => {
    const uncapped = ticket({ ...ethLevel, yes: { ...ethLevel.yes, size: 1e6 } }, "yes", 100, eth);
    expect(uncapped.contracts).toBe(1.08);
    expect(uncapped.premium.toFixed(2)).toBe("99.47");
    expect(uncapped.payout).toBeCloseTo(216);
    const capped = ticket(ethLevel, "yes", 100, eth);
    expect(capped.capped).toBe(true);
    expect(capped.payout).toBeCloseTo(40);
    expect(capped.minPayout).toBeCloseTo(20); // 0.1 ETH contracts on a $200 zone
  });
  it("flags amounts under Derive's minimum (0.01 BTC)", () => {
    expect(ticket(lv, "yes", 10, btc).belowMin).toBe(true);
    expect(ticket(lv, "yes", 23, btc).belowMin).toBe(false);
  });
});

describe("the ticket", () => {
  it("copies the 2.2 orders byte for byte, the bought leg first", () => {
    const t = ticket(lv, "yes", 100, btc);
    const legs = orderedLegs(lv.yes);
    expect(legs[0].act).toBe("buy");
    expect(copyText({ question: "BTC above $86,000 on Fri 9 Oct?", answer: "Yes", legs, contracts: t.contracts, tick: 1, settleTs: 1791532800 }))
      .toBe("BTC above $86,000 on Fri 9 Oct? Yes\nBUY  BTC-20261009-83000-C  0.04407  limit 2431\nSELL BTC-20261009-89000-C  0.04407  limit 162\n"
        + "Place line 2 only after line 1 has filled. Settles 2026-10-09 08:00 UTC, 30-minute average.");
  });
  it("buys back the short leg first when selling back", () => {
    const legs = orderedLegs(lv.yes, true);
    expect(legs.map((l) => [l.act, l.name])).toEqual([["buy", "BTC-20261009-89000-C"], ["sell", "BTC-20261009-83000-C"]]);
    expect(closeTicket(lv, "yes", 0.04407, btc).premium).toBeCloseTo(lv.yes.sell * 6000 * 0.04407);
  });
  it("keeps Derive's underscore in a fractional instrument name", () => {
    const side = { legs: [["XRP-20261030-1_3-C", "buy", 0.21], ["XRP-20261030-1_4-C", "sell", 0.15]] };
    expect(orderedLegs(side)[0].name).toBe("XRP-20261030-1_3-C");
  });
  it("adds a configured referral code to the Derive link only when set", () => {
    expect(deriveLink("", "https://app.derive.xyz/trade/options")).toBe("https://app.derive.xyz/trade/options");
    expect(deriveLink("cowboy", "https://app.derive.xyz/trade/options", "ref")).toBe("https://app.derive.xyz/trade/options?ref=cowboy");
  });
});

describe("My questions storage", () => {
  beforeEach(() => { _resetMemory(); try { localStorage.clear(); } catch { /* blocked */ } });
  it("falls back to memory when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    addPosition({ id: lv.id, side: "yes", contracts: 0.04407, lo: 83000, hi: 89000, paid: 103.01 });
    expect(loadPositions()).toHaveLength(1);
    spy.mockRestore();
  });
  it("values a position at the sell-back price, and at settlement by what was paid", () => {
    const p = { id: lv.id, side: "yes", contracts: 0.04407, lo: 83000, hi: 89000, paid: 103.01 };
    expect(valuePosition(p, { level: lv }).now).toBeCloseTo(lv.yes.sell * 6000 * 0.04407);
    const s = valuePosition(p, null, 86000);
    expect(s.per).toBe(0.5);
    expect(s.got).toBeCloseTo(132.21);
    savePositions([p]);
  });
});
