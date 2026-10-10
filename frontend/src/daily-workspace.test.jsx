import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { viewReading } from "./lib/presentation.js";
import { openMarketRow } from "./lib/explain.js";
import CohortExplorer from "./components/CohortExplorer.jsx";
import FlowSummary from "./components/FlowSummary.jsx";
import { Reading } from "./components/MarketVisuals.jsx";
import FearGreed from "./components/FearGreed.jsx";

afterEach(cleanup);
it("reads the 4H engine for the next 7 days and the daily engine for the next 30 (owner, 5 October 2026)", () => {
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
  expect(viewReading(alignment, "7d", "engine", now)).toMatchObject({ label: "Strong up-setup", state: "up" });
  expect(viewReading(alignment, "30d", "engine", now)).toMatchObject({
    label: "Leaning down",
    state: "defensive",
  });
  render(<Reading alignment={alignment} horizon="30d" kind="engine" />);
  expect(screen.getByText("Leaning down")).toBeTruthy();
  expect(screen.getByText("Trending down")).toBeTruthy();
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
it("draws every coin with option money as a bubble and picks a market with it", async () => {
  const choose = vi.fn();
  const data = {
    by_coin: {
      HYPE: { call: { buy_premium_usd: 80, sell_premium_usd: 20 } },
      BTC: { put: { buy_premium_usd: 50 } },
    },
  };
  const { rerender } = render(<MemoryRouter><FlowSummary data={data} selected="all" onSelect={choose} /></MemoryRouter>);
  // Every option dollar, by the way it gains: HYPE $80 of calls bought (rise) and $20 sold (fall); BTC $50 of puts bought (fall).
  expect(screen.getByText("$150")).toBeTruthy();
  expect(screen.getByText("in options · 2 markets · 24h")).toBeTruthy();
  const hype = screen.getByRole("button", { name: "HYPE: $100 in options over 24 hours, 80% on a rise" });
  expect(screen.getByRole("button", { name: "BTC: $50 in options over 24 hours, 100% on a fall" })).toBeTruthy();
  await userEvent.setup().click(hype);
  expect(choose).toHaveBeenCalledWith("HYPE");
  // Picked: the coin's view, how its money splits, and a second click or All markets goes back to every market.
  rerender(<MemoryRouter><FlowSummary data={data} selected="HYPE" onSelect={choose} /></MemoryRouter>);
  const view = screen.getByRole("region", { name: "HYPE options flow" });
  const row = (label) => within(view).getByText(label).parentElement.textContent;
  expect(row("Bought calls")).toBe("Bought calls$80");
  expect(row("Sold calls")).toBe("Sold calls$20");
  expect(within(view).getByText("No large option trades on HYPE in the last 24 hours.")).toBeTruthy();
  await userEvent.setup().click(within(view).getByRole("button", { name: "All markets" }));
  expect(choose).toHaveBeenLastCalledWith("all");
  await userEvent.setup().click(screen.getByRole("button", { name: /^HYPE: / }));
  expect(choose).toHaveBeenLastCalledWith("all");
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
