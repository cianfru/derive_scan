import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";

const fixtures = vi.hoisted(() => ({ docs: {}, index: null }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: fixtures.docs[path], error: null }) }));
vi.mock("./lib/livePrice.js", () => ({ useIndexPrice: vi.fn(() => fixtures.index) }));
vi.mock("./lib/useElementWidth.js", () => ({ useElementWidth: () => [null, 640] }));
vi.mock("./components/CandleChart.jsx", () => ({ default: ({ candles }) => <div data-testid="research-chart" data-close={candles.at(-1)?.[4]} /> }));
vi.mock("./components/OptionsWorkspace.jsx", () => ({ default: () => <div>Options workspace</div> }));
vi.mock("./components/CoinWallets.jsx", () => ({ default: () => <div>Wallet data</div> }));
vi.mock("./components/MetricHistory.jsx", () => ({ default: () => <div>Metric history</div> }));
import Markets from "./pages/Markets.jsx";
import Coin from "./pages/Coin.jsx";
import Traders from "./pages/Traders.jsx";
import CohortExplorer from "./components/CohortExplorer.jsx";
import { LayerTile } from "./components/Chain.jsx";
import { useIndexPrice } from "./lib/livePrice.js";

const now = Date.now() / 1000;
const engine = { status: "ready", timeframe: "1d", observed_at: now };
const market = (und, has_options = true, signal = "LIGHT_LONG") => ({ und, has_options, signal_1d: signal,
  regime_1d: "MARKUP", price: 100, chg_1d: 1, engine_comparison: { "1d": engine } });
const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const trader = (n, extra = {}) => ({ address: address(n), name: `Trader ${n}`, rank: n, class: "directional",
  option_pnl: 100 / n, win_rate: 0.5, premium_traded: n * 1000, last: `2026-10-0${n}`, ...extra });
function LocationProbe() {
  const loc = useLocation(), nav = useNavigate();
  return <><output data-testid="location">{loc.pathname}{loc.search}</output><button onClick={() => nav(-1)}>Previous view</button></>;
}
const renderMarkets = (entry = "/markets") => render(<MemoryRouter initialEntries={[entry]}><Markets /><LocationProbe /></MemoryRouter>);
const rows = () => screen.queryAllByRole("article", { name: /^\S+ market$/ });

beforeEach(() => {
  fixtures.docs = { "markets.json": { generated_at: now, bars: { "1d": now }, coins: [market("BTC"), market("ZEC"), market("SOL", false)] },
    "traders.json": { ready: true, status: "ready", through: "2026-10-06", traders: [trader(1), trader(2), trader(3)] } };
  fixtures.index = { price: 83_000, ts: now, source: "live", state: "live", fresh: true, notice: "Live index" };
  vi.clearAllMocks();
});
afterEach(cleanup);

it("finds a market by its full name and restores search, view and sort from a shared URL", async () => {
  renderMarkets("/markets?q=Zcash&sort=und&dir=asc");
  expect(rows()).toHaveLength(1);
  expect(rows()[0].getAttribute("aria-label")).toBe("ZEC market");
  expect(screen.getByRole("textbox", { name: "Find a market" }).value).toBe("Zcash");
  expect(screen.getByRole("combobox", { name: "Sort markets" }).value).toBe("und");
  fireEvent.change(screen.getByRole("textbox", { name: "Find a market" }), { target: { value: "Bitcoin" } });
  expect(rows()[0].getAttribute("aria-label")).toBe("BTC market");
  expect(screen.getByTestId("location").textContent).toContain("q=Bitcoin");
  await userEvent.click(screen.getByRole("tab", { name: "Perps only" }));
  expect(screen.getByTestId("location").textContent).toContain("view=perps");
  await userEvent.click(screen.getByRole("button", { name: "Previous view" }));
  expect(screen.getByRole("tab", { name: "Options markets" }).getAttribute("aria-selected")).toBe("true");
  expect(rows()[0].getAttribute("aria-label")).toBe("BTC market");
});

it("keeps the selected signal in the URL, distinguishes scope counts and ignores invalid URL values", async () => {
  renderMarkets("/markets?view=unknown&signal=__proto__&sort=unknown");
  expect(rows()).toHaveLength(2);
  expect(screen.getByText("All perps · daily close")).toBeTruthy();
  const signal = screen.getByRole("button", { name: "Leaning up: 2 markets" });
  await userEvent.click(signal);
  expect(screen.getByTestId("location").textContent).toContain("signal=LIGHT_LONG");
  expect(signal.getAttribute("aria-pressed")).toBe("true");
  await userEvent.click(screen.getByRole("tab", { name: "Perps only" }));
  expect(screen.getByText(/1 of 1 markets without options is trending up/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Leaning up: 1 market" })).toBeTruthy();
});

it("preserves the two Markets scopes: the coin link navigates and a reading opens its evidence", async () => {
  renderMarkets();
  const row = within(rows().find((r) => r.getAttribute("aria-label") === "BTC market"));
  expect(row.getByRole("link", { name: "Open BTC chart and data" }).getAttribute("href")).toBe("/coin/BTC");
  await userEvent.click(row.getAllByRole("img")[0]);
  expect(row.getByRole("button", { name: "Hide what BTC's readings rest on" }).getAttribute("aria-expanded")).toBe("true");
  expect(row.getByText("Context, not a signal. The three readings are independent.")).toBeTruthy();
});

it("opens reading help by activation and dismisses it with Escape, close or an outside tap", async () => {
  render(<LayerTile alignment={null} kind="wallets" />);
  const trigger = screen.getByRole("button", { name: /Wallets, next 30 days/ });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: /^Close Wallets/ }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await userEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("puts the Coin chart ahead of optional readings and keeps its daily data separate from the live index", () => {
  fixtures.docs["coins/BTC.json"] = { candles: { "1d": [[now - 86400, 80_000, 86_000, 79_000, 85_000]] },
    latest: { "1d": { regime: "MARKUP", signal: "LIGHT_LONG", signal_bar_close_time: now } },
    engine_comparison: { "1d": engine }, options: { ts: now - 300, features: { index_price: 82_000 } } };
  render(<MemoryRouter initialEntries={[{ pathname: "/coin/BTC", state: { marketsReturnTo: "/markets?q=Bitcoin&sort=und" } }]}><Routes><Route element={<Outlet context={{ theme: "light" }} />}><Route path="/coin/:und" element={<Coin />} /></Route></Routes></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Markets" }).getAttribute("href")).toBe("/markets?q=Bitcoin&sort=und");
  expect(screen.getByText("Index now")).toBeTruthy();
  expect(screen.getByText("$83,000")).toBeTruthy();
  expect(screen.getByText("$85,000")).toBeTruthy();
  expect(screen.getByTestId("research-chart").getAttribute("data-close")).toBe("85000");
  expect(useIndexPrice).toHaveBeenCalledWith("BTC", 82_000, now - 300);
  const detail = screen.getByText("Regime readings").closest("details");
  expect(detail.open).toBe(false);
  expect(screen.getByTestId("research-chart").compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("Three readings · 7 and 30 days").closest("details").open).toBe(false);
});

it("finds traders by name or address and sorts existing metrics without mutating published rank", async () => {
  render(<MemoryRouter><Traders /></MemoryRouter>);
  const input = screen.getByRole("textbox", { name: "Find a trader" });
  fireEvent.change(input, { target: { value: "Trader 2" } });
  expect(screen.getByRole("link", { name: "Open Trader 2 profile" }).getAttribute("href")).toBe(`/trader/${address(2)}`);
  expect(screen.queryByRole("link", { name: "Open Trader 1 profile" })).toBeNull();
  fireEvent.change(input, { target: { value: address(3).toUpperCase() } });
  expect(screen.getByRole("link", { name: "Open Trader 3 profile" })).toBeTruthy();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Sort traders" }), { target: { value: "premium_traded" } });
  expect(screen.getAllByRole("link", { name: /^Open Trader/ }).map((r) => r.textContent)).toEqual(["Trader 3", "Trader 2", "Trader 1"]);
  expect(fixtures.docs["traders.json"].traders.map((t) => t.rank)).toEqual([1, 2, 3]);
});

it("exposes mobile trader values and offers all mobile cohort choices", () => {
  fixtures.docs["traders.json"].traders[0].lean = { score: 0.3, net_delta_usd: 15_000, gross_delta_usd: 50_000 };
  const { container } = render(<MemoryRouter><Traders /></MemoryRouter>);
  const compact = container.querySelector("td.lb-m");
  expect(compact.getAttribute("aria-hidden")).toBeNull();
  expect(compact.textContent).toContain("50% win");
  expect(compact.textContent).toContain("Book");
  expect(compact.textContent).toContain("Last trade 2026-10-01");
  cleanup();
  const names = ["Money Printer", "Smart Money", "Grinder", "Humble Earner", "Exit Liquidity", "Semi-Rekt", "Full Rekt", "Giga-Rekt"];
  render(<MemoryRouter><CohortExplorer cohorts={{ pnl: names.map((name) => ({ name, wallets: 3, windows: { all: { coins: {} } } })) }} through="2026-10-06" /></MemoryRouter>);
  const select = screen.getByRole("combobox", { name: "Select trader posse" });
  expect(within(select).getAllByRole("option")).toHaveLength(8);
  fireEvent.change(select, { target: { value: "Giga-Rekt" } });
  expect(screen.getByRole("heading", { name: "Boot Hill" })).toBeTruthy(); // the code stays, people see the Western name
  expect(screen.queryByText(/Giga-Rekt/)).toBeNull();
});
