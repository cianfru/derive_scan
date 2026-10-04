import { describe, it, expect } from "vitest";
import btc from "../fixtures/questions/BTC.json";
import { closeTicket, findLevel, payAt } from "./questions.js";
import { closeSummary, positionFigures, positionStatus } from "./positions.js";

const lv = findLevel(btc, "BTC-20261009-A-83000-89000").level;
const p = { key: "a", id: lv.id, und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
  legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both", settle_ts: 1791532800 };
const found = { level: lv };

describe("Positions maths", () => {
  it("values an open position: most it pays, value now after exit fees, P/L now and at today's price", () => {
    const t = closeTicket(lv, "yes", p.contracts, btc, p.legs);
    const f = positionFigures(p, { found, close: t, index: btc.index });
    expect(f.maxPayout).toBeCloseTo(6000 * 0.04407, 6);
    expect(f.valueNow).toBeCloseTo(lv.yes.sell * 6000 * 0.04407 - t.fees, 6);
    expect(f.plNow).toBeCloseTo(f.valueNow - 103.01, 6);
    const atToday = payAt(btc.index, 83000, 89000, "yes") * 6000 * 0.04407;
    expect(f.expiryNow).toBeCloseTo(atToday, 6);
    expect(f.plExpiryNow).toBeCloseTo(atToday - 103.01, 6);
    // Lower mirrors it at today's price.
    const g = positionFigures({ ...p, side: "no", legs: null }, { found, index: btc.index });
    expect(g.expiryNow).toBeCloseTo((1 - payAt(btc.index, 83000, 89000, "yes")) * 6000 * 0.04407, 6);
    expect(g.valueNow).toBeNull(); // no exit fees known, no value now
  });

  it("closing: P/L is proceeds minus fees minus what was paid, beside holding at today's price", () => {
    const t = closeTicket(lv, "yes", p.contracts, btc, p.legs);
    const c = closeSummary(t, 103.01, 80);
    expect(c.proceeds).toBeCloseTo(t.premium - t.fees, 9);
    expect(c.pl).toBeCloseTo(t.premium - t.fees - 103.01, 9);
    expect(c.holdPl).toBeCloseTo(80 - 103.01, 9);
    expect(closeSummary(null, 1)).toBeNull();
  });

  it("settles at the ramp, and a closed position keeps what came back", () => {
    const s = positionFigures(p, { found, settlePrice: 86000 });
    expect(s.settled).toBe(true);
    expect(s.got).toBeCloseTo(0.5 * 6000 * 0.04407, 6);
    expect(s.pl).toBeCloseTo(s.got - 103.01, 6);
    const c = positionFigures({ ...p, closed_at: 1791100000, proceeds: 90 }, { found });
    expect(c).toMatchObject({ closed: true, got: 90 });
    expect(c.pl).toBeCloseTo(-13.01, 9);
  });

  it("never values a partial fill as the answer", () => {
    const f = positionFigures({ ...p, exec: "hand_partial" }, { found, settlePrice: 86000, index: btc.index });
    expect(f).toMatchObject({ partial: true, paid: 103.01, maxPayout: null, valueNow: null, plNow: null, expiryNow: null, got: null, pl: null });
  });

  it("names the execution status in plain words", () => {
    expect(positionStatus(p).text).toBe("Placed by hand · both filled");
    expect(positionStatus({ ...p, exec: undefined }).key).toBe("both"); // older entries count as both
    expect(positionStatus({ ...p, exec: "hand_partial" })).toMatchObject({ key: "partial", text: "Placed by hand · only the first filled", warn: true });
    expect(positionStatus(p, { settled: true }).key).toBe("settled");
    expect(positionStatus(p, { settling: true }).key).toBe("settling");
    expect(positionStatus({ ...p, closed_at: 1, proceeds: 1 }).text).toBe("Closed · sold back by hand");
  });
});
