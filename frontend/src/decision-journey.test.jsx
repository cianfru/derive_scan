import React from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import hype from "./fixtures/questions/HYPE.json";
import index from "./fixtures/questions/index.json";
const docs = vi.hoisted(() => ({ data: {}, errors: {}, retries: {} }));
vi.mock("./lib/data.js", () => ({ useData: (p) => ({ data: docs.data[p] ?? null, error: docs.errors[p] ?? null, retry: docs.retries[p] }) }));
vi.mock("./components/SettleChart.jsx", () => ({ default: () => <div>Price chart</div> }));
import Saloon from "./pages/Saloon.jsx";
import Questions from "./pages/Questions.jsx";
import { _resetDecision, readDecision, toggleComparison } from "./lib/decision.js";
const NOW = 1791036600;
const candles = Array.from({ length: 80 }, (_, i) => [NOW - (80 - i) * 14400, 84000, 84200, 83800, 84050]);
const chart = () => document.querySelector('.sch-bubble:not(.sch-dot)');
const panel = () => screen.getByRole("complementary", { name: "Your trade" });
const amount = () => document.querySelector('#sl-dollars');
const open = () => { const b = chart(); b.focus(); fireEvent.keyDown(b, { key: "Enter" }); return b; };
const close = () => fireEvent.click(within(panel()).getByRole("button", { name: "Close", exact: true }));
function show(path = "/saloon?coin=HYPE") {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/saloon" element={<Saloon />} /><Route path="/q/:id" element={<Questions />} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW * 1000); _resetDecision(); localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  docs.data = { "questions/index.json": { ...index, coins: index.coins.filter((c) => ["BTC", "HYPE"].includes(c.und)) }, "questions/BTC.json": btc, "questions/HYPE.json": hype, "markets.json": { coins: [] }, "coins/BTC.json": { candles: { "4h": candles } }, "coins/HYPE.json": { candles: { "4h": candles.map(([t, ...v]) => [t, ...v.map((x) => x / 900)]) } } };
  docs.errors = {}; docs.retries = { "questions/HYPE.json": vi.fn(), "coins/HYPE.json": vi.fn() };
});
afterEach(() => { cleanup(); _resetDecision(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("decision continuity and recovery", () => {
  it("retains decimal draft, coin, level, date and side through details, Back, List and Chart", () => {
    show(); open(); const choice = readDecision().outcome;
    fireEvent.change(amount(), { target: { value: "250.50" } }); fireEvent.click(within(panel()).getByRole("link", { name: "Full details" }));
    expect(document.querySelector('#q-dollars').value).toBe("250.50"); fireEvent.click(screen.getByRole("link", { name: /All outcomes/ }));
    expect(amount().value).toBe("250.50"); expect(readDecision().outcome).toEqual(choice); close(); expect(readDecision().outcome).toEqual(choice);
    fireEvent.click(screen.getByRole("link", { name: "List", exact: true })); expect(screen.getByRole("tab", { name: "HYPE", exact: true }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("link", { name: "Chart", exact: true })); expect(screen.getByRole("tab", { name: /Hyperliquid/ }).getAttribute("aria-selected")).toBe("true"); open(); expect(amount().value).toBe("250.50");
  });
  it("preserves later edits on remount without replaying an entry's old navigation state", () => {
    const lv = btc.dates[1].levels.find((x) => x.ladder === 7 && x.yes?.buy > 0);
    const path = { pathname: `/q/${lv.id}`, search: "?side=yes", key: "same-entry", state: { dollars: 25, amountDraft: "25.00" } };
    show(path); fireEvent.change(document.querySelector('#q-dollars'), { target: { value: "250.50" } }); cleanup(); show(path); expect(document.querySelector('#q-dollars').value).toBe("250.50");
  });
  it("preserves budget across levels and rejects invalid drafts for review", () => {
    show(); open(); fireEvent.change(amount(), { target: { value: "250.50" } }); close(); fireEvent.keyDown(document.querySelectorAll('.sch-bubble:not(.sch-dot)')[1], { key: "Enter" }); expect(amount().value).toBe("250.50");
    for (const value of ["", ".", "1.2.3"]) { fireEvent.change(amount(), { target: { value } }); expect(within(panel()).getByRole("button", { name: "Review trade" }).disabled).toBe(true); }
  });
  it("keeps explicit comparison order across coins with one shared budget and a limit of three", () => {
    show("/saloon?coin=BTC"); open(); fireEvent.click(within(panel()).getByRole("button", { name: /^Compare BTC/ })); close(); fireEvent.click(screen.getByRole("tab", { name: /Hyperliquid/ })); open(); fireEvent.click(within(panel()).getByRole("button", { name: /^Compare HYPE/ }));
    const comparison = screen.getByRole("region", { name: "Compare outcomes" }); expect(within(comparison).getAllByRole("article")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Comparison amount, fees included"), { target: { value: "250.50" } }); expect(amount().value).toBe("250.50"); expect(comparison.textContent).toContain("For $250.50 each"); expect(within(panel()).getByRole("button", { name: "View comparison (2)" })).toBeTruthy();
    const selected = readDecision().compare; act(() => toggleComparison({ id: btc.dates[2].levels[1].id, side: "yes" })); act(() => toggleComparison({ id: btc.dates[3].levels[1].id, side: "yes" })); expect(readDecision().compare).toHaveLength(3); expect(readDecision().compare.slice(0, 2)).toEqual(selected);
  });
  it("does not substitute BTC after HYPE fails, and its recovery link keeps HYPE", () => {
    docs.data["questions/HYPE.json"] = null; docs.errors["questions/HYPE.json"] = new Error("503"); show(); expect(screen.getByRole("tab", { name: /Hyperliquid/ }).getAttribute("aria-selected")).toBe("true"); expect(screen.getByRole("heading", { name: "HYPE outcome data is unavailable." })).toBeTruthy(); expect(chart()).toBeNull(); expect(screen.getByRole("link", { name: "View the list" }).getAttribute("href")).toContain("coin=HYPE"); fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true })); expect(docs.retries["questions/HYPE.json"]).toHaveBeenCalledOnce();
  });
  it("ends failed candle loading and explicitly retains refresh-failed data", () => {
    docs.data["coins/HYPE.json"] = null; docs.errors["coins/HYPE.json"] = new Error("503"); show(); expect(screen.getByRole("heading", { name: "HYPE chart data is unavailable." })).toBeTruthy(); expect(screen.queryByLabelText("Loading")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true })); expect(docs.retries["coins/HYPE.json"]).toHaveBeenCalledOnce(); cleanup(); docs.data["coins/HYPE.json"] = { candles: { "4h": candles.map(([t, ...v]) => [t, ...v.map((x) => x / 900)]) } }; docs.errors["questions/HYPE.json"] = new Error("refresh"); show(); expect(screen.getAllByText("Refresh failed. Showing the last available data.").length).toBeGreaterThan(0); expect(chart()).toBeTruthy();
  });
  it("ages the selected coin independently of the fresh index", () => {
    docs.data["questions/HYPE.json"] = { ...hype, prices_ts: NOW - 36 * 60 }; show(); open(); expect(within(panel()).getByText("Prices are 36 min old.")).toBeTruthy(); cleanup(); docs.data["questions/HYPE.json"] = { ...hype, prices_ts: NOW - 91 * 60 }; show(); expect(screen.getByRole("heading", { name: "HYPE prices paused." })).toBeTruthy(); expect(chart()).toBeNull();
  });
  it("contains mobile focus, closes help first, unlocks and restores the bubble", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })); show(); const b = open(), dialog = screen.getByRole("dialog", { name: "Your trade" }); expect(dialog.getAttribute("aria-modal")).toBe("true"); expect(document.body.style.overflow).toBe("hidden"); expect(document.querySelector(".sl-ctabs-wrap").hasAttribute("inert")).toBe(true);
    const button = within(dialog).getByRole("button", { name: "Close", exact: true }); button.focus(); fireEvent.keyDown(button, { key: "Tab", shiftKey: true }); expect(dialog.contains(document.activeElement)).toBe(true); fireEvent.click(within(dialog).getByRole("button", { name: "About the amount" })); fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("dialog", { name: "About the amount" })).toBeNull(); expect(screen.getByRole("dialog", { name: "Your trade" })).toBeTruthy(); fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("dialog", { name: "Your trade" })).toBeNull(); expect(document.body.style.overflow).toBe(""); expect(document.activeElement.dataset.key).toBe(b.dataset.key);
  });
});
