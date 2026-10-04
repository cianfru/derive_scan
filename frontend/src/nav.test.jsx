// The Saloon build's header: My space counts, the Following tab in Positions, the old Following route,
// and the Cohorts page split out of Traders.
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TESTNET_FILLS: false, TRADE_ON: false }));
const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path] ?? null }), useFeeds: () => [null, {}, true] }));
import Shell from "./components/Shell.jsx";
import MyQuestions from "./pages/MyQuestions.jsx";
import Traders from "./pages/Traders.jsx";
import Cohorts from "./pages/Cohorts.jsx";
import { _resetMemory, addPosition } from "./lib/positions.js";
import { openCount } from "./components/MySpace.jsx";

const ID = "BTC-20261009-A-83000-89000";
const position = { key: "p1", id: ID, und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
  settle_ts: 1791532800, legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both" };

beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1791036600 * 1000);
  localStorage.clear();
  _resetMemory();
  docs.current = {};
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}{loc.search}</p>;
}
const at = (path, page = <Where />) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<Shell />}>
        <Route path="saloon/following" element={<Navigate to="/saloon/mine?tab=following" replace />} />
        <Route path="saloon/mine" element={<>{page}<Where /></>} />
        <Route path="*" element={page} />
      </Route>
    </Routes>
  </MemoryRouter>);

it("shows My space to a new visitor, with no counts", async () => {
  const user = userEvent.setup();
  at("/markets");
  await user.click(await screen.findByRole("button", { name: "My space" }));
  const menu = screen.getByRole("group", { name: "My space pages" });
  expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual(["Positions", "Following"]);
});

it("counts open positions and followed answers, and updates after a save", async () => {
  const user = userEvent.setup();
  localStorage.setItem("cowboy-questions", JSON.stringify([position, { ...position, key: "p2", closed_at: 1791000000 }]));
  localStorage.setItem("cowboy-follows", JSON.stringify({ version: 1, follows: [{ id: ID, side: "yes" }, { id: ID, side: "no" }] }));
  at("/markets");
  // Wait for the counting chunk before opening, so the menu is not swapped under the click.
  await vi.waitFor(() => expect(document.querySelector(".nav-myspace")?.dataset.counted).toBe("1"));
  await user.click(screen.getByRole("button", { name: "My space" }));
  const menu = screen.getByRole("group", { name: "My space pages" });
  expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual(["Positions1", "Following2"]);
  addPosition({ ...position, key: undefined });
  await vi.waitFor(() => expect(within(screen.getByRole("group", { name: "My space pages" })).getAllByRole("link")[0].textContent).toBe("Positions2"));
  expect(openCount([position, { ...position, settle_ts: 1791000000 }])).toBe(1);
});

it("sends the old Following route to the Following tab in Positions, with a friendly empty state", async () => {
  at("/saloon/following", <MyQuestions />);
  expect(screen.getByTestId("where").textContent).toBe("/saloon/mine?tab=following");
  expect(screen.getByRole("tab", { name: "Following" }).getAttribute("aria-selected")).toBe("true");
  const empty = await screen.findByRole("region", { name: "Nothing followed yet" });
  expect(within(empty).getByRole("link", { name: "Browse the Saloon" }).getAttribute("href")).toBe("/saloon");
});

it("gives empty Open and Closed tabs a way into the Saloon", async () => {
  const user = userEvent.setup();
  localStorage.setItem("cowboy-questions", JSON.stringify([{ ...position, closed_at: 1791000000 }]));
  at("/saloon/mine", <MyQuestions />);
  const empty = screen.getByRole("region", { name: "Nothing open" });
  expect(within(empty).getByRole("link", { name: "Browse the Saloon" }).getAttribute("href")).toBe("/saloon");
  await user.click(screen.getByRole("tab", { name: "Following" }));
  expect(screen.getByTestId("where").textContent).toBe("/saloon/mine?tab=following");
});

const traders = {
  ready: true, status: "ready", through: "2026-10-02", generated_at: 1791036000, ranked_total: 1,
  cohorts: { pnl: [{ name: "Money Printer", wallets: 4, windows: { all: { coins: { BTC: { positions: 3, score: 0.5, net_delta_usd: 20000, gross_delta_usd: 40000 } } } } }], size: [] },
  traders: [{ address: "0x1111111111111111111111111111111111111111", rank: 1, class: "directional", option_pnl: 1000, win_rate: 0.5, premium_traded: 5000, last: "2026-10-02", lean: null }],
};

it("moves cohorts to their own page; the leaderboard links to it", () => {
  docs.current = { "traders.json": traders };
  render(<MemoryRouter><Traders /></MemoryRouter>);
  expect(screen.queryByRole("region", { name: "Trader cohort positioning" })).toBeNull();
  expect(screen.getByRole("link", { name: /Cohorts/ }).getAttribute("href")).toBe("/traders/cohorts");
  cleanup();
  render(<MemoryRouter><Cohorts /></MemoryRouter>);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Cohorts/);
  expect(screen.getByRole("region", { name: "Trader cohort positioning" })).toBeTruthy();
  expect(screen.getByRole("note", { name: "Takeaway" }).textContent).toContain("4 Money Printer wallets hold $20K of net long option delta across 1 coin.");
  expect(screen.getByRole("link", { name: "Leaderboard" }).getAttribute("href")).toBe("/traders");
});
