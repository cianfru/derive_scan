import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  KINDS, TRADE_LIMITS, amountText, capCheck, checkQuote, contractsFor, feeCeiling, instrumentName, maxTotalCost,
  minTotalCost, packageCost, packageLegs, parseInstrument, payWidth, payoffAt, rfqFee, strikeText, toleranceFor,
  validateLegs, wireLegs,
} from "./package.js";

const BTC = { und: "BTC", expiry: "20261009" };
const grid = (lo, hi, n = 400) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);

describe("the 2.2 example: $100 of Yes on BTC above $86,000 (83,000/89,000)", () => {
  const legs = packageLegs({ ...BTC, kind: "yes", lo: 83000, hi: 89000 });
  it("is 0.04407 contracts at the board's 2,269 per contract", () => {
    expect(contractsFor(100, 2269 / 6000, 6000, 0.00001)).toBe(0.04407);
  });
  it("costs $1.62 in RFQ fees: one $0.50 base and one leg group", () => {
    const fee = rfqFee(legs, 0.04407, { index: 84823.1 }, { "BTC-20261009-83000-C": 2431, "BTC-20261009-89000-C": 162 });
    expect(fee.toFixed(2)).toBe("1.62");
  });
  it("buys the lower call and sells the upper one", () => {
    expect(legs.map((l) => [l.instrument_name, l.direction])).toEqual([
      ["BTC-20261009-83000-C", "buy"], ["BTC-20261009-89000-C", "sell"]]);
  });
});

describe("packages", () => {
  const args = { ...BTC, lo: 84000, hi: 86000, step: 1000 };
  it("are debit forms only: no answer ever owes anything at settlement", () => {
    for (const kind of KINDS) {
      const legs = packageLegs({ ...args, kind });
      for (const S of grid(70000, 100000)) expect(payoffAt(legs, S)).toBeGreaterThanOrEqual(-1e-9);
      // and each pays at most its width per contract
      expect(Math.max(...grid(70000, 100000).map((S) => payoffAt(legs, S)))).toBeCloseTo(payWidth({ ...args, kind }), 6);
    }
  });
  it("have unique legs, one currency, one expiry, sorted by name", () => {
    for (const kind of KINDS) {
      const legs = packageLegs({ ...args, kind });
      expect(validateLegs(legs)).toBe(true);
      expect(new Set(legs.map((l) => l.instrument_name)).size).toBe(legs.length);
    }
    expect(() => validateLegs([{ instrument_name: "BTC-20261009-1000-C" }, { instrument_name: "ETH-20261009-1000-C" }])).toThrow(/currencies/);
    expect(() => validateLegs([{ instrument_name: "BTC-20261009-1000-C" }, { instrument_name: "BTC-20261016-2000-C" }])).toThrow(/expiries/);
    expect(() => validateLegs([{ instrument_name: "BTC-20261009-2000-C" }, { instrument_name: "BTC-20261009-1000-C" }])).toThrow(/order/);
  });
  it("Yes and No add up to the width at every price", () => {
    const y = packageLegs({ ...args, kind: "yes" }), n = packageLegs({ ...args, kind: "no" });
    for (const S of grid(70000, 100000)) expect(payoffAt(y, S) + payoffAt(n, S)).toBeCloseTo(2000, 6);
  });
  it("Inside and Outside add up to $1 per $1 at every price", () => {
    const i = packageLegs({ ...args, kind: "inside" }), o = packageLegs({ ...args, kind: "outside" });
    for (const S of grid(70000, 100000)) expect((payoffAt(i, S) + payoffAt(o, S)) / 1000).toBeCloseTo(1, 9);
  });
  it("hold a butterfly's body at twice the amount", () => {
    const legs = packageLegs({ ...BTC, kind: "inside", lo: 85000, hi: 85000, step: 1000 });
    expect(legs.map((l) => [l.instrument_name, l.direction, l.mult])).toEqual([
      ["BTC-20261009-84000-C", "buy", 1], ["BTC-20261009-85000-C", "sell", 2], ["BTC-20261009-86000-C", "buy", 1]]);
    expect(wireLegs(legs, 0.04).map((l) => l.amount)).toEqual(["0.04", "0.08", "0.04"]);
  });
  it("keep Derive's underscore: 1_35 round-trips", () => {
    expect(strikeText(1.35)).toBe("1_35");
    expect(instrumentName("XRP", "20260828", 1.35, "P")).toBe("XRP-20260828-1_35-P");
    expect(parseInstrument("XRP-20260828-1_35-P")).toEqual({ und: "XRP", expiry: "20260828", strike: 1.35, type: "P" });
    expect(strikeText(85000)).toBe("85000");
  });
  it("writes amounts as plain decimals", () => {
    expect(amountText(0.04407)).toBe("0.04407");
    expect(amountText(1e-5)).toBe("0.00001");
    expect(() => amountText(0)).toThrow();
  });
});

describe("limits on price", () => {
  it("never let the ceiling exceed 99c per $1", () => {
    expect(maxTotalCost(1000, 0.98, 0.02)).toBe(990);
    expect(maxTotalCost(1000, 0.995, 0.03)).toBe(990);
    expect(maxTotalCost(264.42, 0.3782, toleranceFor(false))).toBeCloseTo(105.29, 2);
  });
  it("never let the floor drop below 1c per $1", () => {
    expect(minTotalCost(1000, 0.02, 0.03)).toBe(10);
    expect(minTotalCost(1000, 0.3463, 0.02)).toBe(326.3);
  });
  it("uses 2c for BTC and ETH and 3c for thin coins", () => {
    expect(toleranceFor(false)).toBe(0.02);
    expect(toleranceFor(true)).toBe(0.03);
  });
  it("caps Derive's fee at the estimate x 1.5 + $0.50", () => {
    expect(feeCeiling(1.62)).toBeCloseTo(2.93, 6);
  });
  it("prices a package from a quote's legs", () => {
    expect(packageCost([{ instrument_name: "a", direction: "buy", price: "2400", amount: "0.04407" },
      { instrument_name: "b", direction: "sell", price: "160", amount: "0.04407" }])).toBeCloseTo(98.7168, 4);
  });
});

describe("quote checks", () => {
  const base = { is_valid: true, estimated_total_cost: "100.00", estimated_fee: "1.62", suggested_max_fee: "2.10", pre_initial_margin: "500", post_initial_margin: "500" };
  const ctx = { direction: "buy", payout: 264.42, limit: 105.29, feeEstimate: 1.62 };
  it("passes a quote inside the ceiling and shows the most you can lose", () => {
    const c = checkQuote(base, ctx);
    expect(c.ok).toBe(true);
    expect(c.mostLose).toBeCloseTo(101.62, 6);
    expect(c.perDollar).toBeCloseTo(100 / 264.42, 6);
  });
  it("refuses a quote beyond the ceiling", () => expect(checkQuote({ ...base, estimated_total_cost: "113.70" }, ctx).reason).toBe("beyond"));
  it("refuses a quote below the floor when selling", () => {
    expect(checkQuote({ ...base, estimated_total_cost: "80" }, { ...ctx, direction: "sell", limit: 90 }).reason).toBe("beyond");
    const c = checkQuote({ ...base, estimated_total_cost: "95" }, { ...ctx, direction: "sell", limit: 90 });
    expect(c.ok).toBe(true);
    expect(c.net).toBeCloseTo(93.38, 6);
  });
  it("refuses a quote that would lock margin", () => expect(checkQuote({ ...base, post_initial_margin: "460" }, ctx).reason).toBe("margin"));
  it("refuses a fee above the ceiling", () => expect(checkQuote({ ...base, suggested_max_fee: "3.10" }, ctx).reason).toBe("fee"));
  it("passes Derive's own invalid reason through", () => expect(checkQuote({ ...base, is_valid: false, invalid_reason: "x" }, ctx)).toMatchObject({ ok: false, reason: "invalid" }));
  it("handles no quote", () => expect(checkQuote(null, ctx).reason).toBe("no_quote"));
});

describe("caps", () => {
  it("are $250 per answer on mainnet, $1,000 on testnet, $1,000 a day", () => {
    expect(capCheck(260, { testnet: false })).toMatchObject({ ok: false, reason: "per_answer", cap: 250 });
    expect(capCheck(260, { testnet: true }).ok).toBe(true);
    expect(capCheck(200, { boughtToday: 900, testnet: false })).toMatchObject({ ok: false, reason: "per_day", left: 100 });
    expect(TRADE_LIMITS.perDay).toBe(1000);
  });
});

it("nothing in lib/trade's pure modules touches the network", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const f of ["package.js", "config.js"]) {
    const src = readFileSync(join(here, f), "utf8");
    expect(src).not.toMatch(/fetch\(|WebSocket|XMLHttpRequest|import\(/);
  }
  expect(readdirSync(here)).toContain("package.js");
});
