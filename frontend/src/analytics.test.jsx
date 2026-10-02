import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { conePath, readingState } from "./lib/analytics.js";
import { Conditions, FlowCoverage, ModelDetails } from "./components/AnalyticalDetails.jsx";
import AlignmentGrid from "./components/Alignment.jsx";

afterEach(cleanup);

it("anchors both range edges to the option snapshot and retains the exact expiry", () => {
  const at = 1_791_000_037, expiry = at + 3 * 86400 + 123;
  const implied = [{ expiry, days: 3, q: [102, 105, 110, 115, 120] }];
  const lower = conePath(implied, at, 100, 7, 1);
  const upper = conePath(implied, at, 100, 7, 3);
  expect(lower).toEqual([{ time: at, value: 100 }, { time: expiry, value: 105 }]);
  expect(upper[1]).toEqual({ time: expiry, value: 115 });
  expect(conePath(implied, null, 100, 7, 1)).toEqual([]);
});

it("does not relabel missing or stale engine evidence as neutral", () => {
  const now = Date.now() / 1000;
  expect(readingState({ state: "neutral", status: "unavailable", observed_at: now }, "engine", now)).toBeNull();
  expect(readingState({ state: "neutral", status: "ready", observed_at: now - 20000, timeframe: "4h" }, "engine", now)).toBeNull();
  const row = { engine: { state: null, signal: "WAIT", status: "unavailable", observed_at: now, timeframe: "4h" }, options: {}, wallets: {} };
  render(<AlignmentGrid alignment={{ version: 2, horizons: { "7d": row, "30d": row } }} />);
  expect(screen.queryByText("Neutral")).toBeNull();
  expect(screen.queryByText("Next 7 days")).toBeNull();
  expect(screen.getByText("7d tenor · 24h flow")).toBeTruthy();
});

it("lets the reader inspect unknown evidence and its explanation", async () => {
  render(<Conditions row={{ conditions_detail: [{ name: "no_climax", label: "No Climax", available: false,
    met: false, desc: "Insufficient traded volume", source: "derive_perp_volume", freshness: "thin" }] }} />);
  await userEvent.setup().click(screen.getByText("Inspect conditions · 0 / 1 available"));
  expect(screen.getByText("Unknown")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "About No Climax" }));
  expect(screen.getByRole("dialog").textContent).toContain("Insufficient traded volume");
});

it("shows collection coverage separately from recorded activity", () => {
  render(<FlowCoverage coverage={{ ready: false, fraction: .25, end: 1791000000 }} />);
  expect(screen.getByText(/Partial collection · 25.0% of window/)).toBeTruthy();
});

it("discloses ATM model fallback and its reason", async () => {
  render(<ModelDetails implied={[{ expiry: 1791000000, method: "atm", quality: { status: "invalid_curve" } }]} />);
  await userEvent.setup().click(screen.getByText("Range models · 1 / 1 use ATM fallback"));
  expect(screen.getByText("ATM fallback")).toBeTruthy();
  expect(screen.getByText("Smile failed price-curve checks")).toBeTruthy();
});
