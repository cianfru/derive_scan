import { describe, expect, it } from "vitest";
import { pnlCoverage } from "./positionsPnl.js";

const summary = (extra = {}) => ({ count: 0, unknown: 0, total: 0, estimated: 0, ...extra });
const view = (plNow, valueNow, fees_basis = "exact", pendingReceipt = false) => ({ p: { journal: { cost: { fees_basis } } }, f: { plNow, valueNow }, pendingReceipt });

describe("Positions P&L coverage", () => {
  it("keeps an unavailable realized result unknown", () => {
    expect(pnlCoverage([], summary({ count: 1, unknown: 1 }))).toMatchObject({ total: null, realized: null, incomplete: true, knownResults: 0 });
  });
  it("counts incomplete receipts and unpriced open positions in coverage", () => {
    expect(pnlCoverage([view(12, 112), view(null, null), view(25, 125, "exact", true)], summary())).toMatchObject({
      total: 12, open: 12, inPositions: 112, knownOpen: 1, unknownOpen: 2, incomplete: true,
    });
  });
  it("keeps a known value while missing entry fees prevent a P&L", () => {
    expect(pnlCoverage([view(20, 120, "unknown")], summary())).toMatchObject({ total: null, open: null, inPositions: 120, incomplete: true });
  });
  it("qualifies estimates, and combines known results without losing unknown coverage", () => {
    expect(pnlCoverage([view(12, 112, "estimated")], summary({ count: 2, unknown: 1, total: -5 }))).toMatchObject({ total: 7, realized: -5, knownResults: 1, incomplete: true, estimated: true });
    expect(pnlCoverage([], summary({ count: 1, total: 10, estimated: 1 })).estimated).toBe(true);
  });
  it("does not turn a pending settlement into a zero result", () => {
    expect(pnlCoverage([], summary(), 1)).toMatchObject({ total: null, incomplete: true, pendingSettlementCount: 1 });
  });
  it("permits a known zero and empty categories", () => {
    expect(pnlCoverage([view(0, 100)], summary())).toMatchObject({ total: 0, open: 0, realized: 0, incomplete: false });
  });
});
