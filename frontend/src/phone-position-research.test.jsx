import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import { _resetMemory, loadPositions } from "./lib/positions.js";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: path => ({ data: docs.current[path] ?? null }) }));
vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TESTNET_FILLS: false, MAINNET_FILLS: false, ONE_TAP_FILLS: false, TRADE_ON: false, FUND_ANYCHAIN: false, RYSK_MOCK: false }));
vi.mock("./components/SettleChart.jsx", () => ({ default: () => <div role="img" aria-label="Settlement chart" /> }));
vi.mock("./lib/useElementWidth.js", () => ({ useElementWidth: () => [null, 640] }));
import MyQuestions from "./pages/MyQuestions.jsx";
import OptionsWorkspace from "./components/OptionsWorkspace.jsx";

const position = { key: "phone-record", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000,
  contracts: 0.04407, paid: 103.01, settle_ts: 1791532800, legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both" };
let media, listeners;
const resize = phone => act(() => { media.matches = phone; listeners.forEach(fn => fn()); });
const showPositions = records => {
  localStorage.setItem("cowboy-questions", JSON.stringify(records));
  return render(<MemoryRouter><MyQuestions /></MemoryRouter>);
};
const figure = (root, name) => within(root).getByText(name).closest("div").querySelector("dd").textContent;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1791036600000);
  localStorage.clear(); _resetMemory();
  docs.current = { "questions/BTC.json": btc };
  listeners = new Set();
  media = { matches: true, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  vi.stubGlobal("matchMedia", () => media);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("open Positions on phones", () => {
  it("keeps cost, P&L and maximum payout first, with every desktop settlement figure still reachable", async () => {
    media.matches = false;
    const { container } = showPositions([position]);
    const old = container.querySelector(".q-group");
    const names = ["Profit / loss now", "Value now", "You paid", "Most it pays", "Most you can lose", "Breakeven"];
    const values = Object.fromEntries(names.map(name => [name, figure(old, name)]));
    resize(true);
    const card = container.querySelector(".q-phone-group");
    expect(card).toBeTruthy();
    expect([...card.querySelector(".q-phone-essentials").querySelectorAll("dt")].map(n => n.firstChild.textContent)).toEqual(["Profit / loss now", "You paid", "Most it pays"]);
    for (const name of names) expect(figure(card, name)).toBe(values[name]);
    expect(within(card).getByRole("link", { name: "Higher than $86,000" }).getAttribute("href")).toBe(`/q/${position.id}?side=yes`);
    const settlement = [...card.querySelectorAll("details")].find(d => d.querySelector("summary").textContent.startsWith("Value and settlement"));
    expect(settlement.open).toBe(false);
    await userEvent.setup().click(settlement.querySelector("summary"));
    expect(settlement.open).toBe(true);
    expect(figure(settlement, "Value now")).toBe(values["Value now"]);
    const pnlFold = container.querySelector(".q-pnl details");
    expect(pnlFold.open).toBe(false);
    expect(pnlFold.textContent).toContain("Realized$0.00");
    expect(loadPositions()).toHaveLength(1);
  });

  it("opens the same position’s close panel and preserves its selection across disclosures and desktop resize", async () => {
    const { container } = showPositions([position]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(container.querySelector(".q-ticket")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep it open" }).getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByText("Value and settlement figures"));
    expect(container.querySelector(".q-ticket")).toBeTruthy();
    resize(false);
    expect(container.querySelector(".q-phone-group")).toBeNull();
    expect(container.querySelector(".q-group-body .q-group-chart")).toBeTruthy();
    expect(container.querySelector(".q-ticket")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep it open" }));
    expect(container.querySelector(".q-ticket")).toBeNull();
    expect(loadPositions()).toHaveLength(1);
  });

  it("keeps incomplete fills visible and unknown, with no close action added by the compact layout", () => {
    const { container } = showPositions([position, { ...position, key: "phone-partial", exec: "hand_partial" }]);
    const rows = container.querySelectorAll(".q-pos-line");
    expect(rows).toHaveLength(2);
    const part = rows[1];
    expect(part.textContent).toContain("Placed by hand · only the first filled");
    expect(figure(part, "Profit / loss now")).toBe("Not available yeti");
    expect(figure(part, "Most it pays")).toBe("Not available yeti");
    expect(within(part).queryByRole("button", { name: "Close" })).toBeNull();
    expect(figure(part.querySelector("details"), "Contracts")).toBe("0.04407");
    expect(container.querySelector(".q-phone-group").textContent).toContain("Most you can lose");
  });
});

const first = 1793347200, next = 1795766400;
const opts = { ts: 1791036600, chain_at: 1791036600, status: "ready", features: { index_price: 100, atm_iv_30d: .3, atm_iv_7d: .2, atm_iv_90d: .4, rr25_30d: -.02 },
  expiries: [{ expiry: first, tenor_days: 27, atm_iv: .3, forward: 101 }, { expiry: next, tenor_days: 55, atm_iv: .4, forward: 103 }],
  strikes: { expiries: { [first]: [[90, 10, 20, .32, .33]], [next]: [[110, 30, 40, .4, .41]] } },
  implied: [{ expiry: first, q: [80, 85, 100, 115, 120], method: "atm" }, { expiry: next, q: [60, 70, 103, 140, 150], method: "smile" }] };
describe("Coin options on phones", () => {
  it("starts with the expiry and range, retaining selected expiry and all strike figures behind a native fold", async () => {
    const { container } = render(<MemoryRouter><OptionsWorkspace und="BTC" opts={opts} embedded /></MemoryRouter>);
    const section = container.querySelector("#options-detail");
    expect(section.firstElementChild.className).toBe("options-desk plate");
    expect(screen.getByText("$85.00 — $115.00")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open BTC in the Saloon" }).getAttribute("href")).toBe("/saloon/BTC");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /11-27/ }));
    expect(screen.getByText("$70.00 — $140.00")).toBeTruthy();
    const details = section.querySelector(".expiry-desk details");
    expect(details.open).toBe(false);
    await user.click(details.querySelector("summary"));
    fireEvent(details, new Event("toggle"));
    expect(screen.getByText("$103.00")).toBeTruthy();
    expect(details.textContent).toContain("40 contracts");
    expect(details.textContent).toContain("30 contracts");
    const dashboard = section.querySelector(".phone-options-dashboard");
    expect(dashboard.open).toBe(false);
    expect(dashboard.textContent).toContain("30-day move");
    expect(dashboard.textContent).toContain("30-day skew");
    expect(dashboard.textContent).toContain("Term structure");
    resize(false);
    expect(section.firstElementChild.className).toBe("options-dashboard plate");
    expect(container.querySelector(".phone-options-desk")).toBeNull();
    expect(screen.getByRole("button", { name: /11-27/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("$70.00 — $140.00")).toBeTruthy();
    expect(screen.getByText("$103.00")).toBeTruthy();
  });

  it("keeps the standalone Options workspace’s full desktop arrangement on a phone", () => {
    const { container } = render(<MemoryRouter><OptionsWorkspace und="BTC" opts={opts} /></MemoryRouter>);
    expect(container.querySelector(".phone-options-desk")).toBeNull();
    expect(container.querySelector(".options-dashboard")).toBeTruthy();
    expect(screen.getByText("$101.00")).toBeTruthy();
  });
});
