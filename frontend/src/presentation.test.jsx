import React from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { traceGeometry, radarPoint, radarLabels, viewReading } from "./lib/presentation.js";
import { MarketTrace } from "./components/MarketVisuals.jsx";
import { RadarMap } from "./pages/Radar.jsx";

afterEach(cleanup);
const now = 1790944200;
function coin(overrides = {}) {
  return { und: "BTC", z_4h: 1.2, align: { version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: {
    "7d": { engine: { status: "ready", state: "up", timeframe: "4h", observed_at: now }, wallets: { status: "ready", state: "up", valuation_at: now, score: .6, gross_delta_usd: 50000, gross_complete: true, positions: 4, estimated_positions: 0, missing_positions: 0, ...overrides } }
  } } };
}
describe("radar eligibility", () => {
  it("separates nearby labels without moving data points", () => {
    const points = [{name: "BTC", x: 170, y: 100, r: 26}, {name: "ETH", x: 175, y: 96, r: 23}];
    const copy = structuredClone(points);
    const [a, b] = radarLabels(points, {left: 50, right: 300, top: 40, bottom: 300});
    expect(a.rect.bottom < b.rect.top || a.rect.top > b.rect.bottom || a.rect.right < b.rect.left || a.rect.left > b.rect.right).toBe(true);
    expect(points).toEqual(copy);
  });
  it("keeps exposure and headcount distinct", () => {
    expect(radarPoint(coin(), "7d", now)).toMatchObject({ x: 1.2, y: .6, gross: 50000, positions: 4 });
    expect(radarPoint(coin({ score: 0, state: "neutral" }), "7d", now)?.y).toBe(0);
  });
  it("never maps incomplete history to neutral", () => {
    const c = coin(); c.align.wallet_coverage = { ready: false, status: "backfilling" };
    expect(radarPoint(c, "7d", now)).toBeNull();
    expect(viewReading(c.align, "7d", "wallets", now)).toMatchObject({ state: null, label: "Building history" });
  });
  it("rejects expired quotes, estimated deltas and incomplete gross exposure", () => {
    expect(radarPoint(coin(), "7d", now + 1801)).toBeNull();
    for (const bad of [{ estimated_positions: 1 }, { missing_positions: 1 }, { gross_complete: false }, { score: 1.01 }, { gross_delta_usd: 0 }]) expect(radarPoint(coin(bad), "7d", now)).toBeNull();
  });
  it("requires the 4H horizontal source even for a 30-day wallet window", () => {
    const c = coin(); c.align.readings["30d"] = c.align.readings["7d"];
    c.align.readings["7d"] = { engine: { status: "thin_volume" } };
    expect(radarPoint(c, "30d", now)).toBeNull();
  });
  it("lets keyboard users select a plotted market", async () => {
    let selected;
    render(<RadarMap points={[radarPoint(coin(), "7d", now)]} focus={null} onSelect={v => { selected = v; }} />);
    await userEvent.setup().tab(); await userEvent.setup().keyboard("{Enter}");
    expect(selected).toBe("BTC");
  });
});
describe("recorded price traces", () => {
  it("preserves gaps, flat series and the first-sample baseline", () => {
    const g = traceGeometry([100, 101, null, 102], 136, 44);
    expect(g.path.match(/M/g)).toHaveLength(2); expect(g.change).toBeCloseTo(2);
    const flat = traceGeometry([100, 100], 136, 44);
    expect(flat.y(100)).toBe(22); expect(flat.change).toBe(0);
    expect(traceGeometry([null, 1], 136, 44)).toBeNull();
  });
  it("exposes exact recorded times and prices while inspecting with keys", async () => {
    render(<MarketTrace values={[100, 110, 105]} times={[now - 28800, now - 14400, now]} label="BTC price history" large />);
    const slider = screen.getByRole("slider");
    slider.focus(); await userEvent.setup().keyboard("{Home}");
    expect(slider.getAttribute("aria-valuenow")).toBe("1");
    expect(slider.getAttribute("aria-valuetext")).toContain("$100.00");
    await userEvent.setup().keyboard("{ArrowRight}");
    expect(slider.getAttribute("aria-valuetext")).toContain("$110.00");
    expect(screen.getByText("Selected close")).toBeTruthy();
  });
});
