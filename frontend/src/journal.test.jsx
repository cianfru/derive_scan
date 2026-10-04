import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import index from "./fixtures/questions/index.json";
import hist from "./fixtures/questions/history-BTC-20261009.json";
import { BANNED, findLevel } from "./lib/questions.js";
import {
  _resetMemory, addPosition, exportPositions, importPositions, loadPositions, persistent, positionFigures, prune, savePositions,
} from "./lib/positions.js";
import { captureContext, compareReadings, fillFacts, horizonFor, markBenchmark, settleBreakeven, timingOf } from "./lib/journal.js";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
vi.mock("./components/QuestionChart.jsx", () => ({ default: () => <div data-testid="chart" /> }));
import Questions from "./pages/Questions.jsx";
import MyQuestions from "./pages/MyQuestions.jsx";

const T14 = 1791036000; // Sat 3 Oct 2026 14:00 UTC
const G = T14 - 900;   // markets.json published 13:45 UTC
const reading = (state, extra = {}) => ({ status: "ready", state, ...extra });
const readings = (obs = G - 300) => ({
  engine: reading("up", { signal: "LIGHT_LONG", regime: "MARKUP", timeframe: "1d", data_status: "ready", observed_at: G - 3600 * 13 }),
  options: reading("neutral", { version: 2, observed_at: obs }),
  wallets: reading("defensive", { valuation_at: obs }),
});
const marketsAt = (gen, obs) => ({ generated_at: gen, analytics_version: 2, coins: [{ und: "BTC",
  align: { version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: { "7d": readings(obs), "30d": readings(obs) } } }] });

const Q86 = "/q/BTC-20261009-A-83000-89000";
const lv = findLevel(btc, "BTC-20261009-A-83000-89000").level;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((T14 + 600) * 1000);
  _resetMemory();
  try { localStorage.clear(); } catch { /* blocked */ }
  docs.current = { "questions/index.json": index, "questions/BTC.json": btc, "questions/history/BTC-20261009.json": hist, "markets.json": marketsAt(G) };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const show = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/saloon/mine" element={<MyQuestions />} />
      <Route path="/q/:id" element={<Questions />} />
    </Routes>
  </MemoryRouter>,
);

async function place({ fillAt = "2026-10-03T13:55", choice = "Both filled", perOption = true, fees = "1.52" } = {}) {
  const user = userEvent.setup({ advanceTimers: () => {} });
  const { container } = show(`${Q86}?side=yes`);
  await user.click(screen.getByRole("button", { name: "Review orders" }));
  const ticket = container.querySelector(".q-ticket");
  await user.click(within(ticket).getByRole("button", { name: "I placed it" }));
  await user.click(within(ticket).getByRole("radio", { name: choice }));
  if (fillAt) fireEvent.change(within(ticket).getByLabelText("When it filled, UTC"), { target: { value: fillAt } });
  else await user.click(within(ticket).getByRole("checkbox", { name: "I don't know when" }));
  if (perOption) {
    await user.click(within(ticket).getByRole("radio", { name: "A price per option" }));
    await user.type(within(ticket).getByRole("textbox", { name: "Price per contract, line 1" }), "2431");
    if (choice === "Both filled") await user.type(within(ticket).getByRole("textbox", { name: "Price per contract, line 2" }), "162");
  } else {
    await user.type(within(ticket).getByRole("textbox", { name: "Premium paid, before fees" }), "100");
  }
  if (fees == null) await user.click(within(ticket).getByRole("checkbox", { name: "I don't know the fees" }));
  else await user.type(within(ticket).getByRole("textbox", { name: "Derive's fees" }), fees);
  await user.click(within(ticket).getByRole("button", { name: "Save to Positions" }));
  cleanup();
  return loadPositions();
}

describe("journal J1: recording a manual trade", () => {
  it("keeps the package, fills, costs, mark and readings, and survives reload and export/import intact", async () => {
    const [p] = await place();
    const j = p.journal;
    expect(p).toMatchObject({ v: 2, network: "mainnet", exec: "hand_both", contracts: 0.04277 });
    expect(j.package.legs).toEqual([
      { name: "BTC-20261009-83000-C", act: "buy", signed_qty: 0.04277 },
      { name: "BTC-20261009-89000-C", act: "sell", signed_qty: -0.04277 },
    ]);
    expect(j.package).toMatchObject({ venue: "Derive", network: "mainnet", direction: "Higher", expiry: "20261009", lo: 83000, hi: 89000 });
    // Premium from the legs (2,431 - 162) x 0.04277, fees apart, both entered by the user.
    expect(j.fill).toMatchObject({ ts: Date.UTC(2026, 9, 3, 13, 55) / 1000, complete: true, currency: "USDC", fees: 1.52, fees_known: true, limitation: null });
    expect(j.fill.premium).toBeCloseTo((2431 - 162) * 0.04277, 6);
    expect(j.cost.total).toBeCloseTo(j.fill.premium + 1.52, 6);
    expect(p.paid).toBeCloseTo(j.cost.total, 6);
    expect(j.cost.breakeven_basis).toBe("exact");
    expect(j.cost.breakeven).toBeCloseTo(83000 + j.cost.total / 0.04277, 1);
    // The board's estimate is kept apart and labelled as one; the mark is a benchmark with its time.
    expect(j.board_estimate.total).toBeCloseTo(100.00, 2); // $100 typed: the total, fees included
    expect(j.mark).toMatchObject({ source: "Derive mark, Cowboy board", ts: btc.prices_ts });
    expect(j.mark.value).toBeCloseTo(lv.fair * 6000 * 0.04277, 6);
    // Three times kept apart; every reading published 13:45, before the 13:55 fill.
    expect(j.context).toMatchObject({ status: "at_fill", fill_ts: Date.UTC(2026, 9, 3, 13, 55) / 1000, snapshot_ts: T14 + 600, published_at: G, horizon: "7d" });
    expect(j.context.readings.engine).toMatchObject({ label: "Leaning up", timing: "entry", published_at: G, version: { align: 2, analytics: 2 } });
    expect(j.context.readings.wallets).toMatchObject({ label: "Short delta", timing: "entry", source_ts: G - 300 });

    // Reload: the saved record renders from storage with its entry readings.
    docs.current["markets.json"] = marketsAt(T14 + 1800, T14 + 1500); // a later publication
    vi.setSystemTime((T14 + 2400) * 1000);
    const { container } = show("/saloon/mine");
    const strip = container.querySelector(".q-since");
    expect(strip.textContent).toContain("Saved at your fill");
    const rows = [...strip.querySelectorAll("tbody tr")].map((r) => r.textContent);
    expect(rows[0]).toMatch(/^RegimeLeaning up.*Leaning up/);
    expect(rows[1]).toMatch(/^WalletsShort delta3 Oct 13:40 UTCShort delta3 Oct 14:25 UTC$/);
    cleanup();

    // Export, clear, import: identical; importing twice adds nothing.
    const file = exportPositions();
    expect(JSON.parse(file)).toMatchObject({ kind: "cowboy-journal", version: 3 });
    localStorage.clear(); _resetMemory();
    expect(loadPositions()).toHaveLength(0);
    importPositions(file);
    importPositions(file);
    expect(loadPositions()).toEqual([p]);
  });

  it("gives a late entry no future context: readings published after the fill are Saved later", async () => {
    const [p] = await place({ fillAt: "2026-10-03T13:40" }); // filled before the 13:45 publication
    expect(p.journal.context.status).toBe("saved_later");
    expect(Object.values(p.journal.context.readings).every((r) => r.timing === "later")).toBe(true);
    expect(p.journal.mark.timing).toBe("later"); // the board's mark is from after the fill too
    const { container } = show("/saloon/mine");
    const strip = container.querySelector(".q-since");
    expect(strip.textContent).toContain("Saved later");
    const entryCells = [...strip.querySelectorAll("tbody tr td:nth-child(2)")].map((c) => c.textContent);
    expect(entryCells).toEqual(["Saved lateri", "Saved lateri", "Saved lateri"]);
    // The later reading's value lives only in its (i), with both times.
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(within(strip).getByRole("button", { name: "Wallets at entry" }));
    expect(document.querySelector(".pop").textContent).toMatch(/Published 2026-10-03 13:45 UTC, after your fill at 2026-10-03 13:40 UTC/);
  });

  it("treats an unknown fill time, an unknown publication time and reconstructed history as Saved later", async () => {
    const [p] = await place({ fillAt: null });
    expect(p.journal.fill.ts).toBeNull();
    expect(p.journal.context.status).toBe("saved_later");
    const m = marketsAt(G);
    delete m.generated_at;
    expect(captureContext({ markets: m, und: "BTC", settleTs: 1791532800, fillTs: T14, savedTs: T14 }).status).toBe("saved_later");
    expect(timingOf({ published_at: G, source_ts: G, reconstructed: true }, T14)).toBe("later");
    expect(timingOf({ published_at: G, source_ts: T14 + 60 }, T14)).toBe("later");
    expect(timingOf({ published_at: T14, source_ts: G }, T14)).toBe("entry"); // at the fill counts
    // Never today's: a later publication never moves into an older entry.
    const later = captureContext({ markets: marketsAt(T14 + 60), und: "BTC", settleTs: 1791532800, fillTs: T14, savedTs: T14 + 120 });
    expect(later.status).toBe("saved_later");
  });

  it("keeps a partial fill incomplete everywhere", async () => {
    const [p] = await place({ choice: "Only the first" });
    expect(p.exec).toBe("hand_partial");
    expect(p.journal.fill.complete).toBe(false);
    expect(p.journal.fill.legs.map((l) => l.qty)).toEqual([0.04277, 0]);
    expect(p.journal.cost.breakeven_basis).toBe("unavailable");
    expect(positionFigures(p, { found: { level: lv }, settlePrice: 86000 })).toMatchObject({ partial: true, maxPayout: null, got: null });
    // Unequal amounts on the two lines are partial too, even when the user says both filled.
    const f = fillFacts({ choice: "both", mode: "legs", side: "yes", lo: 83000, hi: 89000, plannedContracts: 0.04, feesKnown: true, fees: 1,
      legs: [{ name: "a", act: "buy", planned: 0.04, qty: 0.04, price: 2431 }, { name: "b", act: "sell", planned: 0.04, qty: 0.02, price: 162 }] });
    expect(f.complete).toBe(false);
    expect(f.cost.breakeven).toBeNull();
    const back = importPositions(exportPositions());
    expect(back[0].journal.fill.complete).toBe(false);
    const { container } = show("/saloon/mine");
    expect(container.textContent).toContain("Placed by hand · only the first filled");
    expect(container.querySelector(".q-entry").textContent).toContain("Not fully filled");
  });

  it("marks a breakeven from estimated fees, and a package total as a limitation", async () => {
    const [p] = await place({ perOption: false, fees: null });
    expect(p.journal.fill).toMatchObject({ limitation: "package_total", fees: null, fees_known: false });
    expect(p.journal.cost.fees_basis).toBe("estimated");
    expect(p.journal.cost.breakeven_basis).toBe("estimated");
    const { container } = show("/saloon/mine");
    const rec = container.querySelector(".q-entry").textContent;
    expect(rec).toContain("one total; leg prices not entered");
    expect(rec).toContain("not entered · estimated");
    expect(rec).toMatch(/Breakeven at settlementestimated\$\d/);
    expect(container.querySelector(".q-figs").textContent).toContain("estimated fees included");
    expect(settleBreakeven({ side: "no", lo: 83000, hi: 89000, contracts: 0.01, cost: 30 })).toBe(86000);
    expect(settleBreakeven({ side: "yes", lo: 83000, hi: 89000, contracts: 0.01, cost: 70 })).toBeNull();
  });
});

describe("journal J1: Positions", () => {
  const legacy = { key: "old", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
    question: "x", answer: "Higher", settle_ts: 1791532800, legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both" };

  it("keeps legacy entries visible with their unknown fields", () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([legacy]));
    const { container } = show("/saloon/mine");
    expect(container.querySelectorAll(".q-card")).toHaveLength(1);
    expect(loadPositions()[0].network).toBe("mainnet");
    const strip = container.querySelector(".q-since");
    expect(strip.textContent).toContain("Saved before entry records");
    expect([...strip.querySelectorAll("tbody tr td:nth-child(2)")].every((c) => c.textContent === "Not available yeti")).toBe(true);
    expect(strip.querySelector("tbody tr td:nth-child(3)").textContent).toMatch(/^Leaning up/); // the latest still shows
    expect(container.querySelector(".q-entry").textContent).toContain("are unknown");
    // A version 1 export imports as mainnet, once.
    localStorage.clear(); _resetMemory();
    importPositions(JSON.stringify({ kind: "cowboy-questions", version: 1, positions: [legacy] }));
    importPositions(JSON.stringify([legacy]));
    expect(loadPositions()).toEqual([{ ...legacy, network: "mainnet", exits: [] }]);
    expect(() => importPositions(JSON.stringify({ kind: "cowboy-journal", version: 9, networks: {} }))).toThrow("newer");
  });

  it("says Not available yet for a missing or differently calculated latest reading", async () => {
    const [p] = await place();
    const m = marketsAt(T14 + 1800, T14 + 1500);
    m.coins[0].align.readings["7d"].options.version = 3;
    delete m.coins[0].align.readings["7d"].wallets;
    const rows = compareReadings(p, m, T14 + 2400);
    expect(rows.map((r) => r.latest.text)).toEqual(["Leaning up", "Not available yet", "Not available yet"]);
    expect(rows[2].latest.why).toMatch(/calculated differently/);
    expect(rows.map((r) => r.entry.text)).toEqual(["Leaning up", "Short delta", "Balanced tone"]);
    expect(compareReadings(p, null, T14).every((r) => r.latest.text === "Not available yet")).toBe(true);
  });

  it("works by keyboard: every (i) in the strip is reachable with Tab and opens with Enter", async () => {
    await place({ fillAt: "2026-10-03T13:40" });
    const { container } = show("/saloon/mine");
    const strip = container.querySelector(".q-since");
    expect(strip.querySelector("table thead th[scope='col']")).not.toBeNull();
    expect(strip.querySelectorAll("tbody th[scope='row']")).toHaveLength(3);
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByText("Position details"));
    const infos = within(strip).getAllByRole("button");
    for (let i = 0; i < 40 && document.activeElement !== infos[1]; i++) await user.tab();
    expect(document.activeElement).toBe(infos[1]);
    await user.keyboard("{Enter}");
    expect(document.querySelector(".pop").textContent).toMatch(/later context/);
    await user.keyboard("{Escape}");
    expect(document.querySelector(".pop")).toBeNull();
    for (const t of [container.textContent]) expect(t).not.toMatch(BANNED);
  });

  it("keeps journal entries through the 90-day pruning, and testnet apart from mainnet", async () => {
    const [p] = await place();
    const now = p.settle_ts + 200 * 86400;
    const old = { ...legacy, key: "gone" };
    expect(prune([p, old], now).map((x) => x.key)).toEqual([p.key]);
    expect(prune([{ ...p, closed_at: p.settle_ts - 86400, proceeds: 90 }], now)).toHaveLength(1);
    addPosition({ ...legacy, network: "testnet" });
    expect(loadPositions("testnet")).toHaveLength(1);
    expect(loadPositions("mainnet")).toHaveLength(1);
    const file = JSON.parse(exportPositions());
    expect(file.networks.testnet).toHaveLength(1);
    expect(file.networks.mainnet).toHaveLength(1);
    // A testnet record filed under mainnet in a file goes to its own network.
    localStorage.clear(); _resetMemory();
    importPositions(JSON.stringify({ kind: "cowboy-journal", version: 2, networks: { mainnet: [...file.networks.mainnet, ...file.networks.testnet] } }));
    expect(loadPositions("testnet")).toHaveLength(1);
    expect(loadPositions("mainnet")).toHaveLength(1);
    const { container } = show("/saloon/mine");
    expect(container.textContent).toContain("1 testnet record is kept apart");
  });

  it("shows when the browser is not saving", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    savePositions([legacy]);
    expect(persistent()).toBe(false);
    const { container } = show("/saloon/mine");
    expect(container.textContent).toContain("This browser is not saving data");
    spy.mockRestore();
  });

  it("picks the readings' horizon from the time to settlement", () => {
    expect(horizonFor(T14 + 6 * 86400, T14)).toBe("7d");
    expect(horizonFor(T14 + 20 * 86400, T14)).toBe("30d");
    expect(markBenchmark({ level: lv, side: "no", contracts: 0.01, pricesTs: T14, fillTs: T14 })).toMatchObject({ timing: "entry" });
    expect(markBenchmark({ level: lv, side: "no", contracts: 0.01, pricesTs: T14, fillTs: T14 }).per).toBeCloseTo(1 - lv.fair, 6);
  });
});
