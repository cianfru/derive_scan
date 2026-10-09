import { _resetDecision } from "./lib/decision.js";
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
import { chartLevels, countText, levelText, returnPct, smartOf, traderText } from "./components/SaloonChart.jsx";
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
// Directional traders' reading on two dates, one too thin to read, as publish_site writes them.
smartBtc.dates[4].traders = { state: "defensive", score: -0.692, long: 7, short: 8, net_delta_usd: -15633000, gross_delta_usd: 22592000, status: "ready" };
smartBtc.dates[5].traders = { state: null, score: null, long: 1, short: 1, net_delta_usd: 4000, gross_delta_usd: 5000, status: "too_few_wallets" };
marked.smart_wallets = { long: 3, short: 1, wallets: [
  { address: "0x28fb00000000000000000000000000000000aa01", side: "short", delta_usd: -42000, option_pnl: 84210.5, rank: 12 },
  { address: "0x28fb00000000000000000000000000000000aa02", side: "long", delta_usd: 9000, option_pnl: -1500, rank: 40 },
  { address: "0x28fb00000000000000000000000000000000aa03", side: "long", delta_usd: 3000, option_pnl: null, rank: null },
] };

beforeEach(() => {
  _resetDecision();
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

const dayLabelOf = (d) => new Date(d.settle_ts * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
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
        // Always the side toward the level: Higher above the price, Lower below it.
        expect(l.r.side).toBe(toward);
      }
    }
  });
  it("shows a level without a price toward it as a blank, never the other side's bubble", () => {
    const row = (k, side) => ({ k, side, key: `${k}:${side}` });
    const [d] = chartLevels([{ expiry: "20261009", settle: 1, rows: [row(90000, "no"), row(88000, "yes"), row(80000, "no"), row(78000, "yes")] }], 84000);
    expect(d.levels.map((l) => [l.k, l.r.side])).toEqual([[80000, "no"], [88000, "yes"]]);
    expect(d.blanks).toEqual([78000, 90000]);
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
    expect(screen.getByRole("link", { name: "List" }).getAttribute("href")).toBe("/saloon?coin=BTC&view=list");
    expect(document.querySelectorAll(".sch-bubble").length).toBeGreaterThan(5);
    expect(document.querySelectorAll(".sch-gold").length).toBeGreaterThanOrEqual(1);
  });

  it("opens the trade panel from a bubble and switches Higher and Lower", () => {
    show();
    const bubble = [...document.querySelectorAll(".sch-bubble:not(.sch-dot)")].find((b) => /^Higher/.test(b.getAttribute("aria-label")));
    fireEvent.keyDown(bubble, { key: "Enter" });
    const panel = screen.getByRole("dialog", { name: "Your trade" });
    expect(within(panel).getByRole("heading").textContent).toMatch(/^BTC higher than \$/);
    expect(within(within(panel).getByRole("group", { name: "Answer" })).getByRole("button", { name: /Higher/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).getByText(/You pay/)).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Full details" }).getAttribute("href")).toMatch(/^\/q\/BTC-.*\?side=yes$/);
    const lower = within(within(panel).getByRole("group", { name: "Answer" })).getByRole("button", { name: /Lower/ });
    if (!lower.disabled) {
      fireEvent.click(lower);
      expect(within(screen.getByRole("dialog", { name: "Your trade" })).getByRole("heading").textContent).toMatch(/^BTC lower than/);
    }
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Your trade" })).toBeNull();
  });

  it("follows the coin in the address and says so when there are no prices", () => {
    show("/saloon?coin=HYPE");
    expect(within(screen.getByRole("tablist", { name: "Coin" })).getByRole("tab", { name: /Hyperliquid/ }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    docs.current["questions/index.json"] = { ...idx, coins: [] };
    show();
    expect(screen.getByText("No prices on Derive right now.")).toBeTruthy();
  });

  it("keeps a tab for every coin with options, saying why one has no answer now", () => {
    docs.current["questions/index.json"] = { ...idx, quiet: [
      { und: "ETH", thin: false, index: 2500, reason: "wide" }, { und: "CC", thin: true, index: null, reason: "thin" }] };
    show("/saloon?coin=ETH");
    const tabs = within(screen.getByRole("tablist", { name: "Coin" }));
    expect(tabs.getByRole("tab", { name: /Ethereum.*prices too wide/i }).getAttribute("aria-selected")).toBe("true");
    expect(tabs.getByText("Market too thin")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "No ETH answers right now" })).toBeTruthy();
    expect(screen.getByText(/checks every 15 minutes/)).toBeTruthy();
    fireEvent.click(tabs.getByRole("tab", { name: /market too thin/i }));
    expect(screen.getByRole("heading", { name: "CC: market too thin" })).toBeTruthy();
    cleanup();
    show();  // the default coin is one with answers
    expect(within(screen.getByRole("tablist", { name: "Coin" })).getByRole("tab", { selected: true }).textContent).toMatch(/BTC/);
  });

  it("draws where directional traders lean on each date, and says it in the panel", () => {
    expect(traderText(smartBtc.dates[4].traders)).toBe("7 long · 8 short, most of the money short");
    expect(traderText(smartBtc.dates[5].traders)).toBe("1 long · 1 short, too few traders to read");
    expect(traderText({ state: "neutral", score: 0.1, long: 4, short: 3 })).toBe("4 long · 3 short, most of the money on both sides");
    expect(countText({ long: 3, short: 1 })).toBe("3 long · 1 short");
    show();
    const dots = [...document.querySelectorAll(".sch-lane-dot")];
    expect(dots.map((d) => d.textContent)).toEqual(expect.arrayContaining(["7 long · 8 short", "Too few"]));
    expect(dots.find((d) => d.textContent === "7 long · 8 short").getAttribute("aria-label")).toMatch(/^Directional traders on .*: 7 long · 8 short, most of the money short$/);
    const bubble = [...document.querySelectorAll(".sch-bubble:not(.sch-dot)")].find((b) => b.getAttribute("aria-label").includes(dayLabelOf(smartBtc.dates[4])));
    expect(bubble).toBeTruthy();
    fireEvent.keyDown(bubble, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Your trade" }).textContent).toContain("Directional traders on this date: 7 long · 8 short, most of the money short");
  });

  it("counts smart wallets at a level in the panel", () => {
    show();
    const b = document.querySelector(`.sch-bubble[data-key="${marked.id}:yes"]`);
    expect(b).toBeTruthy();
    fireEvent.keyDown(b, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Your trade" }).textContent).toContain("Smart wallets here: 3 long · 1 short.");
    const list = screen.getByRole("list", { name: "Smart wallets at this level" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole("link").getAttribute("href")).toBe("/trader/0x28fb00000000000000000000000000000000aa01");
    expect(items[0].textContent).toContain("Short $42K");
    expect(items[0].textContent).toContain("P&L +$84.2K");
    expect(items[1].textContent).toContain("Long $9K");
    expect(items[1].textContent).toContain("P&L -$1.5K");
    expect(items[2].textContent).toContain("Not available yet");
  });

  it("closes the trade panel on a click outside it, and not on a drag or inside it", () => {
    show();
    fireEvent.keyDown(document.querySelector(`.sch-bubble[data-key="${marked.id}:yes"]`), { key: "Enter" });
    const panel = screen.getByRole("dialog", { name: "Your trade" });
    const fire = (el, type, [clientX, clientY]) => fireEvent(el, new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY }));
    const click = (el, from = [10, 10], to = from) => { fire(el, "pointerdown", from); fire(el, "pointerup", to); };
    click(panel.querySelector("header"));
    expect(screen.queryByRole("dialog", { name: "Your trade" })).toBeTruthy();
    click(document.querySelector(".sch-svg"), [10, 10], [80, 40]);  // moving the chart
    expect(screen.queryByRole("dialog", { name: "Your trade" })).toBeTruthy();
    click(document.querySelector(".sch-svg"));
    expect(screen.queryByRole("dialog", { name: "Your trade" })).toBeNull();
  });

  it("uses no forecast words", () => {
    show();
    expect(document.body.textContent).not.toMatch(BANNED);
  });
});
