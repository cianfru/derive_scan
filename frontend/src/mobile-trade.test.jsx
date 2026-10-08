import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import index from "./fixtures/questions/index.json";
import { _resetDecision } from "./lib/decision.js";
import { budgetTicket, breakeven, findLevel, money } from "./lib/questions.js";
import { PhoneFold, TradeFacts, TradeFigures } from "./components/MobileTrade.jsx";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path] ?? null, error: null }) }));
vi.mock("./lib/flags.js", () => ({ FUND_ANYCHAIN: false, RYSK_MOCK: true, QUESTIONS_ON: true, TRADE_ON: false, TESTNET_FILLS: false, MAINNET_FILLS: false, ONE_TAP_FILLS: false }));
vi.mock("./components/SettleChart.jsx", async (orig) => ({ ...await orig(), default: () => <div data-testid="settle-chart" /> }));
import Saloon from "./pages/Saloon.jsx";
import Questions from "./pages/Questions.jsx";

const ID = "BTC-20261009-A-82000-88000";
const { level, date } = findLevel(btc, ID);
const t = budgetTicket(level, "yes", 100, btc);
const props = { und: "BTC", level, side: "yes", t, expiry: date.expiry, settleTs: date.settle_ts, summary: true, compact: true };
const phone = (matches = true) => vi.stubGlobal("matchMedia", () => ({ matches, addEventListener() {}, removeEventListener() {} }));
beforeEach(() => {
  _resetDecision(); phone();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime((btc.prices_ts + 120) * 1000);
  docs.current = { "questions/index.json": { ...index, coins: index.coins.filter((c) => c.und === "BTC") }, "questions/BTC.json": btc, "markets.json": { coins: [] }, "coins/BTC.json": { candles: { "4h": [] } } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps only cost, maximum payout and profit ahead of the phone action, with every secondary figure reachable", () => {
  const { container } = render(<><TradeFigures {...props} /><TradeFacts {...props} /></>);
  expect(container.querySelector(".mt-figures").querySelectorAll("dt")).toHaveLength(3);
  expect(container.querySelector(".mt-figures").textContent).toContain(money(t.mostLose, { cents: true }));
  expect(container.querySelector(".mt-figures").textContent).toContain(money(t.payout, { cents: true }));
  const details = container.querySelector("details"); expect(details.open).toBe(false);
  fireEvent.click(within(details).getByText("Fees, breakeven and settlement"));
  expect(details.textContent).toContain(money(t.fees, { cents: true }));
  expect(details.textContent).toContain(`BTC at ${money(breakeven(t, level, "yes"))}`);
  expect(details.textContent).toContain(`${money(level.lo)}–${money(level.hi)}`);
  expect(details.textContent).toContain(`${money(level.hi)} or above`);
  expect(details.textContent).toContain(`${money(level.lo)} or below`);
});

it("renders the original figures and content without extra desktop wrappers", () => {
  phone(false);
  const { container } = render(<><TradeFigures {...props} /><TradeFacts {...props} /><PhoneFold title="Research"><section data-testid="original">Original</section></PhoneFold></>);
  expect(container.firstElementChild.className).toBe("op-figs summary");
  expect(container.querySelector("details")).toBeNull();
  expect(screen.getByTestId("original").parentElement).toBe(container);
  expect(container.querySelector(".op-fees-line").textContent).toContain(money(t.fees, { cents: true }));
});

it("keeps coin, date, raw decimal budget and both answers on the compact outcome page", () => {
  render(<MemoryRouter initialEntries={[`/q/${ID}?side=yes`]}><Routes><Route path="/q/:id" element={<Questions />} /></Routes></MemoryRouter>);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("BTC higher or lower than $85,000?");
  expect(document.querySelector(".md-heading .q-settles")).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Amount, fees included/, { selector: "input" }), { target: { value: "25.50" } });
  fireEvent.click(screen.getByRole("radio", { name: /^Lower/ }));
  expect(screen.getByLabelText(/Amount, fees included/, { selector: "input" }).value).toBe("25.50");
  expect(screen.getByRole("button", { name: "Review trade" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Amount, fees included/, { selector: "input" }), { target: { value: "100.50" } });
  expect(screen.getByRole("button", { name: "Review trade" }).disabled).toBe(false);
  const research = document.querySelector("details.mt-research");
  expect(research.open).toBe(false);
  expect(research.querySelector("[aria-label=\"Price history\"]")).not.toBeNull();
  fireEvent.click(screen.getByText("Chart, payout examples and research"));
  expect(research.open).toBe(true);
});

it("separates premium illustrations from the real selected outcome and returns to the unchanged buy decision", async () => {
  render(<MemoryRouter initialEntries={[`/saloon?coin=BTC&outcome=${ID}&side=yes`]}><Saloon /></MemoryRouter>);
  const panel = screen.getByRole("dialog", { name: "Your trade" });
  const budget = within(panel).getByLabelText(/Amount, fees included/, { selector: "input" });
  fireEvent.change(budget, { target: { value: "100.50" } });
  fireEvent.click(within(panel).getByRole("tab", { name: "Receive premium" }));
  expect(within(panel).queryByRole("button", { name: "Review trade" })).toBeNull();
  expect(within(panel).queryByText(/BTC higher than/)).toBeNull();
  expect(await within(panel).findByText("Rysk illustration")).toBeTruthy();
  fireEvent.click(within(panel).getByRole("tab", { name: "Buy outcome" }));
  expect(within(panel).getByLabelText(/Amount, fees included/, { selector: "input" }).value).toBe("100.50");
  expect(within(panel).getByRole("button", { name: "Review trade" })).toBeTruthy();
});
