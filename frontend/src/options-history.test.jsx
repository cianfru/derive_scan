import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  DAY, decodeSurface, movePct, termSpread, windowSlice, rankLabel, segments, pathData, rangeOf, dashboardStrips,
} from "./lib/surface.js";
import HistoryStrip from "./components/HistoryStrip.jsx";
import SurfaceHistory, { methodInfo } from "./components/SurfaceHistory.jsx";
import OptionsWorkspace, { cellInfo } from "./components/OptionsWorkspace.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LAST_DAY = Date.UTC(2026, 9, 2) / 1000;         // the newest complete UTC day
const SNAP = Date.UTC(2026, 9, 3, 13, 15) / 1000;      // the newest 15-minute snapshot
const ALL = ["atm7", "atm30", "atm90", "rr7", "rr30"];
const curve = {
  atm30: (i) => 0.45 + 0.08 * Math.sin(i / 30),
  atm7: (i) => 0.45 + 0.08 * Math.sin(i / 30) + 0.03 * Math.sin(i / 7),
  atm90: (i) => 0.47 + 0.05 * Math.sin(i / 40),
  rr30: (i) => -0.03 + 0.04 * Math.sin(i / 45),
  rr7: (i) => -0.02 + 0.05 * Math.sin(i / 20),
};
/** A published surface/{UND}.json: `days` daily values ending 2 Oct 2026, gaps on `gaps`, one recorded day. */
function surfaceDoc({ und = "BTC", days = 500, metrics = ALL, gaps = [200, 201, 202], recorded = true } = {}) {
  const day0 = LAST_DAY - (days - 1) * DAY;
  const traded = Object.fromEntries(metrics.map((m) => [m, Array.from({ length: days }, (_, i) => (gaps.includes(i) ? null : Number(curve[m](i).toFixed(4))))]));
  return {
    und, version: 1, generated_at: SNAP, status: "ready", first_trade_day: "2023-12-12", day0, days,
    index: Array.from({ length: days }, () => 84000),
    traded,
    recorded: recorded ? { from: days - 1, ...Object.fromEntries(metrics.map((m) => [m, [Number((curve[m](days - 1) - 0.01).toFixed(4))]])) } : null,
    quality: Object.fromEntries(metrics.map((m) => [m, { coverage: 1, reliability: 0.95, shown: true }])),
    range_1y: { ...Object.fromEntries(metrics.map((m) => [m, rangeOf(traded[m])])), atm30: { p10: 0.38, p50: 0.45, p90: 0.52, last: 0.4, pct: 5.1 }, ...(metrics.includes("rr30") ? { rr30: { p10: -0.07, p50: -0.04, p90: 0.0, last: -0.01, pct: 88.9 } } : {}) },
    overlap: Object.fromEntries(metrics.map((m) => [m, { days: 1, median_diff: -0.01 }])),
  };
}
const a = Date.UTC(2026, 9, 30) / 1000;
function optsFixture(histDays = 1) {
  const n = Math.round((histDays * DAY) / 900);
  return {
    ts: SNAP, status: "ready", chain_status: "ready", chain_at: SNAP,
    features: { index_price: 84823.7, atm_iv_7d: 0.2725, atm_iv_30d: 0.325, atm_iv_90d: 0.3549, rr25_30d: -0.0074, rr25_7d: 0.018 },
    expiries: [{ expiry: a, tenor_days: 27, atm_iv: 0.32, forward: 85100, call_oi: 10, put_oi: 20 }],
    strikes: { expiries: { [a]: [[85000, 10, 20, 0.32, 0.33]] } },
    implied: [{ expiry: a, q: [76000, 80000, 85000, 90000, 94000], method: "smile" }],
    iv_history: Array.from({ length: n + 1 }, (_, i) => [SNAP - (n - i) * 900, 0.27, 0.33, 0.36, -0.007, 0.02, 0.3, 0.018]),
  };
}
function stubFetch(docs) {
  const fetch = vi.fn(async (url) => {
    const und = /surface\/([A-Z]+)\.json$/.exec(url)?.[1];
    return docs[und] ? { ok: true, json: async () => docs[und] } : { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  return fetch;
}
const surfaceCalls = (fetch) => fetch.mock.calls.map(([u]) => u).filter((u) => u.includes("surface/"));

describe("surface helpers", () => {
  it("decodes the day axis and aligns recorded values at their offset", () => {
    const doc = surfaceDoc({ days: 10, gaps: [3] });
    const s = decodeSurface(doc);
    expect(s.days).toHaveLength(10);
    expect(s.days[0]).toBe(doc.day0);
    expect(s.days[9]).toBe(LAST_DAY);
    expect(s.traded.atm30[3]).toBeNull();
    expect(s.recorded.atm30.slice(0, 9).every((v) => v === null)).toBe(true);
    expect(s.recorded.atm30[9]).toBe(doc.recorded.atm30[0]);
    expect(decodeSurface({ ...doc, status: "sparse" })).toBeNull();
    expect(decodeSurface(null)).toBeNull();
  });
  it("derives the move, the term spread and windows", () => {
    expect(movePct(0.365)).toBeCloseTo(0.365 * Math.sqrt(30 / 365), 10);
    expect(movePct(null)).toBeNull();
    expect(termSpread(0.27, 0.33)).toBeCloseTo(-0.06, 10);
    expect(termSpread(null, 0.33)).toBeNull();
    const pts = Array.from({ length: 400 }, (_, i) => [i * DAY, i]);
    const end = 399 * DAY;
    expect(windowSlice(pts, "3M", end)).toHaveLength(92);
    expect(windowSlice(pts, "1Y", end)).toHaveLength(366);
    expect(windowSlice(pts, "All", end)).toHaveLength(400);
  });
  it("labels the rank by its span", () => {
    expect(rankLabel({ pct: 5.1 })).toBe("1Y: 5th pct");
    expect(rankLabel({ pct: 88.9 })).toBe("1Y: 89th pct");
    expect(rankLabel({ pct: 0.4 })).toBe("1Y: 1st pct");
    expect(rankLabel({ pct: 100 })).toBe("1Y: 99th pct");
    expect(rankLabel({ pct: 12 })).toBe("1Y: 12th pct");
    expect(rankLabel({ pct: 22.4 })).toBe("1Y: 22nd pct");
    expect(rankLabel({ pct: 73 }, 238)).toBe("8M: 73rd pct");
    expect(rankLabel(null)).toBeNull();
  });
  it("keeps gaps as gaps", () => {
    const pts = [[0, 1], [1, 2], [2, null], [3, 3], [4, 4], [5, null], [6, 5]];
    expect(segments(pts)).toHaveLength(3);
    const d = pathData(pts, (t) => t, (v) => v);
    expect(d.match(/M/g)).toHaveLength(3);
    expect(d).toContain("M6.0,5.0L6.0,5.0");
  });
  it("ranks a series as the publisher does", () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const r = rangeOf([...values, 10]);
    expect(r.last).toBe(10);
    expect(r.pct).toBeCloseTo((100 * 10) / 101, 1);
    expect(r.p50).toBe(49);
    expect(rangeOf([1, 2, 3])).toBeNull();
  });
  it("falls back to recorded snapshots only once they span two days", () => {
    expect(dashboardStrips(null, optsFixture(1.2))).toEqual({ move: null, skew: null, term: null });
    const s = dashboardStrips(null, optsFixture(2.5));
    expect(s.move.snapshots).toBe(true);
    expect(s.move.traded).toEqual([]);
    expect(s.move.rank).toBeNull();
    expect(s.term.recorded.at(-1)[1]).toBeCloseTo(0.27 - 0.33, 10);
  });
});

describe("HistoryStrip", () => {
  const series = {
    traded: [[0, 0.1], [DAY, 0.12], [2 * DAY, null], [3 * DAY, 0.11], [4 * DAY, 0.1]],
    recorded: [[0, null], [DAY, null], [2 * DAY, null], [3 * DAY, null], [4 * DAY, 0.09]],
    latest: [4 * DAY + 50000, 0.096], band: [0.095, 0.115], rank: "1Y: 5th pct",
  };
  it("draws traded and recorded as separate paths and breaks the line at a gap", () => {
    const { container } = render(<HistoryStrip series={series} label="Move history" format={(v) => v.toFixed(2)} />);
    const traded = container.querySelector(".hs-traded").getAttribute("d");
    expect(traded.match(/M/g)).toHaveLength(2);
    const recorded = container.querySelector(".hs-recorded").getAttribute("d");
    expect(recorded.match(/M/g)).toHaveLength(1);
    expect(container.querySelectorAll(".hs-dot")).toHaveLength(1);
    expect(container.querySelector(".hs-band")).toBeTruthy();
  });
  it("reads any day from the keyboard", () => {
    render(<HistoryStrip series={series} label="Move history" format={(v) => v.toFixed(2)} />);
    const strip = screen.getByRole("slider", { name: "Move history" });
    fireEvent.focus(strip);
    expect(strip.getAttribute("aria-valuetext")).toMatch(/0\.10$/);
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(strip.getAttribute("aria-valuetext")).toBe("5 Jan 1970 · 0.09 · Recorded");
    fireEvent.keyDown(strip, { key: "Home" });
    expect(strip.getAttribute("aria-valuetext")).toBe("1 Jan 1970 · 0.10");
  });
});

describe("OptionsWorkspace history", () => {
  it("keeps today's view and requests nothing without a surface file", async () => {
    const fetch = stubFetch({});
    const { container } = render(<OptionsWorkspace opts={optsFixture(1.2)} und="SOL" hasSurface={false} embedded />);
    await new Promise((r) => setTimeout(r, 20));
    expect(surfaceCalls(fetch)).toEqual([]);
    expect(container.querySelectorAll(".history-strip")).toHaveLength(0);
    expect(screen.getByText("Puts richer")).toBeTruthy();
    expect(screen.getByText("27.3%")).toBeTruthy();
  });
  it("shows the recorded strip without a surface file once snapshots span two days", () => {
    stubFetch({});
    const { container } = render(<OptionsWorkspace opts={optsFixture(3)} und="XRP" embedded />);
    expect(container.querySelectorAll(".history-strip")).toHaveLength(3);
    expect(container.querySelectorAll(".dash-rank")).toHaveLength(0);
  });
  it("loads surface/{UND}.json only when the coin has one, then draws three strips with ranks", async () => {
    const fetch = stubFetch({ ETH: surfaceDoc({ und: "ETH" }) });
    const { container } = render(<OptionsWorkspace opts={optsFixture()} und="ETH" hasSurface embedded />);
    await waitFor(() => expect(container.querySelectorAll(".history-strip")).toHaveLength(3));
    expect(surfaceCalls(fetch)).toHaveLength(1);
    expect(surfaceCalls(fetch)[0]).toMatch(/surface\/ETH\.json$/);
    expect(screen.getByText("1Y: 5th pct")).toBeTruthy();
    expect(screen.getByText("1Y: 89th pct")).toBeTruthy();
    expect(container.querySelectorAll(".dash-rank")).toHaveLength(3);
    // Today's figures stay.
    expect(screen.getAllByText("Puts richer").length).toBeGreaterThan(0);
    expect(screen.getByText("35.5%")).toBeTruthy();
  });
  it("shows no 7-day skew history for a coin without rr7, and keeps traded and recorded apart", async () => {
    stubFetch({ HYPE: surfaceDoc({ und: "HYPE", days: 238, metrics: ["atm7", "atm30", "atm90", "rr30"] }) });
    const { container } = render(<OptionsWorkspace opts={optsFixture()} und="HYPE" hasSurface embedded />);
    await waitFor(() => expect(container.querySelectorAll(".history-strip")).toHaveLength(3));
    expect(screen.getByText("8M: 89th pct")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Volatility history/ }));
    const chart = container.querySelector(".surface-history");
    expect(chart).toBeTruthy();
    expect(within(chart).queryByText(/7d skew|7-day skew/i)).toBeNull();
    expect(container.textContent).not.toMatch(/7d skew|7-day skew|rr7/i);
    // One thin and one thick path per tenor plus the skew; never one joined path.
    expect(chart.querySelectorAll("path.sh-traded")).toHaveLength(4);
    expect(chart.querySelectorAll("path.sh-recorded")).toHaveLength(4);
    for (const p of chart.querySelectorAll("path.sh-recorded")) expect(p.getAttribute("d").match(/M/g)).toHaveLength(1);
    expect(within(chart).getByText("From traded options")).toBeTruthy();
    expect(within(chart).getByText("Recorded")).toBeTruthy();
  });
  it("switches the long view between 3M, 1Y and All", () => {
    const s = decodeSurface(surfaceDoc({ days: 800 }));
    const { container } = render(<SurfaceHistory surface={s} opts={optsFixture()} />);
    const slider = container.querySelector("svg[role=slider]");
    const stops = () => Number(slider.getAttribute("aria-valuemax")) + 1;
    expect(stops()).toBe(364 + 1);
    fireEvent.click(screen.getByRole("tab", { name: "3M" }));
    expect(stops()).toBe(90 + 1);
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(stops()).toBe(800 - 3 + 1);
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^3 Oct 13:15 UTC: 7d 27\.3%, 30d 32\.5%, 90d 35\.5%, 30d skew Puts richer 0\.7 pts$/);
  });
});

describe("copy", () => {
  const BANNED = /\b(will|expect|expects|expected|likely|predict|predicts|prediction|target|targets|probability|odds|forecast|Larsson|Reflex)\b/i;
  it("no (i) string in the options workspace uses forecast words", async () => {
    stubFetch({ BTC: surfaceDoc({ und: "BTC" }) });
    const { container } = render(<OptionsWorkspace opts={optsFixture()} und="BTC" hasSurface embedded />);
    await waitFor(() => expect(container.querySelectorAll(".history-strip")).toHaveLength(3));
    const texts = [methodInfo(null), methodInfo(decodeSurface(surfaceDoc()))];
    for (const kind of ["move", "skew", "term"]) for (const mode of ["surface", "snapshots", null]) texts.push(cellInfo(kind, mode));
    for (const tab of ["Expiry & strikes", "Priced ranges", "Trade flow", "Volatility history"]) {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab) }));
      for (const button of container.querySelectorAll("button.info")) {
        fireEvent.click(button);
        const dialog = screen.getByRole("dialog");
        texts.push(dialog.textContent);
        fireEvent.click(button);
      }
    }
    expect(texts.length).toBeGreaterThan(15);
    for (const t of texts) expect(t, t).not.toMatch(BANNED);
    expect(texts.join(" ")).toContain("Market pricing, not our view.");
    expect(methodInfo(decodeSurface(surfaceDoc()))).toContain("On the one day both exist, the 30-day reading from traded options sat 1.0 volatility points above the recorded quotes (median).");
    expect(methodInfo(null)).not.toContain("both exist");
  });
});
