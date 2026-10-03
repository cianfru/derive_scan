import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const fixture = vi.hoisted(() => ({ current: null }));
vi.mock("./lib/data.js", () => ({ useData: () => ({ data: fixture.current, error: null }) }));
vi.mock("./lib/useElementWidth.js", () => ({ useElementWidth: () => [null, 640] }));
import Markets from "./pages/Markets.jsx";
import { stripColumns, signalCounts } from "./components/StructureBand.jsx";

afterEach(cleanup);

const now = Date.now() / 1000;
const bar = Math.floor(now / 86400) * 86400;
const coin = (und, has_options, signal_1d = "WAIT") => ({
  und, has_options, signal_1d, regime_1d: "MARKUP", price: 1, chg_1d: 0,
  engine_comparison: { "1d": { status: "ready", timeframe: "1d", observed_at: now } },
});
const markets = (coins) => ({
  generated_at: now, bars: { "1d": bar },
  consensus: { "1d": "RISK-ON" },
  consensus_detail: { "1d": { status: "ready", consensus: "RISK-ON", counts: { markup: 3, total: 3 } } },
  context: { sentiment: { fear_greed_value: 67 }, sentiment_at: now },
  breadth_1d: { cols: ["MARKUP", "BLOWOFF", "REACC", "ACCUM", "CAP", "MARKDOWN", "FLAT"],
    rows: [[bar - 86400, 2, 0, 1, 0, 0, 0, 0], [bar, 2, 0, 1, 0, 0, 0, 0]] },
  coins,
});
const boardRows = () => screen.queryAllByRole("row", { name: /^Open .* market$/ });
const band = () => within(screen.getByRole("region", { name: "Daily market structure" }));
const show = () => render(<MemoryRouter><Markets /></MemoryRouter>);

it("counts the band's signals in the board's view, so a filter shows as many rows as it counts", async () => {
  fixture.current = markets([coin("AAA", true), coin("BBB", true), coin("CCC", false)]);
  show();
  const user = userEvent.setup();
  const wait = band().getByRole("button", { name: "Wait: 2 markets" });
  expect(wait.textContent).toBe("Wait2");
  await user.click(wait);
  expect(wait.getAttribute("aria-pressed")).toBe("true");
  expect(boardRows()).toHaveLength(2);
  // The consensus headline still counts every perp, whatever the view.
  expect(band().getByText("Risk-on")).toBeTruthy();
  expect(band().getByText("3/3")).toBeTruthy();

  await user.click(screen.getByRole("tab", { name: "Perps only" }));
  const perps = band().getByRole("button", { name: "Wait: 1 market" });
  expect(perps.getAttribute("aria-pressed")).toBe("true");
  expect(boardRows()).toHaveLength(1);
  await user.click(perps);
  expect(perps.getAttribute("aria-pressed")).toBe("false");
  expect(boardRows()).toHaveLength(1);
  expect(band().getByText("Risk-on")).toBeTruthy();
  expect(band().getByText("3/3")).toBeTruthy();
});

it("drops the signal filter when the new view holds none of that signal", async () => {
  fixture.current = markets([coin("AAA", true), coin("BBB", true, "LIGHT_LONG"), coin("CCC", false)]);
  show();
  const user = userEvent.setup();
  await user.click(band().getByRole("button", { name: "Wait: 1 market" }));
  expect(boardRows()).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: "Daily entries" }));
  expect(band().queryByRole("button", { name: /^Wait/ })).toBeNull();
  expect(band().getByRole("button", { name: "Light long: 1 market" }).getAttribute("aria-pressed")).toBe("false");
  expect(boardRows()).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: "Options markets" }));
  expect(boardRows()).toHaveLength(2);
});

it("leaves markets without a current daily engine out of the counts and keeps every signal reachable", () => {
  const stale = { ...coin("OLD", true), engine_comparison: { "1d": { status: "ready", timeframe: "1d", observed_at: now - 3 * 86400 } } };
  const coins = [coin("A", true, "TRIM_HARD"), coin("B", true, "NO_LONG"), coin("C", true, "REVIVAL_SEED"), stale];
  fixture.current = markets(coins);
  show();
  expect(band().getByRole("button", { name: "Trim: 1 market" })).toBeTruthy();
  expect(band().getByRole("button", { name: "No long: 1 market" })).toBeTruthy();
  expect(band().getByRole("button", { name: "Revival seed: 1 market" })).toBeTruthy();
  expect(band().queryByRole("button", { name: /^Wait/ })).toBeNull();
  expect(signalCounts(coins.slice(0, 3)).reduce((a, x) => a + x.n, 0)).toBe(3);
});

it("takes the strip's last column from the board's own readings", () => {
  const breadth = { cols: ["MARKUP", "REACC"], rows: [[100, 4, 1], [200, 3, 2]] };
  expect(stripColumns(breadth, { MARKUP: 5 }, 200).map((c) => c.n)).toEqual([{ MARKUP: 4, REACC: 1 }, { MARKUP: 5 }]);
  expect(stripColumns(breadth, { MARKUP: 5 }, 300).map((c) => c.ts)).toEqual([100, 200, 300]);
  expect(stripColumns(breadth, {}, 300)).toHaveLength(2);
});
