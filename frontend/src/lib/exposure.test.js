import { describe, it, expect } from "vitest";
import btc from "../fixtures/questions/BTC.json";
import { budgetTicket, findLevel } from "./questions.js";
import {
  combine, exposureGroups, netLegs, parseInstrument, positionExposure, proposalLegs, totalMostLose, withTrade,
} from "./exposure.js";

const C = (strike, qty) => ({ kind: "C", strike, qty });
const P = (strike, qty) => ({ kind: "P", strike, qty });
const NOW = 1791036000; // Sat 3 Oct 2026 14:00 UTC
const S9 = 1791532800; // Fri 9 Oct 08:00 UTC
const S16 = S9 + 7 * 86400;

/** A journal position as "I placed it" saves it: exact filled legs and the cost split. */
function pos({ key, id, side, contracts, premium, fees, legs, settle = S9, exec = "hand_both" }) {
  const [und, expiry, , lo, hi] = id.split("-");
  return {
    key, id, und, side, lo: +lo, hi: +hi, contracts, paid: premium + fees, settle_ts: settle, exec, network: "mainnet", exits: [],
    journal: { schema: 1, package: { expiry }, fill: { legs: legs.map(([name, sq]) => ({ name, qty: Math.abs(sq), signed_qty: sq })) },
      cost: { premium, fees, fees_basis: "entered", total: premium + fees } },
  };
}

describe("exposure: instruments and one ticket", () => {
  it("reads Derive's names, fractional strikes with an underscore included", () => {
    expect(parseInstrument("BTC-20261009-83000-C")).toMatchObject({ und: "BTC", expiry: "20261009", strike: 83000, kind: "C" });
    expect(parseInstrument("XRP-20260828-1_35-P").strike).toBe(1.35);
    expect(parseInstrument("BTC-20261009-A-83000-89000")).toBeNull();
  });

  it("a call spread: most you can lose is its cost, most it pays its width, one breakeven", () => {
    const c = combine([C(83000, 0.01), C(89000, -0.01)], 40);
    expect(c.mostLose).toBeCloseTo(40, 9);
    expect(c.mostPays).toBeCloseTo(60, 9);
    expect(c.mostMake).toBeCloseTo(20, 9);
    expect(c.breakevens).toEqual([87000]);
  });

  it("offsetting legs cancel: buying and selling the same option leaves nothing", () => {
    expect(netLegs([C(83000, 0.01), C(83000, -0.01), P(80000, 0.02)])).toEqual([{ kind: "P", strike: 80000, name: undefined, qty: 0.02 }]);
    // Higher and Lower on the same level pay the full width at every price: the combined worst case
    // is the cost above it, far below the two tickets added up.
    const c = combine([C(83000, 0.01), C(89000, -0.01), P(89000, 0.01), P(83000, -0.01)], 38 + 66);
    expect(c.mostPays).toBeCloseTo(60, 9);
    expect(c.mostLose).toBeCloseTo(44, 9);
    expect(c.mostMake).toBeCloseTo(-44, 9);
    expect(c.breakevens).toEqual([]);
  });

  it("a lone long call keeps growing; a net short call has no limit to its loss", () => {
    const long = combine([C(83000, 0.01)], 25);
    expect(long.mostPays).toBe(Infinity);
    expect(long.mostLose).toBeCloseTo(25, 9);
    expect(long.breakevens).toEqual([85500]);
    const short = combine([C(83000, 0.01), C(89000, -0.02)], 20);
    expect(short.mostLose).toBe(Infinity);
    expect(short.breakevens.length).toBe(2);
  });
});

describe("exposure: groups by coin, settlement reference and date", () => {
  const hi = pos({ key: "h", id: "BTC-20261009-A-83000-89000", side: "yes", contracts: 0.04277, premium: 97.05, fees: 2.95,
    legs: [["BTC-20261009-83000-C", 0.04277], ["BTC-20261009-89000-C", -0.04277]] });
  const lo = pos({ key: "l", id: "BTC-20261009-A-80000-86000", side: "no", contracts: 0.05, premium: 88.5, fees: 3.1,
    legs: [["BTC-20261009-86000-P", 0.05], ["BTC-20261009-80000-P", -0.05]] });

  it("two tickets on the same date: one combined payoff, worst case below the sum of tickets", () => {
    const [g, ...rest] = exposureGroups([hi, lo], NOW);
    expect(rest).toHaveLength(0);
    expect(g.items).toHaveLength(2);
    expect(g.cost).toBeCloseTo(191.6, 9);
    expect(g.sumTickets).toBeCloseTo(191.6, 9); // 100 + 91.60
    // Lower 80-86k pays up to $300 at or below 80k, Higher 83-89k up to $256.62 from 89k. At 83-86k
    // both pay part; the worst settlement price for the pair is 83,000 or 86,000.
    const at = (S) => g.pl(S);
    const worst = Math.min(at(83000), at(86000), at(80000), at(89000));
    expect(g.mostLose).toBeCloseTo(-worst, 9);
    expect(g.mostLose).toBeLessThan(g.sumTickets);
    // At 86,000 Lower pays nothing and Higher half its width: $191.60 - $128.31 = $63.29.
    expect(g.mostLose).toBeCloseTo(191.6 - 0.04277 * 3000, 6);
    expect(g.mostPays).toBeCloseTo(300, 9);
    expect(g.breakevens.length).toBe(2);
    expect(totalMostLose([g])).toBeCloseTo(g.mostLose, 9);
  });

  it("the same tickets on different dates settle apart: the total adds each date's worst case", () => {
    const later = { ...lo, id: "BTC-20261016-A-80000-86000", settle_ts: S16, journal: { ...lo.journal, package: { expiry: "20261016" } } };
    const gs = exposureGroups([hi, later], NOW);
    expect(gs.map((g) => g.expiry)).toEqual(["20261009", "20261016"]);
    expect(gs[0].mostLose).toBeCloseTo(100, 9);
    expect(gs[1].mostLose).toBeCloseTo(91.6, 9);
    expect(totalMostLose(gs)).toBeCloseTo(191.6, 9);
  });

  it("keeps BTC and ETH apart even on the same date", () => {
    const eth = pos({ key: "e", id: "ETH-20261009-A-3000-3200", side: "yes", contracts: 0.1, premium: 9, fees: 1,
      legs: [["ETH-20261009-3000-C", 0.1], ["ETH-20261009-3200-C", -0.1]] });
    const gs = exposureGroups([hi, eth], NOW);
    expect(gs.map((g) => g.und).sort()).toEqual(["BTC", "ETH"]);
    expect(gs.find((g) => g.und === "ETH").ref).toContain("ETH index");
  });

  it("counts only the legs that filled, scales to what is still open, and skips closed or settled ones", () => {
    const half = pos({ key: "p", id: "BTC-20261009-A-83000-89000", side: "yes", contracts: 0.04, premium: 97.24, fees: 1.5, exec: "hand_partial",
      legs: [["BTC-20261009-83000-C", 0.04], ["BTC-20261009-89000-C", 0]] });
    const e = positionExposure(half);
    expect(e.legs).toHaveLength(1);
    expect(e.partial).toBe(true);
    const [g] = exposureGroups([half], NOW);
    expect(g.mostPays).toBe(Infinity);
    const soldHalf = { ...hi, exits: [{ kind: "close", qty: 0.02, net: 40 }] };
    const s = positionExposure(soldHalf);
    expect(s.cost).toBeCloseTo(100 * (0.02277 / 0.04277), 9);
    expect(s.legs[0].qty).toBeCloseTo(0.02277, 9);
    expect(exposureGroups([{ ...hi, closed_at: NOW }], NOW)).toEqual([]);
    expect(exposureGroups([hi], S9 + 1)).toEqual([]);
  });

  it("draws an older record without filled amounts from its answer's pay zone", () => {
    const old = { key: "o", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "no", lo: 83000, hi: 89000, contracts: 0.01, paid: 40, settle_ts: S9 };
    const [g] = exposureGroups([old], NOW);
    expect(g.fromAnswer).toBe(true);
    expect(g.pl(80000)).toBeCloseTo(20, 9);
    expect(g.pl(90000)).toBeCloseTo(-40, 9);
  });

  it("withholds exposure for an incomplete RFQ entry or exit until its receipt is repaired", () => {
    const pending = { ...hi, exec: "rfq", journal: { ...hi.journal, fill: { ...hi.journal.fill, complete: false } } };
    expect(positionExposure(pending)).toBeNull();
    expect(exposureGroups([pending], NOW)).toEqual([]);
    const legacy = { ...pending, journal: { ...pending.journal, fill: { ...pending.journal.fill, complete: true, legs: [pending.journal.fill.legs[0]] } } };
    expect(positionExposure(legacy)).toBeNull();
    const closing = { ...hi, exec: "rfq", exits: [{ kind: "close", via: "rfq", complete: false, qty: 0, receipt_qty: 0.01 }] };
    expect(positionExposure(closing)).toBeNull();
    expect(exposureGroups([closing], NOW)).toEqual([]);
    const repaired = { ...pending, journal: { ...pending.journal, fill: { ...pending.journal.fill, complete: true } } };
    expect(exposureGroups([repaired], NOW)[0].mostLose).toBeCloseTo(100, 9);
  });
});

describe("exposure: a proposed trade on top of what is held", () => {
  const level = findLevel(btc, "BTC-20261009-A-80000-86000").level;
  const held = pos({ key: "h", id: "BTC-20261009-A-83000-89000", side: "yes", contracts: 0.04277, premium: 97.05, fees: 2.95,
    legs: [["BTC-20261009-83000-C", 0.04277], ["BTC-20261009-89000-C", -0.04277]] });

  it("shows the combined figures with the trade, from the board's legs and the budget's total", () => {
    const t = budgetTicket(level, "no", 100, btc);
    const prop = proposalLegs(level, "no", t);
    expect(prop.legs.map((l) => [l.kind, l.strike, Math.sign(l.qty)])).toEqual([["P", 86000, 1], ["P", 80000, -1]]);
    expect(prop.cost).toBeCloseTo(t.mostLose, 9);
    const [g] = exposureGroups([held], NOW);
    const w = withTrade(g, prop);
    expect(w.held.mostLose).toBeCloseTo(100, 9);
    expect(w.after.cost).toBeCloseTo(100 + t.mostLose, 9);
    // Combined, the worst case is below the two amounts added up: they pay at different prices.
    expect(w.after.mostLose).toBeLessThan(100 + t.mostLose);
    expect(w.after.mostLose).toBeCloseTo(-Math.min(...[80000, 83000, 86000, 89000].map(w.after.pl)), 9);
    expect(w.after.mostPays).toBeCloseTo(Math.max(t.payout, 0.04277 * 6000, ...[83000, 86000].map((S) => w.after.pl(S) + w.after.cost)), 6);
    expect(w.addsToMostLose).toBeCloseTo(w.after.mostLose - 100, 9);
  });

  it("a trade that offsets what is held lowers the combined worst case", () => {
    const lv = findLevel(btc, "BTC-20261009-A-83000-89000").level;
    const t = budgetTicket(lv, "no", 100, btc);
    const [g] = exposureGroups([held], NOW);
    const w = withTrade(g, proposalLegs(lv, "no", t));
    // Higher and Lower on one level: whatever the price, the pair pays the smaller payout in full.
    expect(w.after.mostLose).toBeLessThan(100 + t.mostLose);
    expect(w.after.mostPays).toBeCloseTo(Math.max(0.04277, t.contracts) * 6000, 6);
  });
});
