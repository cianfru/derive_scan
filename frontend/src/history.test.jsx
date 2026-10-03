import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MetricHistory from "./components/MetricHistory.jsx";
import { dailyHistory, historyGeometry, historyWindow, nearestObservation, orderedHistory } from "./lib/history.js";

const DAY = 86400;
const now = Date.parse("2026-10-03T12:00:00Z") / 1000;
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(now * 1000));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("history geometry", () => {
  it("uses elapsed time and breaks at missing values, absent intervals and source changes", () => {
    const rows = [
      { ts: 0, value: 1, source: "reconstructed" },
      { ts: 10, value: 2, source: "reconstructed" },
      { ts: 20, value: null, source: "recorded" },
      { ts: 30, value: 3, source: "recorded" },
      { ts: 50, value: 4, source: "recorded" },
      { ts: 60, value: 5, source: "reconstructed" },
    ];
    const geometry = historyGeometry(rows, "value", 600, 230, 10);
    expect((geometry.paths.recorded.match(/M/g) || []).length).toBe(2);
    expect(geometry.paths.recorded).not.toContain(" L");
    expect((geometry.paths.reconstructed.match(/M/g) || []).length).toBe(2);
    expect(geometry.paths.reconstructed).toContain(" L");
    expect(geometry.missing).toBe(2);
    expect(geometry.isolated.map(row => row.ts)).toEqual([30, 50, 60]);
    expect(geometry.x(50) - geometry.x(30)).toBeCloseTo(2 * (geometry.x(10) - geometry.x(0)));
  });

  it("excludes future observations, retains null gaps and clips to real calendar windows", () => {
    const rows = [{ ts: now - 31 * DAY, value: 1 }, { ts: now - DAY, value: null }, { ts: now, value: 2 }, { ts: now + DAY, value: 999 }];
    expect(historyWindow(rows, "30d", now)).toEqual(rows.slice(1, 3));
    expect(orderedHistory([{ ts: null }, ...rows], now)).toHaveLength(3);
    expect(historyWindow(rows, "all", now)).toHaveLength(3);
    expect(nearestObservation(rows.slice(0, 3), now - DAY / 4)).toBe(2);
  });

  it("takes the last actual snapshot per UTC day, including missing values, and labels partial days", () => {
    const midnight = now - DAY - 43200;
    const full = Array.from({ length: 96 }, (_, i) => ({ ts: midnight + i * 900, atm_iv_30d: i === 95 ? null : .5 }));
    const today = [{ ts: now - 900, atm_iv_30d: .6 }, { ts: now, atm_iv_30d: .7 }];
    const daily = dailyHistory([...today, ...full], now);
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({ ts: midnight + 95 * 900, atm_iv_30d: null, partial_day: false, day_samples: 96 });
    expect(daily[1]).toMatchObject({ ts: now, atm_iv_30d: .7, partial_day: true, day_samples: 2 });
  });
});

const history = {
  engine: {
    "1d": [
      { ts: now - 3 * DAY, zscore: -.5, heat: 20, regime: "MARKDOWN", source: "reconstructed", status: "warming up", metric_status: { zscore: "warmup", heat: "ready" } },
      { ts: now - 2 * DAY, zscore: null, heat: null, source: "recorded", status: "unavailable" },
      { ts: now - DAY, zscore: 1, heat: 50, funding_ann: .01, oi_usd: 1000000, regime: "MARKUP", signal: "LIGHT_LONG", source: "recorded", status: "ready" },
      { ts: now, zscore: 2, heat: 60, funding_ann: .02, oi_usd: 1100000, regime: "MARKUP", signal: "STRONG_LONG", source: "recorded", status: "ready" },
    ],
    "4h": [{ ts: now, zscore: -1, heat: 30, regime: "MARKDOWN", signal: "RISK_OFF", source: "recorded", status: "ready" }],
  },
  options: [
    { ts: now - DAY, atm_iv_30d: .5, perp_funding_ann: .03, perp_oi_usd: 1200000 },
    { ts: now - 900, atm_iv_30d: .53, perp_funding_ann: .035, perp_oi_usd: 1230000 },
    { ts: now, atm_iv_30d: .55, perp_funding_ann: .04, perp_oi_usd: 1240000 },
  ],
  coverage: {
    engine: { "1d": { from: now - 3 * DAY, to: now, recorded_from: now - 2 * DAY, recorded_count: 3, reconstructed_count: 1, expected_count: 4, observed_count: 4 } },
    options: { from: now - DAY, to: now, history_available_from: now - DAY, count: 3, expected_count: 97, missing_count: 94, interval_seconds: 900 },
  },
};

it("inspects exact dated engine values by keyboard without filling the missing observation or inventing reconstructed signals", async () => {
  render(<MetricHistory history={history} />);
  const slider = screen.getByRole("slider", { name: "Price stretch history" });
  expect(slider.getAttribute("aria-valuetext")).toContain("2026-10-03 12:00 UTC: 2.00σ");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider.getAttribute("aria-valuetext")).toContain("2026-09-30 12:00 UTC: -0.50σ. Price reconstruction");
  expect(screen.getByText("Price reconstruction · Warming up")).toBeTruthy();
  expect(screen.getByText(/No recorded decision/)).toBeTruthy();
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(slider.getAttribute("aria-valuetext")).toContain("2026-10-01 12:00 UTC: Unavailable");
  await userEvent.setup().click(screen.getByRole("tab", { name: "4H" }));
  expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain("-1.00σ");
});

it("supports pointer date inspection and exposes the coverage behind its information control", async () => {
  render(<MetricHistory history={history} />);
  const slider = screen.getByRole("slider");
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({ left: 0, width: 760 });
  fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, clientX: 66 }));
  expect(slider.getAttribute("aria-valuetext")).toContain("2026-09-30");
  await userEvent.setup().click(screen.getByRole("button", { name: "About history" }));
  expect(screen.getByRole("dialog").textContent).toContain("3 recorded engine readings; 1 price reconstructions");
});

it("uses the selected measurement status rather than withholding a ready field because another field is warming", async () => {
  render(<MetricHistory history={history} />);
  await userEvent.setup().click(screen.getByRole("tab", { name: "Heat" }));
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  expect(screen.getByText("Price reconstruction")).toBeTruthy();
  expect(screen.queryByText("Price reconstruction · Warming up")).toBeNull();
  expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain(": 20.");
});

it("keeps empty or unavailable history explicit without drawing a projected series", async () => {
  render(<MetricHistory history={{ engine: {}, options: [], coverage: {} }} />);
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.getByText("No observations in this window.")).toBeTruthy();
});

it("distinguishes engine bar time from saved ticker time and rechecks wallet history dates", async () => {
  const augmented = { ...history, engine: { ...history.engine, "1d": history.engine['1d'].map(row => ({ ...row, positioning_at: row.ts - 300 })) },
    coverage: { ...history.coverage, wallets: { ready: true, status: 'ready', through: '2026-10-01', expected_through: '2026-10-01' } } };
  render(<MetricHistory history={augmented} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: 'Funding' }));
  expect(screen.getByText('Bar close · 2026-10-03 12:00 UTC')).toBeTruthy();
  expect(screen.getByText('Ticker observed 2026-10-03 11:55 UTC')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'About history' }));
  expect(screen.getByRole('dialog').textContent).toContain('Wallet trade history incomplete through 2026-10-01 UTC');
});

it("folds behind its head until opened", async () => {
  render(<MetricHistory history={history} collapsible />);
  expect(screen.queryByRole("slider")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "History" }));
  expect(screen.getByRole("slider", { name: "Price stretch history" })).toBeTruthy();
});
