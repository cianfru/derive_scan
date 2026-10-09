import { describe, it, expect, beforeEach, vi } from "vitest";
import btc from "../fixtures/questions/BTC.json";
import {
  centsUp, centsDown, gap, priceAge, ticket, parseId, copyText, orderedLegs, findLevel, deriveLink, closeTicket, payAt,
  outcome, breakeven, sliderStep, budgetTicket, questionText, answerNames, handRisk, live, legFee, buyCents, noPriceReason, settleOf,
} from "./questions.js";
import { loadPositions, savePositions, addPosition, _resetMemory, valuePosition, closePosition } from "./positions.js";

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
    expect(centsUp(lv.no.buy)).toBe(67); // debit only: the put spread (the call twin was 66c)
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
    expect(valuePosition(p, { level: lv }).now).toBeNull(); // no exit fees known, no value
    const fees = closeTicket(lv, "yes", 0.04407, btc).fees;
    expect(fees).toBeGreaterThan(1);
    expect(valuePosition(p, { level: lv }, null, fees).now).toBeCloseTo(lv.yes.sell * 6000 * 0.04407 - fees);
    const s = valuePosition(p, null, 86000);
    expect(s.per).toBe(0.5);
    expect(s.got).toBeCloseTo(132.21);
    savePositions([p]);
  });
});

// The review's worked example (retail UI review G1): Mon 5 Oct, BTC 80,000-86,000, prices of 13:15 UTC.
const mon = {
  index: 84854.3, spec: { tick: 1, min: 0.01, step: 1e-05, taker: 0.0003, base: 0.5, cap: 0.125 },
};
const lv83 = { id: "BTC-20261005-A-80000-86000", k: 83000, lo: 80000, hi: 86000, fair: 0.7902, state: "open", ladder: 7,
  yes: { state: "open", buy: 0.8133, sell: 0.7733, size: 23846.4, form: "debit",
    legs: [["BTC-20261005-80000-C", "buy", 4974.0], ["BTC-20261005-86000-C", "sell", 94.0]],
    close: [["BTC-20261005-86000-C", "buy", 120.0], ["BTC-20261005-80000-C", "sell", 4760.0]] },
  no: { state: "open", buy: 0.2267, sell: 0.1867, size: 720.0, form: "credit",
    legs: [["BTC-20261005-86000-C", "buy", 120.0], ["BTC-20261005-80000-C", "sell", 4760.0]] } };

describe("the outcome preview", () => {
  it("reproduces $100 of Higher on BTC 80,000-86,000: pay $101.75, pays at most $122.94, makes at most $21.19, breakeven $84,966", () => {
    const t = ticket(lv83, "yes", 100, mon);
    expect(t.mostLose.toFixed(2)).toBe("101.75");
    expect(t.payout.toFixed(2)).toBe("122.94");
    expect((t.payout - t.mostLose).toFixed(2)).toBe("21.19");
    expect(Math.round(breakeven(t, lv83, "yes"))).toBe(84966);
    // At today's price the trade loses about $2.30 at expiry.
    expect(outcome(t, lv83, "yes", 84854.3).pl).toBeCloseTo(-2.30, 1);
  });
  it("reproduces the 2.2 example: $100 typed gives $264.42 payout and $103.01 in total", () => {
    const t = ticket(lv, "yes", 100, btc);
    expect(t.payout.toFixed(2)).toBe("264.42");
    expect(t.mostLose.toFixed(2)).toBe("103.01");
  });
  // The budget convention (owner, 4 October 2026): the amount typed is the total, Derive's fees
  // included. The two examples above size $100 of premium (ticket); the screens now size through
  // budgetTicket, so $100 typed gives these figures.
  it("G1 with $100 as the total: 0.02013 contracts, $98.23 + $1.75 fees = $99.98, pays at most $120.78, makes at most $20.80", () => {
    const t = budgetTicket(lv83, "yes", 100, mon);
    expect(t.contracts).toBe(0.02013);
    expect(t.premium.toFixed(2)).toBe("98.23");
    expect(t.fees.toFixed(2)).toBe("1.75");
    expect(t.mostLose.toFixed(2)).toBe("99.98");
    expect(t.mostLose).toBeLessThanOrEqual(100);
    expect(t.payout.toFixed(2)).toBe("120.78");
    expect((t.payout - t.mostLose).toFixed(2)).toBe("20.80");
    expect(Math.round(breakeven(t, lv83, "yes"))).toBe(84967);
    expect(outcome(t, lv83, "yes", 84854.3).pl).toBeCloseTo(-2.27, 2);
  });
  it("2.2 with $100 as the total: 0.04277 contracts, $97.05 + $2.95 fees = $100.00, pays at most $256.62", () => {
    const t = budgetTicket(lv, "yes", 100, btc);
    expect(t.contracts).toBe(0.04277);
    expect(t.premium.toFixed(2)).toBe("97.05");
    expect(t.fees.toFixed(2)).toBe("2.95");
    expect(t.mostLose.toFixed(2)).toBe("100.00");
    expect(t.mostLose).toBeLessThanOrEqual(100);
    expect(t.payout.toFixed(2)).toBe("256.62");
    expect(Math.round(breakeven(t, lv, "yes"))).toBe(85338);
    // Below Derive's base fees nothing is bought, and the smallest total is given.
    expect(budgetTicket(lv, "yes", 1, btc).belowMin).toBe(true);
    expect(budgetTicket(lv, "yes", 1, btc).minTotal).toBeGreaterThan(budgetTicket(lv, "yes", 1, btc).minCost);
  });
  it("gives the same payout as the ramp at lo, K and hi, and mirrors Lower", () => {
    const t = ticket(lv, "yes", 100, btc);
    for (const s of [lv.lo, lv.k, lv.hi]) expect(outcome(t, lv, "yes", s).payout).toBeCloseTo(payAt(s, lv.lo, lv.hi) * t.payout);
    const n = ticket(lv, "no", 100, btc);
    expect(outcome(n, lv, "no", lv.lo).payout).toBeCloseTo(n.payout);
    expect(outcome(n, lv, "no", lv.hi).payout).toBe(0);
    expect(breakeven(n, lv, "no")).toBeCloseTo(lv.hi - (n.mostLose / n.payout) * 6000);
  });
  it("has no breakeven when the payout never covers what is paid", () => {
    expect(breakeven({ payout: 100, mostLose: 101 }, lv, "yes")).toBeNull();
  });
  it("steps the slider on a 1-2-5 scale", () => {
    expect(sliderStep(6000)).toBe(100);
    expect(sliderStep(0.1)).toBe(0.001);
    expect(sliderStep(8000)).toBe(100);
  });
  it("asks Higher or lower on a date at 08:00 UTC, never by a date", () => {
    expect(questionText("BTC", lv83, "20261005")).toBe("BTC higher or lower than $83,000 on Mon 5 Oct, 08:00 UTC?");
    expect(questionText("BTC", lv83, "20261005")).not.toMatch(/\bby\b/);
    expect(answerNames(true)).toEqual({ yes: "Higher", no: "Lower" });
  });
  it("offers debit packages only: a credit side left in an older file has no price", () => {
    // Judged before the fixture's own settlement (Mon 5 Oct 2026, 08:00 UTC), whatever today's date.
    const before = Date.UTC(2026, 9, 4, 12) / 1000;
    expect(live(lv83, "yes", false, before)).toBe(true);
    expect(live(lv83, "no", false, before)).toBe(false);
  });
  it("prices the first order alone when placing by hand", () => {
    const t = ticket(lv83, "yes", 100, mon);
    const r = handRisk(t, lv83, "yes", mon);
    expect(r.upfront).toBeCloseTo(4974 * t.contracts);
    expect(r.firstLose).toBeCloseTo(4974 * t.contracts + legFee(mon.index, 4974, t.contracts, mon.spec));
    expect(r.firstLose).toBeGreaterThan(r.both);
  });
  it("sells back only the instruments held, and nets Derive's exit fees", () => {
    const c = closeTicket(lv83, "yes", 0.02, mon, ["BTC-20261005-80000-C", "BTC-20261005-86000-C"]);
    expect(c.proceeds).toBeCloseTo(c.premium - c.fees);
    expect(closeTicket(lv83, "yes", 0.02, mon, ["BTC-20261005-86000-P", "BTC-20261005-80000-P"])).toBeNull();
  });
});

describe("Positions storage", () => {
  beforeEach(() => { _resetMemory(); try { localStorage.clear(); } catch { /* blocked */ } });
  it("loads older entries without exec or legs, and closes a position with what came back", () => {
    savePositions([{ key: "x", id: lv.id, side: "yes", contracts: 0.01, lo: 83000, hi: 89000, paid: 30 }]);
    expect(loadPositions()).toHaveLength(1);
    const [p] = closePosition("x", 25, 1791040000);
    expect(p).toMatchObject({ closed_at: 1791040000, proceeds: 25 });
    expect(valuePosition(p, { level: lv })).toMatchObject({ closed: true, got: 25 });
  });
  it("never values a partial fill", () => {
    const p = { id: lv.id, side: "yes", contracts: 0.01, lo: 83000, hi: 89000, paid: 30, exec: "hand_partial" };
    expect(valuePosition(p, { level: lv }, null, 1).now).toBeNull();
    expect(valuePosition(p, null, 86000).got).toBeUndefined();
  });
});


describe("review: clock cutoff and prices above 99c", () => {
  const T = (h, m) => Date.UTC(2026, 9, 9, h, m) / 1000;  // 9 Oct 2026
  const level = { id: "BTC-20261009-A-83000-89000", state: "open", lo: 83000, hi: 89000, k: 86000,
    yes: { state: "open", buy: 0.5, form: "debit" }, no: { state: "open", buy: 0.9953, form: "debit" } };

  it("enforces the 07:30 UTC cutoff by the clock now, not by the quote's time", () => {
    // The file was written at 07:15 (level still open); at 07:29 it can be placed, at 07:30 and 07:45 not.
    expect(live(level, "yes", false, T(7, 29))).toBe(true);
    expect(live(level, "yes", false, T(7, 30))).toBe(false);
    expect(live(level, "yes", false, T(7, 45))).toBe(false);
    expect(buyCents(level, "yes", false, T(7, 45))).toBeNull();
    expect(settleOf(level)).toBe(T(8, 0));
  });

  it("never shows a price above 99c as 99c: that side is not offered", () => {
    expect(live(level, "no", false, T(1, 0))).toBe(false);
    expect(buyCents(level, "no", false, T(1, 0))).toBeNull();
    // noPriceReason reads the clock for the settling window; pinned so this date is not settling.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T(1, 0) * 1000);
    try {
      expect(noPriceReason({ ...level, no: { ...level.no, state: "tail" } }, "no")).toMatch(/more than 99c/);
    } finally { vi.useRealTimers(); }
    expect(live({ ...level, no: { ...level.no, buy: 0.99 } }, "no", false, T(1, 0))).toBe(true);
  });
});
