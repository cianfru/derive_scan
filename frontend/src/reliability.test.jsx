import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, renderHook, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell.jsx";
import HistoryStatus, { coverageReady } from "./components/HistoryStatus.jsx";
import AlignmentGrid, { AlignSquares } from "./components/Alignment.jsx";
import { useData } from "./lib/data.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("scrollTo", vi.fn(() => Promise.resolve()));
});

describe("route reliability", () => {
  it("navigates and unmounts in StrictMode when scrollTo returns a Promise", async () => {
    const user = userEvent.setup();
    const result = render(<React.StrictMode><MemoryRouter><Routes><Route element={<Shell />}>
      <Route index element={<h1>Landing view</h1>} />
      <Route path="markets" element={<h1>Markets view</h1>} />
      <Route path="traders" element={<h1>Traders view</h1>} />
    </Route></Routes></MemoryRouter></React.StrictMode>);
    await user.click(screen.getByRole("link", { name: "Markets" }));
    expect(screen.getByRole("heading", { name: "Markets view" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Traders" }));
    expect(screen.getByRole("heading", { name: "Traders view" })).toBeTruthy();
    expect(() => result.unmount()).not.toThrow();
  });

  it("contains a failed view and recovers through navigation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const expectedError = (event) => { if (event.error?.message === "bad data") event.preventDefault(); };
    window.addEventListener("error", expectedError);
    function Broken() { throw new Error("bad data"); }
    render(<MemoryRouter><Routes><Route element={<Shell />}>
      <Route index element={<Broken />} />
      <Route path="markets" element={<h1>Markets recovered</h1>} />
    </Route></Routes></MemoryRouter>);
    expect(screen.getByRole("alert").textContent).toContain("couldn’t load");
    await userEvent.setup().click(screen.getByRole("link", { name: "Markets" }));
    expect(screen.getByRole("heading", { name: "Markets recovered" })).toBeTruthy();
    window.removeEventListener("error", expectedError);
  });
});

it("explains incomplete coverage instead of claiming flat or neutral", async () => {
  const coverage = { ready: false, status: "backfilling", through: "2025-06-13", expected_through: "2026-10-01" };
  render(<HistoryStatus data={coverage} />);
  expect(screen.getByRole("status").textContent).toContain("2025-06-13");
  expect(screen.getByRole("status").textContent).toContain("2026-10-01");
  await userEvent.setup().click(screen.getByRole("button", { name: "About wallet history coverage" }));
  expect(screen.getByRole("dialog").textContent).toContain("does not mean a wallet is flat");
  expect(coverageReady({ ready: true })).toBe(false);
});

it("keeps engine and options visible while withholding incomplete wallet readings", () => {
  const now = Date.now() / 1000;
  const row = { engine: { state: "up", signal: "LIGHT_LONG", status: "ready", observed_at: now, timeframe: "4h" }, options: { state: "defensive", status: "ready", observed_at: now }, wallets: { state: "up" } };
  render(<AlignmentGrid alignment={{ version: 2, horizons: { "7d": row, "30d": row }, positions_through: "2025-06-13",
    wallet_coverage: { ready: false, status: "backfilling" } }} />);
  expect(screen.getAllByText("Building history")).toHaveLength(2);
  expect(screen.getAllByText("Defensive tone")).toHaveLength(2);
});

it("labels compact alignment readings with their actual meanings", () => {
  const now = Date.now() / 1000;
  render(<AlignSquares a={{ version: 2, readings: { "30d": { engine: {state:"up",status:"ready",timeframe:"1d",observed_at:now} }, "7d": { engine: { state: "up", status: "ready", timeframe: "4h", observed_at: now }, options: { state: "neutral", status: "ready", observed_at: now } } } }} />);
  expect(screen.getByLabelText(/7-day options: Daily engine: Up, Option prices: Neutral, Smart wallets: history incomplete/)).toBeTruthy();
});

it("never shows the previous wallet while a new wallet request loads or fails", async () => {
  let rejectSecond;
  vi.stubGlobal("fetch", vi.fn((url) => String(url).endsWith("review-a.json")
    ? Promise.resolve({ ok: true, json: async () => ({ address: "alice" }) })
    : new Promise((resolve, reject) => { rejectSecond = reject; })));
  const { result, rerender } = renderHook(({ path }) => useData(path), { initialProps: { path: "review-a.json" } });
  await waitFor(() => expect(result.current.data?.address).toBe("alice"));
  rerender({ path: "review-b.json" });
  expect(result.current.data).toBeNull();
  await act(async () => { rejectSecond(new Error("offline")); });
  expect(result.current.data).toBeNull();
  expect(result.current.error.message).toBe("offline");
});
