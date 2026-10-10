import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Options from "./pages/Options.jsx";
import Flow from "./pages/Flow.jsx";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path], error: null }) }));
const now = Date.now() / 1000;
const address = (i) => `0x${i.toString(16).padStart(40, "0")}`;
const market = (und, price) => ({ und, price, options: { status: "ready", ts: now, option_oi_contracts: 10,
  atm_iv_7d: 0.4, atm_iv_30d: 0.5, atm_iv_90d: 0.6, rr25_30d: -0.02, levels: { put_wall: 90, call_wall: 110 }, pc_oi_ratio: 0.7 } });
const flow = {
  coverage: { ready: true, end: now },
  by_coin: { BTC: { call: { buy_premium_usd: 1000 } }, ETH: { put: { buy_premium_usd: 500 } } },
  large: Array.from({ length: 24 }, (_, i) => ({ ts: now * 1000, kind: i < 20 ? "option" : "perp", underlying: i % 2 ? "ETH" : "BTC",
    instrument: i < 20 ? `${i % 2 ? "ETH" : "BTC"}-20261030-100-C` : "BTC-PERP", direction: "buy", notional_usd: 100000, premium_usd: 2500, wallet: address(i + 1), class: "directional" })),
  wallets: Array.from({ length: 20 }, (_, i) => ({ wallet: address(i + 1), class: "directional", perp_notional_usd: 1000,
    option_notional_usd: 10000, premium_bought_usd: 100, premium_sold_usd: 10, realized_pnl_usd: 2 })),
};
const show = (Page) => render(<MemoryRouter><Page /></MemoryRouter>);

beforeEach(() => vi.stubGlobal("matchMedia", (q) => ({ matches: q.includes("680"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("option pricing disclosure", () => {
  it("keeps navigation separate from touch and keyboard accessible pricing detail", () => {
    docs.current = { "markets.json": { generated_at: now, coins: [market("BTC", 100), market("ETH", 90)] } };
    show(Options);
    const row = screen.getByRole("article", { name: "BTC option pricing" });
    const link = within(row).getByRole("link", { name: "Open BTC options" });
    expect(link.getAttribute("href")).toBe("/coin/BTC#options");
    const summary = within(row).getByLabelText("BTC pricing details");
    expect(link.contains(summary)).toBe(false);
    expect(row.querySelector("details").open).toBe(false);
    fireEvent.click(summary);
    expect(row.querySelector("details").open).toBe(true);
    const detail = row.querySelector(".ob-detail-grid");
    expect(detail.textContent).toMatch(/7D40%30D50%90D60%/);
    expect(detail.textContent).toMatch(/P\/C OI 0.70/);
    fireEvent.click(within(detail).getByRole("button", { name: "About BTC priced movement" }));
    expect(screen.getByRole("dialog").textContent).toContain("Market pricing, not our view.");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement.getAttribute("aria-label")).toBe("About BTC priced movement");
    fireEvent.click(screen.getByRole("tab", { name: "7 days" }));
    expect(detail.textContent).toContain("Priced move · 7D");
    expect(link.getAttribute("href")).toBe("/coin/BTC#options");
  });
});

describe("flow views and result scope", () => {
  it("starts with a phone-sized trade sample and keeps every recorded row accessible", () => {
    docs.current = { "flow.json": flow };
    show(Flow);
    expect(document.querySelectorAll(".fl-story")).toHaveLength(5);
    expect(document.querySelector(".fw-row")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 20 trades" }));
    expect(document.querySelectorAll(".fl-story")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer trades" }));
    expect(document.querySelectorAll(".fl-story")).toHaveLength(5);
    const tab = screen.getByRole("tab", { name: "Large trades" });
    fireEvent.keyDown(tab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Active wallets" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".fl-story")).toBeNull();
    expect(document.querySelectorAll(".fw-row")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 20 wallets" }));
    expect(document.querySelectorAll(".fw-row")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer wallets" }));
    expect(document.querySelectorAll(".fw-row")).toHaveLength(5);
  });

  it("makes a selected market's result explicit and focuses it from either view", () => {
    docs.current = { "flow.json": flow };
    show(Flow);
    fireEvent.click(screen.getByRole("tab", { name: "Active wallets" }));
    fireEvent.click(screen.getByRole("button", { name: /BTC/ }));
    expect(screen.getByText("BTC · 10 recorded option trades")).toBeTruthy();
    expect(screen.getByText("All markets · 24h")).toBeTruthy();
    expect(document.querySelectorAll(".fw-row")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "View BTC trades" }));
    expect(document.activeElement.textContent).toBe("Large trades");
    expect(screen.getByRole("tab", { name: "Large trades" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelectorAll(".fl-story")).toHaveLength(5);
    expect(document.querySelector(".fl-table-context").textContent).toContain("BTC · 5 of 10 trades");
    fireEvent.click(screen.getByRole("tab", { name: "Perpetuals" }));
    expect(screen.getByText("BTC · 2 recorded perpetual trades")).toBeTruthy();
    expect(document.querySelectorAll(".fl-story")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "BTC · Clear" }));
    expect(screen.queryByRole("button", { name: "View BTC trades" })).toBeNull();
    expect(document.querySelector(".fl-table-context").textContent).toContain("All markets · 4 of 4 perpetual trades");
  });

  it("retains the wider sample on desktop", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    docs.current = { "flow.json": flow };
    show(Flow);
    expect(document.querySelectorAll(".fl-story")).toHaveLength(12);
    fireEvent.click(screen.getByRole("tab", { name: "Active wallets" }));
    expect(document.querySelectorAll(".fw-row")).toHaveLength(12);
  });
});
