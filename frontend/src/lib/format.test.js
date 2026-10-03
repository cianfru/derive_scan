import { describe, it, expect } from "vitest";
import { price, strike, usd, pct, chg, z, optionLabel, sig3, DASH } from "./format.js";

describe("format", () => {
  it("sig3: three significant figures, grouped", () => {
    expect(sig3(7835.6)).toBe("7,840");
    expect(sig3(347.51)).toBe("348");
    expect(sig3(14.64)).toBe("14.6");
    expect(sig3(0.04751)).toBe("0.0475");
    expect(sig3(null)).toBe(DASH);
  });
  it("price: decimals by magnitude, grouping, dash for missing", () => {
    expect(price(84566.5)).toBe("84,567");
    expect(price(2681.2)).toBe("2,681.2");
    expect(price(4138)).toBe("4,138");
    expect(price(88.019)).toBe("88.02");
    expect(price(1.483)).toBe("1.48");
    expect(price(0.2446)).toBe("0.2446");
    expect(price(0.005535)).toBe("0.0055");
    expect(price(0.5)).toBe("0.50");
    expect(price(null)).toBe(DASH);
    expect(price(NaN)).toBe(DASH);
  });
  it("strike: whole from 100, trimmed below", () => {
    expect(strike(2000)).toBe("$2,000");
    expect(strike(85)).toBe("$85");
    expect(strike(1.5)).toBe("$1.5");
    expect(strike(0.25)).toBe("$0.25");
    expect(strike(82000, "")).toBe("82,000");
    expect(strike(undefined)).toBe(DASH);
  });
  it("usd: compact K/M/B without trailing zeros", () => {
    expect(usd(512)).toBe("$512");
    expect(usd(12000)).toBe("$12K");
    expect(usd(12540)).toBe("$12.5K");
    expect(usd(3450000)).toBe("$3.45M");
    expect(usd(3400000)).toBe("$3.4M");
    expect(usd(-1.2e9)).toBe("-$1.2B");
    expect(usd(null)).toBe(DASH);
  });
  it("pct, chg and z", () => {
    expect(pct(0.123)).toBe("12.3%");
    expect(pct(0.12)).toBe("12%");
    expect(pct(null)).toBe(DASH);
    expect(chg(1.234)).toBe("+1.23%");
    expect(chg(-0.4)).toBe("-0.40%");
    expect(z(1.2345)).toBe("1.23σ");
    expect(z(undefined)).toBe(DASH);
  });
  it("optionLabel parses Derive option names", () => {
    const o = optionLabel("BTC-20261009-82000-C");
    expect(o).toMatchObject({ und: "BTC", strike: 82000, type: "call", expiry: "2026-10-09", expiryLabel: "Oct 09" });
    expect(o.display).toBe("BTC 82,000 call · Oct 09");
    expect(optionLabel("DOGE-20261030-0_25-P").display).toBe("DOGE 0.25 put · Oct 30");
    expect(optionLabel("BTC-PERP").display).toBe("BTC-PERP");
  });
});

import { dayTime, clock } from "./format.js";
it("dayTime and clock", () => {
  expect(dayTime(1790985600)).toBe("3 Oct 00:00 UTC");
  expect(clock(1791022843)).toBe("10:20 UTC");
});
