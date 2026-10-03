import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { viewReading } from "./lib/presentation.js";
import { openMarketRow } from "./lib/explain.js";
import CohortExplorer from "./components/CohortExplorer.jsx";
import FlowSummary from "./components/FlowSummary.jsx";
import { Reading } from "./components/MarketVisuals.jsx";
import FearGreed from "./components/FearGreed.jsx";

afterEach(cleanup);
it("shows the exact daily signal even when the short-window legacy engine disagrees", () => {
  const now = Date.now() / 1000;
  const alignment = {
    version: 2,
    readings: {
      "7d": {
        engine: {
          status: "ready",
          state: "up",
          signal: "STRONG_LONG",
          timeframe: "4h",
          observed_at: now,
        },
      },
      "30d": {
        engine: {
          status: "ready",
          state: "defensive",
          signal: "RISK_OFF",
          regime: "MARKDOWN",
          timeframe: "1d",
          observed_at: now,
        },
      },
    },
  };
  expect(viewReading(alignment, "7d", "engine", now)).toMatchObject({
    label: "Risk off",
    state: "defensive",
  });
  render(<Reading alignment={alignment} horizon="7d" kind="engine" />);
  expect(screen.getByText("Risk off")).toBeTruthy();
  expect(screen.getByText("Markdown")).toBeTruthy();
});
it("keeps the row clickable without swallowing help, links or their keyboard input", () => {
  const navigate = vi.fn();
  render(
    <div
      tabIndex={0}
      onClick={(e) => openMarketRow(e, navigate, "BTC")}
      onKeyDown={(e) => openMarketRow(e, navigate, "BTC")}
    >
      <span data-testid="price">$100</span>
      <button>Explain</button>
    </div>,
  );
  const row = screen.getByTestId("price").parentElement;
  openMarketRow(
    { type: "click", target: screen.getByTestId("price") },
    navigate,
    "BTC",
  );
  openMarketRow(
    {
      type: "keydown",
      key: "Enter",
      target: screen.getByRole("button"),
      currentTarget: row,
      preventDefault: vi.fn(),
    },
    navigate,
    "BTC",
  );
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith("/coin/BTC");
});
it("opens Money Printer exposure and changes the expiry window without changing the cohort", async () => {
  const lean = {
    score: 0.6,
    positions: 8,
    net_delta_usd: 60000,
    gross_delta_usd: 100000,
  };
  const all = { coins: { HYPE: lean }, total: lean },
    later = {
      coins: { HYPE: { ...lean, score: -0.5 } },
      total: { ...lean, score: -0.5 },
    };
  render(
    <MemoryRouter>
      <CohortExplorer
        through="2026-10-01"
        cohorts={{
          pnl: [
            {
              name: "Money Printer",
              wallets: 9,
              windows: { all, beyond30d: later },
            },
          ],
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getAllByText("Long delta")).toHaveLength(1);
  await userEvent
    .setup()
    .click(screen.getByRole("tab", { name: "Beyond 30d" }));
  expect(screen.getAllByText("Short delta")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "HYPE" }).getAttribute("href")).toBe(
    "/coin/HYPE#wallets",
  );
});
it("summarizes the recorded premium categories and selects a market for the tape", async () => {
  const choose = vi.fn();
  render(
    <FlowSummary
      data={{
        by_coin: {
          HYPE: { call: { buy_premium_usd: 80, sell_premium_usd: 20 } },
          BTC: { put: { buy_premium_usd: 50 } },
        },
      }}
      selected="all"
      onSelect={choose}
    />,
  );
  expect(screen.getByText("$150")).toBeTruthy();
  expect(screen.getByText("2 markets · 24h")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: /HYPE/ }));
  expect(choose).toHaveBeenCalledWith("HYPE");
});
it("uses the same Fear and Greed value for the dial, needle and band name", () => {
  render(
    <FearGreed sentiment={{ fear_greed_value: 72 }} at={Date.now() / 1000} />,
  );
  expect(
    screen.getByRole("img", { name: "72 out of 100, Greed" }),
  ).toBeTruthy();
  expect(screen.getByText("72")).toBeTruthy();
  expect(screen.getByText("Greed")).toBeTruthy();
});
