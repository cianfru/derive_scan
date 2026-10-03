import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path] ?? null, error: null }) }));
vi.mock("./lib/useElementWidth.js", () => ({ useElementWidth: () => [null, 780] }));
import Radar, { RadarMap } from "./pages/Radar.jsx";
import { closeLabel } from "./lib/radarHistory.js";

const DAY = 86400;
const now = Date.now() / 1000;
const LAST = Math.floor(now / DAY) * DAY;  // the newest daily close
const closes = Array.from({ length: 30 }, (_, i) => LAST - (29 - i) * DAY);

function coin(und, z, score, gross, oi) {
  return { und, has_options: true, oi_usd: oi, price: 100, z_1d: z, spark_1d: closes.map((_, i) => 90 + i), spark_times_1d: closes,
    align: { version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: {
      "30d": { engine: { status: "ready", state: "up", signal: "LIGHT_LONG", timeframe: "1d", observed_at: LAST, regime: "MARKUP" },
        wallets: { status: "ready", state: "up", valuation_at: now - 60, score, gross_delta_usd: gross, gross_complete: true, positions: 9, estimated_positions: 0, missing_positions: 0 },
        options: { status: "ready", state: "neutral", observed_at: now - 60 } },
      "7d": {} } } };
}
const markets = { generated_at: now, coins: [coin("BTC", 1.3, 0.29, 6e7, 3), coin("ETH", 1.2, 0.25, 1e7, 2), { ...coin("ADA", 1.6, 0, 1, 1), align: { version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: { "30d": { engine: { status: "ready", state: "up", signal: "LIGHT_LONG", timeframe: "1d", observed_at: LAST } } } } }] };
const radar = { version: 1, generated_at: now, through: "x", cohort: "smart", closes, coins: {
  BTC: { z: closes.map((_, i) => 1 + i / 100), w: { "30d": closes.map((_, i) => (i === 10 ? null : [0.1 + i / 100, 2e7 + i, i === 20 ? 3 : 2])), "7d": closes.map(() => null) }, e: "-".repeat(28) + "uu" },
  ETH: { z: closes.map(() => 1.1), w: { "30d": closes.map(() => [0.4, 5e6, 2]), "7d": closes.map(() => null) }, e: "-".repeat(30) },
  ADA: { z: closes.map(() => 1.5), w: { "30d": closes.map(() => null), "7d": closes.map(() => null) }, e: "-".repeat(30) },
} };
const show = () => render(<MemoryRouter initialEntries={["/radar"]}><Radar /></MemoryRouter>);
const slider = () => screen.getByRole("slider", { name: "Close" });
const readout = () => document.querySelector(".rp-when").textContent;

beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false })));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("radar without history", () => {
  it("renders as before: no trails, no Replay", () => {
    docs.current = { "markets.json": markets };
    show();
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull();
    expect(document.querySelector(".radar-trails")).toBeNull();
    expect(document.querySelector(".rd-hist")).toBeNull();
    expect(screen.getByText("2/3")).toBeTruthy();
  });
});

describe("radar replay", () => {
  it("opens at now, steps whole closes with the keys, and the rail follows the playhead", () => {
    docs.current = { "markets.json": markets, "radar.json": radar };
    show();
    expect(document.querySelectorAll(".radar-trail").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(slider().getAttribute("aria-valuetext")).toBe("Now");
    expect(readout()).toBe("Now");
    fireEvent.keyDown(slider(), { key: "Home" });
    expect(slider().getAttribute("aria-valuetext")).toBe(`${closeLabel(closes[0])} close`);
    expect(readout()).toBe(closeLabel(closes[0]));
    expect(document.querySelector(".rd-price").textContent).toBe(`${closeLabel(closes[0])} close $90.00`);
    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(slider().value).toBe("1");
    // 9 Sep-style past frames: BTC and ETH on the map, ADA on the strip with its past stretch, both grey.
    expect(screen.getByText("2/3")).toBeTruthy();
    expect(document.querySelector(".radar-strip text").textContent).toBe("ADA");
    for (let i = 0; i < 9; i++) fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(slider().value).toBe("10");
    expect(screen.getByText("1/3")).toBeTruthy();  // BTC has no wallet reading at that close
    fireEvent.keyDown(slider(), { key: "End" });
    expect(readout()).toBe("Now");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Replay" })).toBeTruthy();
  });

  it("plays from the first close to now in one tween and stops there", () => {
    docs.current = { "markets.json": markets, "radar.json": radar };
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    show();
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    fireEvent.click(screen.getByRole("button", { name: "Play the last 30 closes" }));
    const seen = [];
    for (let ms = 0; frames.length; ms += 225) {
      act(() => frames.shift()(ms));
      seen.push(+slider().value);
      if (seen.length > 200) break;
    }
    expect(seen[0]).toBe(0);
    expect(seen.some((v) => !Number.isInteger(v))).toBe(true);
    expect(seen.at(-1)).toBe(30);
    expect(seen.length).toBe(61);  // 450 ms per close
    expect(readout()).toBe("Now");
    expect(screen.getByRole("button", { name: "Play the last 30 closes" })).toBeTruthy();
  });

  it("with reduced motion steps one whole close at a time, without a tween", () => {
    docs.current = { "markets.json": markets, "radar.json": radar };
    vi.stubGlobal("matchMedia", (q) => ({ matches: q.includes("reduce") }));
    vi.useFakeTimers();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    fireEvent.click(screen.getByRole("button", { name: "Play the last 30 closes" }));
    expect(slider().value).toBe("0");
    const seen = [];
    for (let i = 0; i < 31; i++) { act(() => vi.advanceTimersByTime(700)); seen.push(+slider().value); }
    expect(seen.slice(0, 3)).toEqual([1, 2, 3]);
    expect(seen.every(Number.isInteger)).toBe(true);
    expect(seen.at(-1)).toBe(30);
    expect(readout()).toBe("Now");
  });

  it("its help has no forecast words, never names a cohort size, and ends as context", () => {
    docs.current = { "markets.json": markets, "radar.json": radar };
    show();
    fireEvent.click(screen.getByRole("button", { name: "About Radar" }));
    const text = screen.getByRole("dialog").textContent;
    expect(text).toMatch(/Replay steps through the last 30/);
    expect(text).not.toMatch(/\b(will|expect|likely|predict|target|probability|odds|forecast|Larsson|Reflex)\b/i);
    expect(text).not.toMatch(/\b50\b/);
    expect(text.trim().endsWith("Context, not a signal.")).toBe(true);
  });
});

describe("radar labels", () => {
  it("keep the side they were given at the last whole close", () => {
    const c = (und) => ({ und });
    const pts = (eth) => [{ coin: c("BTC"), x: 1, y: 0.3, gross: 100 }, { coin: c("ETH"), ...eth, gross: 90 }];
    const anchor = pts({ x: -1, y: -0.5 });
    const between = pts({ x: 1.2, y: 0.31 });  // ETH has moved onto BTC's label spot
    const offsets = (points, labelPoints) => {
      const { container, unmount } = render(<RadarMap points={points} labelPoints={labelPoints} focus={null} onSelect={() => {}} />);
      const out = Object.fromEntries([...container.querySelectorAll(".radar-point")].map((g) => {
        const dot = g.querySelector(".radar-dot"), t = g.querySelector("text");
        return [t.textContent, [Math.round(+t.getAttribute("x") - +dot.getAttribute("cx")), Math.round(+t.getAttribute("y") - +dot.getAttribute("cy"))]];
      }));
      unmount();
      return out;
    };
    const kept = offsets(between, anchor);
    expect(kept).toEqual(offsets(anchor, anchor));
    // Placed afresh at that position, the labels would change side.
    expect(offsets(between, null)).not.toEqual(kept);
  });
});
