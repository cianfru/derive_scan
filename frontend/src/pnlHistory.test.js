import { describe, it, expect } from "vitest";
import { rangeSeries, readingAt, pointAt } from "./lib/pnlHistory.js";

const history = [["2026-01-01", 0, 0], ["2026-03-01", 1000, 4000], ["2026-09-20", 1500, 6000], ["2026-10-02", 900, 9000]];

describe("trader P&L history", () => {
  it("All runs from the first trade day to the history's last day and ends at the total", () => {
    const s = rangeSeries(history, "2026-10-05", null);
    expect(s.points[0]).toMatchObject({ day: "2026-01-01", pnl: 0 });
    expect(s.points.at(-1)).toMatchObject({ day: "2026-10-05", pnl: 900 });
    const r = readingAt(s, s.points.at(-1));
    expect(r.change).toBe(900);
    expect(r.ret).toBeCloseTo(900 / 9000);
  });

  it("a range starts from the value it had then, so its change and return cover only that range", () => {
    const s = rangeSeries(history, "2026-10-05", 30);
    expect(s.base).toEqual({ pnl: 1000, prem: 4000 });  // the 1 March value carries to 5 September
    expect(s.points.map((p) => p.day)).toEqual(["2026-09-05", "2026-09-20", "2026-10-02", "2026-10-05"]);
    const r = readingAt(s, s.points.at(-1));
    expect(r.change).toBe(-100);
    expect(r.ret).toBeCloseTo(-100 / 5000);
    expect(r.total).toBe(900);
  });

  it("P&L holds between settlement days under the pointer", () => {
    const s = rangeSeries(history, "2026-10-05", null);
    expect(pointAt(s, Date.parse("2026-06-01T00:00:00Z") / 1000)).toBe(1);  // still the 1 March value
  });

  it("no history means no chart", () => {
    expect(rangeSeries([], "2026-10-05", null)).toBeNull();
  });
});
