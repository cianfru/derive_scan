import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useData } from "./lib/data.js";
import { PageHead } from "./components/ui.jsx";
import Options from "./pages/Options.jsx";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("keeps cached data visible and reports a failed refresh", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ value: "Last reading" }) })
    .mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  function Page() {
    const { data, error } = useData("refresh-regression.json", 61000);
    return <><PageHead title="Data" error={error} /><p>{data?.value}</p></>;
  }
  render(<Page />);
  await act(async () => {});
  expect(screen.getByText("Last reading")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(61000));
  expect(screen.getByText("Last reading")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/Refresh failed/);
});

it("marks options stale against the current time when the entire publication is old", async () => {
  vi.useFakeTimers(); vi.setSystemTime(100000000);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    generated_at: 90000,
    coins: [{ und: "BTC", price: 80000, options: { status: "ready", ts: 90000,
      option_oi_contracts: 1, atm_iv_30d: 0.5, rr25_30d: 0, levels: {} } }],
  }) })));
  render(<MemoryRouter><Options /></MemoryRouter>);
  await act(async () => {});
  expect(screen.getByRole("link", { name: "Open BTC options" }).textContent).toMatch(/as of/);
});
