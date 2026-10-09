import { describe, expect, it } from "vitest";
import { bestRanked, walletRecord } from "./smartWallets.js";

describe("smart wallet records", () => {
  it("counts won and lost settled options, the return on premium and the first month", () => {
    expect(walletRecord({ expired: 382, win_rate: 0.565, option_pnl: 10858147, premium_traded: 162177068, first: "2024-06-28" }))
      .toEqual({ settled: 382, won: 216, lost: 166, ret: 10858147 / 162177068, since: "Jun 2024", short: false });
    expect(walletRecord({ expired: 23, win_rate: 0.696 }).short).toBe(true);
    expect(walletRecord({})).toEqual({ settled: null, won: null, lost: null, ret: null, since: null, short: false });
  });

  it("names the best-ranked wallets by side", () => {
    expect(bestRanked([{ rank: 40, side: "short" }, { rank: 1, side: "long" }, { rank: 14, side: "short" }, { rank: 90, side: "long" }, { side: "long" }]))
      .toBe("#1 long · #14, #40 short");
    expect(bestRanked([{ side: "long" }])).toBe("");
  });
});
