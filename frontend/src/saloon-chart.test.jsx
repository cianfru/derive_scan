import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import hype from "./fixtures/questions/HYPE.json";
import index from "./fixtures/questions/index.json";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
vi.mock("./components/SettleChart.jsx", async (orig) => ({ ...await orig(), default: () => <div data-testid="settle-chart" /> }));
import Saloon from "./pages/Saloon.jsx";
import { chartLevels, levelText, returnPct, smartOf } from "./components/SaloonChart.jsx";
import { boardRows } from "./lib/board.js";
import { BANNED } from "./lib/questions.js";

const T14 = 1791036000;
const NOW = T14 + 600;
const idx = { ...index, coins: index.coins.filter((c) => ["BTC", "HYPE"].includes(c.und)).map((c) => (c.und === "BTC" ? { ...c, smart: 1 } : c)) };
const candles = Array.from({ length: 80 }, (_, i) => [T14 - (80 - i) * 14400, 84000 + i * 5, 84200 + i * 5, 83800 + i * 5, 84050 + i * 5]);
// One BTC answer carries a smart-wallet mark, as publish_site writes it.
const smartBtc = JSON.parse(JSON.stringify(btc));
const marked = smartBtc.dates[4].levels.find((l) => l.ladder && l.k > smartBtc.index);
marked.yes.smart = { delta_usd: 24000, wallets: 3 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  localStorage.clear();
  docs.current = {
    "questions/index.json": idx, "questions/BTC.json": smartBtc, "questions/HYPE.json": hype,
    "markets.json": { coins: [{ und: "BTC", chg_24h: -1.7 }, { und: "HYPE", chg_24h: 2.4 }] },
    "coins/BTC.json": { candles: { "4h": candles } }, "coins/HYPE.json": { candles: { "4h": candles.map(([t, ...p]) => [t, ...p.map((v) => v / 900)]) } },
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const show = (path = "/saloon") => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/saloon" element={<Saloon />} /><Route path="/q/:id" element={<p>outcome page</p>} /></Routes>
  </MemoryRouter>,
);

describe("chart helpers", () => {
  it("shows each level once, with the answer that bets toward it", () => {
    const { rows } = boardRows([btc], 100, { now: NOW });
    const by = new Map();
    for (const r of rows) { if (!by.has(r.expiry)) by.set(r.expiry, []); by.get(r.expiry).push(r); }
    const dates = chartLevels([...by].map(([expiry, rs]) => ({ expiry, settle: rs[0].settleTs, rows: rs })), btc.index);
    for (const d of dates) {
      const ks = d.levels.map((l) => l.k);
      expect(new Set(ks).size).toBe(ks.length);
      for (const l of d.levels) {
        const toward = l.k >= btc.index ? "yes" : "no";
        // The side toward the level when it has a price, else the other one.
        if (d.rows.some((r) => r.k === l.k && r.side === toward)) expect(l.r.side).toBe(toward);
      }
    }
  });
  it("formats returns and levels", () => {
    expect(returnPct(78.4, 100)).toBe("+78.4%");
    expect(returnPct(1240, 100)).toBe("+1,240%");
    expect(levelText(86000)).toBe("86k");
    expect(levelText(86500)).toBe("86.5k");
    expect(levelText(2750)).toBe("2,750");
    expect(smartOf({ side: "yes", level: { yes: { smart: { wallets: 2 } } } })).toEqual({ wallets: 2 });
    expect(smartOf({ side: "no", level: { yes: { smart: { wallets: 2 } } } })).toBeNull();
  });
});

describe("Saloon chart page", () => {
  it("opens on the chart with coin tabs, and switches to the list", () => {
    show();
    const tabs = screen.getByRole("tablist", { name: "Coin" });
    const btcTab = within(tabs).getByRole("tab", { name: /Bitcoin/ });
    expect(btcTab.getAttribute("aria-selected")).toBe("true");
    expect(btcTab.textContent).toContain("-1.7%");
    expect(btcTab.getAttribute("aria-label")).toMatch(/1 with smart wallets/);
    expect(screen.getByRole("link", { name: "Chart" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "List" }).getAttribute("href")).toBe("/saloon?view=list");
    expect(document.querySelectorAll(".sch-bubble").length).toBeGreaterThan(5);
    expect(document.querySelectorAll(".sch-gold").length).toBeGreaterThanOrEqual(1);
  });

  it("opens the trade panel from a bubble and switches Higher and Lower", () => {
    show();
    const bubble = [...document.querySelectorAll(".sch-bubble:not(.sch-dot)")].find((b) => /^Higher/.test(b.getAttribute("aria-label")));
    fireEvent.keyDown(bubble, { key: "Enter" });
    const panel = screen.getByRole("complementary", { name: "Your trade" });
    expect(within(panel).getByRole("heading").textContent).toMatch(/^BTC higher than \$/);
    expect(within(within(panel).getByRole("group", { name: "Answer" })).getByRole("button", { name: /Higher/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).getByText(/You pay/)).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Full details" }).getAttribute("href")).toMatch(/^\/q\/BTC-.*\?side=yes$/);
    const lower = within(within(panel).getByRole("group", { name: "Answer" })).getByRole("button", { name: /Lower/ });
    if (!lower.disabled) {
      fireEvent.click(lower);
      expect(within(screen.getByRole("complementary", { name: "Your trade" })).getByRole("heading").textContent).toMatch(/^BTC lower than/);
    }
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Your trade" })).toBeNull();
  });

  it("follows the coin in the address and says so when there are no prices", () => {
    show("/saloon?coin=HYPE");
    expect(within(screen.getByRole("tablist", { name: "Coin" })).getByRole("tab", { name: /Hyperliquid/ }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    docs.current["questions/index.json"] = { ...idx, coins: [] };
    show();
    expect(screen.getByText("No prices on Derive right now.")).toBeTruthy();
  });

  it("uses no forecast words", () => {
    show();
    expect(document.body.textContent).not.toMatch(BANNED);
  });
});
