import { describe, expect, it } from "vitest";
import btc from "../fixtures/questions/BTC.json";
import { closeTicket, findLevel } from "./questions.js";
import { positionFigures } from "./positions.js";
import { openPnl, pctText } from "./homePnl.js";

const lv = findLevel(btc, "BTC-20261009-A-83000-89000").level;
const p = { key: "a", id: lv.id, und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
  legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both", settle_ts: 1791532800 };
const NOW = btc.prices_ts + 60;

describe("home P&L", () => {
  it("values open positions as Positions does, as one share of what was paid", () => {
    const f = positionFigures(p, { found: { level: lv }, close: closeTicket(lv, "yes", p.contracts, btc, p.legs), index: btc.index });
    const r = openPnl([p], { BTC: btc }, NOW);
    expect(r).toMatchObject({ open: 1, priced: 1 });
    expect(r.pct).toBeCloseTo(f.plNow / 103.01, 9);
  });
  it("counts what it cannot value, and says when nothing is open", () => {
    expect(openPnl([p], {}, NOW)).toMatchObject({ open: 1, priced: 0, pct: null });
    expect(openPnl([{ ...p, closed_at: NOW - 10 }], { BTC: btc }, NOW)).toMatchObject({ open: 0, pct: null });
    expect(openPnl([], {}, NOW).open).toBe(0);
    expect(pctText(0.1234)).toBe("+12.3%");
    expect(pctText(-0.03)).toBe("−3.0%");
  });
});
