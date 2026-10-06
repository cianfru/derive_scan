import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import hype from "./fixtures/questions/HYPE.json";
import index from "./fixtures/questions/index.json";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
import Board, { returnText } from "./pages/Board.jsx";
import { SaloonNotices } from "./components/SaloonNotices.jsx";
import { BANNED, ticket } from "./lib/questions.js";
import { DEFAULT_SORT, SORTS, boardRows, budgetTicket, cleanBudget, coinRank, costOverMark, dateRows, exitCost, filterRows, markFor, sortRows } from "./lib/board.js";
import {
  KEY, _resetMemory, computeNotices, dismiss, exportFollows, follow, importFollows, loadBudget, loadDoc, migrate,
  researchChanges, saveBudget, saveDoc, setLevel,
} from "./lib/follows.js";

const T14 = 1791036000;
const NOW = T14 + 600;
const H = "BTC-20261005-A-82000-88000"; // Higher 49c, Lower 55c (rounded up), $1,500 each side
const idx = { ...index, coins: index.coins.filter((c) => ["BTC", "HYPE"].includes(c.und)) };
const align = (state) => ({ version: 2, readings: { "7d": { engine: { signal: "STRONG_LONG", state, status: "ready", regime: "MARKUP", data_status: "ready" } } } });
const markets = (state) => ({ coins: [{ und: "BTC", regime_1d: "MARKUP", signal_1d: "STRONG_LONG", align: align(state) }, { und: "HYPE", regime_1d: "ACCUM", signal_1d: "WAIT", align: align(state) }] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  localStorage.clear();
  _resetMemory();
  docs.current = { "questions/index.json": idx, "questions/BTC.json": btc, "questions/HYPE.json": hype, "markets.json": markets("up") };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function QuestionProbe() {
  const location = useLocation();
  return <p>question page {location.search || "no side"} budget {location.state?.dollars}</p>;
}

const show = (path = "/saloon/browse") => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/saloon/browse" element={<Board />} />
      <Route path="/saloon/following" element={<Board followingOnly />} />
      <Route path="/q/:id" element={<QuestionProbe />} />
    </Routes>
  </MemoryRouter>,
);

describe("board maths per budget", () => {
  const level = btc.dates[1].levels.find((l) => l.id === H);
  it("fits the total, fees included, inside the budget and shows what it pays and makes", () => {
    for (const budget of [25, 100, 500]) {
      const t = budgetTicket(level, "yes", budget, btc);
      expect(t.mostLose).toBeLessThanOrEqual(budget + 1e-9);
      expect(t.mostLose).toBeGreaterThan(budget * 0.97); // only the amount step and rounding are left over
      expect(t.mostLose).toBeCloseTo(t.premium + t.fees, 9);
      expect(t.payout).toBeCloseTo(t.contracts * (level.hi - level.lo), 9);
      // The same contracts priced by the guided flow's ticket give the same figures.
      const same = ticket(level, "yes", t.premium, btc);
      expect(same.contracts).toBe(t.contracts);
      expect(same.fees).toBeCloseTo(t.fees, 9);
    }
    const { rows } = boardRows([btc], 100, { now: NOW });
    const r = rows.find((x) => x.key === `${H}:yes`);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.make).toBeCloseTo(r.payout - r.total, 9);
    expect([r.lo, r.hi]).toEqual([82000, 88000]);
    expect(r.size).toBe(1500);
    expect(r.settleTs).toBe(Date.UTC(2026, 9, 5, 8) / 1000);
    // Cost over mark per $1 of payout, before fees: 49c paid per $1 minus Derive's mark 47.37c = +1.63c.
    expect(r.overMark).toBeCloseTo(r.premium / r.payout - level.fair, 9);
    expect(r.overMark).toBeCloseTo(0.0163, 9);
    // Fees are their own figure; exit cost now is the mark minus the sell-back price per $1 (47.37c - 45.43c).
    expect(r.fees).toBeCloseTo(r.total - r.premium, 9);
    expect(r.feesPer).toBeCloseTo(r.fees / r.payout, 9);
    expect(r.exitCost).toBeCloseTo(0.4737 - 0.4543, 9);
    expect(r.markTs).toBe(btc.prices_ts);
  });
  it("prices a $100 row and a $100 guided ticket the same: the amount is the total, fees included", () => {
    const r = boardRows([btc], 100, { now: NOW }).rows.find((x) => x.key === `${H}:yes`);
    const g = budgetTicket(level, "yes", 100, btc);
    expect([r.total, r.premium, r.fees, r.payout]).toEqual([g.mostLose, g.premium, g.fees, g.payout]);
    expect(g.budget).toBe(100);
    // A budget below Derive's base fees buys nothing and says the smallest total.
    const tiny = budgetTicket(level, "yes", 0.5, btc);
    expect(tiny.belowMin).toBe(true);
    expect(tiny.minTotal).toBeCloseTo(tiny.minCost + 2 * 0.5 + (Math.min(0.0003 * btc.index, 0.125 * 2962) + Math.min(0.0003 * btc.index, 0.125 * 22)) * btc.spec.min, 9);
  });
  it("stops at the size at this price for a large budget", () => {
    const r = boardRows([btc], 100000, { now: NOW }).rows.find((x) => x.key === `${H}:yes`);
    expect(r.capped).toBe(true);
    expect(r.payout).toBeLessThanOrEqual(1500 + 1e-6);
  });
  it("lists answers with no price, or below the smallest amount, under No price now with the reason", () => {
    const { rows, noPrice } = boardRows([btc], 100, { now: NOW });
    expect(rows.every((r) => r.expiry !== "20261004")).toBe(true); // a date kept for holders only
    const np = noPrice.find((x) => x.key === "BTC-20261005-A-78000-84000:yes");
    expect(np.reason).toMatch(/no price on both options/);
    expect(boardRows([btc], 0.01, { now: NOW }).noPrice.some((x) => /below the smallest amount/.test(x.reason))).toBe(true);
    // Paused prices: nothing can be bought.
    expect(boardRows([btc], 100, { now: NOW, paused: true }).rows).toHaveLength(0);
    expect(cleanBudget("abc")).toBe(100);
    expect(cleanBudget("$250")).toBe(250);
  });
});

describe("cost over mark", () => {
  const level = btc.dates[1].levels.find((l) => l.id === H);
  it("normalises to $1 of maximum payout, so the budget does not change it", () => {
    const at = (b) => boardRows([btc], b, { now: NOW }).rows.find((x) => x.key === `${H}:no`).overMark;
    // Lower: 54.4c per $1 before fees minus the mark 1 - 47.37c = 52.63c.
    expect(at(50)).toBeCloseTo(0.544 - (1 - 0.4737), 9);
    expect(at(500)).toBeCloseTo(at(50), 9);
    expect(costOverMark({ premium: 49, payout: 100 }, 0.4737)).toBeCloseTo(0.0163, 9);
    expect(costOverMark({ premium: 49, payout: 0 }, 0.4737)).toBeNull();
    expect(exitCost(level, "yes", null)).toBeNull();
    expect(exitCost({ yes: {} }, "yes", 0.5)).toBeNull();
  });
  it("is not available when the mark is missing, older than the prices or stale, with the reason", () => {
    expect(markFor(level, "yes", btc, NOW)).toMatchObject({ per: 0.4737, ts: btc.prices_ts, reason: null });
    expect(markFor({ ...level, fair: null }, "yes", btc, NOW).reason).toMatch(/missing/);
    const older = markFor({ ...level, fair_ts: btc.prices_ts - 900 }, "yes", btc, NOW);
    expect(older.per).toBeNull();
    expect(older.reason).toMatch(/older than the prices/);
    const stale = markFor(level, "yes", btc, btc.prices_ts + 36 * 60);
    expect(stale.per).toBeNull();
    expect(stale.reason).toMatch(/more than 35 minutes ago/);
    // On the board: the row stays, with no cost over mark and no exit cost, and the reason kept.
    const noMark = { ...btc, dates: btc.dates.map((d) => ({ ...d, levels: d.levels.map((l) => (l.id === H ? { ...l, fair: null } : l)) })) };
    const r = boardRows([noMark], 100, { now: NOW }).rows.find((x) => x.key === `${H}:yes`);
    expect([r.overMark, r.exitCost, r.markPer]).toEqual([null, null, null]);
    expect(r.markReason).toMatch(/missing/);
    expect(boardRows([btc], 100, { now: btc.prices_ts + 40 * 60 }).rows.every((x) => x.overMark == null)).toBe(true);
  });
  it("orders lowest first, with rows not available yet last", () => {
    // By date became the default view (owner, 4 October 2026); cost over mark is the first of the other orders.
    expect(DEFAULT_SORT).toBe("date");
    expect(SORTS.slice(0, 2)).toEqual([["date", "By date"], ["mark", "Lowest cost over mark"]]);
    const noMark = { ...btc, dates: btc.dates.map((d) => ({ ...d, levels: d.levels.map((l) => (l.id === H ? { ...l, fair: null } : l)) })) };
    const sorted = sortRows(boardRows([noMark, hype], 100, { now: NOW }).rows, "mark");
    const n = sorted.findIndex((r) => r.overMark == null);
    expect(n).toBeGreaterThan(0);
    expect(sorted.slice(n).every((r) => r.overMark == null)).toBe(true);
    expect(sorted.slice(n).map((r) => r.key)).toEqual(expect.arrayContaining([`${H}:yes`, `${H}:no`]));
    expect(sorted.slice(0, n).every((r, i) => i === 0 || sorted[i - 1].overMark <= r.overMark)).toBe(true);
  });
});

describe("filters and order", () => {
  const { rows } = boardRows([btc, hype], 100, { now: NOW });
  it("filters by coin, date range and answer", () => {
    expect(filterRows(rows, { coin: "HYPE" }, NOW).every((r) => r.und === "HYPE")).toBe(true);
    expect(filterRows(rows, { side: "no" }, NOW).every((r) => r.side === "no")).toBe(true);
    const near = filterRows(rows, { range: "2" }, NOW);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((r) => r.settleTs - NOW <= 2 * 86400)).toBe(true);
    expect(filterRows(rows, {}, NOW)).toHaveLength(rows.length);
  });
  it("orders by cost over mark, closeness to the price, settlement or size", () => {
    const pairs = (list, f) => list.slice(1).every((r, i) => f(list[i], r));
    expect(pairs(sortRows(rows, "mark"), (a, b) => a.overMark <= b.overMark)).toBe(true);
    expect(pairs(sortRows(rows, "near"), (a, b) => a.distance <= b.distance)).toBe(true);
    expect(pairs(sortRows(rows, "soon"), (a, b) => a.settleTs <= b.settleTs)).toBe(true);
    expect(pairs(sortRows(rows, "size"), (a, b) => a.size >= b.size)).toBe(true);
    // Stable: the same input in another order gives the same list.
    expect(sortRows([...rows].reverse(), "size").map((r) => r.key)).toEqual(sortRows(rows, "size").map((r) => r.key));
  });
  it("never uses the research layers: attaching any reading changes no order", () => {
    for (const sort of ["date", "mark", "near", "soon", "size"]) {
      const plain = sortRows(rows, sort).map((r) => r.key);
      const up = rows.map((r) => ({ ...r, align: align("up"), regime: "MARKUP", lean: "up" }));
      const down = rows.map((r, i) => ({ ...r, align: align(i % 2 ? "defensive" : "up"), regime: "MARKDOWN", lean: "defensive" }));
      expect(sortRows(up, sort).map((r) => r.key)).toEqual(plain);
      expect(sortRows(down, sort).map((r) => r.key)).toEqual(plain);
    }
  });
});

describe("the board page", () => {
  const order = () => screen.getAllByRole("link", { name: /view outcome/ }).map((a) => a.getAttribute("href"));
  it("groups a coin, level and date without letting research alter its order", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} });
    const pick = async () => u.selectOptions(screen.getByRole("combobox", { name: "Order" }), "mark");
    const { container } = show();
    const byDate = order();
    await pick();
    const first = order();
    const want = [...new Set(sortRows(boardRows([btc, hype], 100, { now: NOW }).rows, "mark").map((r) => `/q/${r.id}`))].slice(0, 24);
    expect(first).toEqual(want);
    expect(screen.queryByRole("button", { name: "$500" })).toBeNull(); // the amount is chosen on the outcome page
    const card = [...container.querySelectorAll(".bd-card")].find((c) => c.querySelectorAll("a.bd-choice").length === 2);
    const href = card.querySelector(".bd-question").getAttribute("href");
    expect(within(card).getAllByRole("link", { name: /see what it pays/ }).map((a) => a.getAttribute("href"))).toEqual([`${href}?side=yes`, `${href}?side=no`]);
    expect(card.textContent).toMatch(/Pays in part\$[\d,]+–\$[\d,]+/);
    expect(card.textContent).toMatch(/\+[\d,.]+%most you make/);
    expect(container.querySelector(".bd-key").textContent).toMatch(/Price per \$1 · most you make, as a share of cost/);
    // The share is the $100 ticket's most you can make over its total, fees included.
    const r = boardRows([btc, hype], 100, { now: NOW }).rows.find((x) => `/q/${x.id}` === href && x.side === "yes");
    expect(card.querySelector("a.bd-choice.yes .bd-choice-out b").textContent).toBe(returnText(r.make, r.total));
    cleanup();
    docs.current = { ...docs.current, "markets.json": markets("defensive") }; show(); expect(order()).toEqual(byDate); await pick(); expect(order()).toEqual(first);
    cleanup();
    docs.current = { ...docs.current, "markets.json": null }; show(); expect(order()).toEqual(byDate); await pick(); expect(order()).toEqual(first);
  });
  it("keeps comparisons behind details and missing-mark reasons available", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} });
    const { container } = show();
    expect(screen.getByRole("combobox", { name: "Order" }).value).toBe("date");
    const comparison = container.querySelector(".bd-comparison");
    expect(comparison.open).toBe(false);
    await u.click(comparison.querySelector("summary"));
    await within(comparison).findAllByText("Derive fees included");
    expect(comparison.textContent).toMatch(/Derive fees included.*Cost over mark.*Exit cost now/);
    cleanup();
    vi.setSystemTime((btc.prices_ts + 40 * 60) * 1000);
    const stale = show().container;
    expect(stale.querySelectorAll("a.bd-choice").length).toBeGreaterThan(0);
    const staleCard = stale.querySelector(".bd-card");
    await u.click(staleCard.querySelector("summary"));
    await within(staleCard).findAllByText("Not available yet");
    expect(staleCard.querySelectorAll(".bd-over .bd-notyet").length).toBe(staleCard.querySelectorAll("a.bd-choice").length);
    expect(stale.textContent).not.toMatch(BANNED);
  });
  it("keeps side filtering, and searches coin names or unformatted prices", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} });
    const { container } = show();
    await u.click(screen.getByRole("tab", { name: "HYPE" }));
    expect(order().every((n) => n.startsWith("/q/HYPE"))).toBe(true);
    expect(container.textContent).toMatch(/Thin book/);
    await u.selectOptions(screen.getByRole("combobox", { name: "Answer" }), "no");
    expect(screen.getAllByRole("link", { name: /see what it pays/ }).every((a) => a.getAttribute("href").endsWith("side=no"))).toBe(true);
    await u.click(screen.getByRole("tab", { name: "All coins" }));
    await u.type(screen.getByRole("searchbox", { name: "Search outcomes" }), "bitcoin");
    expect(order().every((n) => n.startsWith("/q/BTC"))).toBe(true);
    await u.clear(screen.getByRole("searchbox")); await u.type(screen.getByRole("searchbox"), "85000");
    expect(screen.getAllByRole("link", { name: /view outcome/ }).every((a) => a.getAttribute("aria-label").includes("$85,000"))).toBe(true);
    expect(container.textContent).not.toMatch(BANNED);
    expect(container.textContent).not.toMatch(/\b(hot|trending|best|top pick)\b/i);
  });
  it("opens a question with no side, passes a side only on an explicit choice, and leaves the amount to the outcome page", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} }); show();
    await u.click(screen.getAllByRole("link", { name: /view outcome/ })[0]);
    expect(screen.getByText("question page no side budget")).toBeTruthy();
    cleanup(); show();
    await u.click(screen.getAllByRole("link", { name: / Lower .*see what it pays/ })[0]);
    expect(screen.getByText("question page ?side=no budget")).toBeTruthy();
  });
  it("collapses phone filters without clearing their values, and marks nondefault settings", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} }); show();
    const toggle = screen.getByRole("button", { name: "Filters" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await u.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await u.selectOptions(screen.getByRole("combobox", { name: "Answer" }), "no");
    await u.selectOptions(screen.getByRole("combobox", { name: "Order" }), "soon");
    expect(toggle.textContent).toBe("Filters2");
    await u.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("combobox", { name: "Answer" }).value).toBe("no");
    expect(screen.getByRole("combobox", { name: "Order" }).value).toBe("soon");
    expect(screen.getAllByRole("link", { name: /see what it pays/ }).every((a) => a.getAttribute("href").endsWith("side=no"))).toBe(true);
  });
  it("shows an unavailable opposite answer with its gate reason instead of implying it is missing", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} });
    const date = btc.dates[1];
    const level = date.levels.find((l) => l.id === H);
    docs.current["questions/index.json"] = { ...idx, coins: [{ und: "BTC" }] };
    docs.current["questions/BTC.json"] = { ...btc, dates: [{ ...date, levels: [{ ...level, ladder: 15, no: { ...level.no, state: "screen_wide" } }] }] };
    const { container } = show();
    expect(container.querySelector(".bd-choice.off").textContent).toContain("LowerNo price");
    expect(screen.getAllByRole("link", { name: /see what it pays/ })).toHaveLength(1);
    await u.click(screen.getByRole("button", { name: /Why BTC Lower .* has no price/ }));
    expect(screen.getByRole("dialog").textContent).toMatch(/screen is too wide/);
    await u.selectOptions(screen.getByRole("combobox", { name: "Answer" }), "yes");
    expect(container.querySelector(".bd-choice.off")).toBeNull();
  });
  it("follows only the chosen answer and retains its editable notice level", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} }); show();
    await u.click(screen.getAllByRole("button", { name: /^Follow Lower/ })[0]);
    const doc = loadDoc(); expect(doc.follows).toHaveLength(1); expect(doc.follows[0].seen.init).toBe(true); expect(doc.follows[0].side).toBe("no");
    const f = doc.follows[0]; cleanup(); show("/saloon/following");
    expect(screen.getAllByRole("link", { name: /see what it pays/ }).map((a) => a.getAttribute("href"))).toEqual([`/q/${f.id}?side=no`]);
    await u.click(screen.getByText("Saved answers & notices"));
    await u.type(screen.getByRole("textbox", { name: "Notice at" }), "40{Enter}");
    expect(loadDoc().follows.find((x) => x.id === f.id).level).toBe(40);
    await u.type(screen.getByRole("searchbox"), "85000");
    expect(screen.queryAllByRole("link", { name: /see what it pays/ }).every((a) => a.getAttribute("href") === `/q/${f.id}?side=no`)).toBe(true);
  });
});

describe("by date", () => {
  const eth = { ...JSON.parse(JSON.stringify(btc).replaceAll("BTC-", "ETH-")), und: "ETH", index: 84500 };
  const groupsOf = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];
  const rowsOf = (boards, coins = ["BTC", "ETH", "HYPE"], f = {}) => dateRows(groupsOf(filterRows(boardRows(boards, 100, { now: NOW }).rows, f, NOW)), coins);
  it("puts rows by settlement, soonest first, Bitcoin then Ethereum then the coin bar on the same date", () => {
    const rows = rowsOf([hype, eth, btc], ["HYPE", "ETH", "BTC"]);
    expect(rows.every((r, i) => i === 0 || rows[i - 1].settleTs <= r.settleTs)).toBe(true);
    const fri = rows.filter((r) => r.expiry === "20261009").map((r) => r.und);
    expect(fri).toEqual(["BTC", "ETH", "HYPE"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    const rank = coinRank(["XRP", "HYPE", "ETH"]);
    expect(["HYPE", "ZZZ", "ETH", "XRP", "BTC"].sort((a, b) => rank(a) - rank(b))).toEqual(["BTC", "ETH", "XRP", "HYPE", "ZZZ"]);
  });
  it("runs levels from low to high inside a row, one card per level", () => {
    for (const r of rowsOf([btc, hype])) {
      expect(r.items.every((it, i) => i === 0 || r.items[i - 1].k < it.k)).toBe(true);
      expect(r.items.every((it) => it.und === r.und && it.expiry === r.expiry)).toBe(true);
    }
  });
  it("marks the index between the levels that straddle it", () => {
    for (const r of rowsOf([btc, hype])) {
      expect(r.index).toBe(r.und === "BTC" ? btc.index : hype.index);
      expect(r.items.slice(0, r.nowAt).every((it) => it.k <= r.index)).toBe(true);
      expect(r.items.slice(r.nowAt).every((it) => it.k > r.index)).toBe(true);
    }
    const one = (k) => ({ und: "BTC", expiry: "20261009", settleTs: 1, k, id: String(k), index: 84823.1 });
    expect(dateRows([one(86000), one(83000), one(85000), one(84000)])[0].nowAt).toBe(2);
    expect(dateRows([one(86000)])[0].nowAt).toBe(0);
    expect(dateRows([one(80000)])[0].nowAt).toBe(1);
    expect(dateRows([{ ...one(80000), index: null }])[0].nowAt).toBeNull();
  });
  it("applies the coin, date and answer filters to the rows", () => {
    expect(rowsOf([btc, hype], undefined, { coin: "HYPE" }).every((r) => r.und === "HYPE")).toBe(true);
    const near = rowsOf([btc, hype], undefined, { range: "2" });
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((r) => r.settleTs - NOW <= 2 * 86400)).toBe(true);
  });
  it("shows rows with a header and the index mark by default, and one flat grid for another order", async () => {
    const u = userEvent.setup({ advanceTimers: () => {} });
    const { container } = show();
    expect(screen.getByRole("combobox", { name: "Order" }).value).toBe("date");
    const rows = [...container.querySelectorAll(".bd-row")];
    expect(rows.length).toBeGreaterThan(1);
    expect(container.querySelector(".bd-grid")).toBeNull();
    const head = rows[0].querySelector(".bd-row-head").textContent;
    expect(head).toMatch(/^Bitcoin·Mon 5 Oct, 08:00 UTC·in \d+d \d+h/);
    expect(head).toMatch(/now \$84,823/);
    // The card drops what the header says.
    expect(rows[0].querySelector(".bd-card-top")).toBeNull();
    expect(rows[0].querySelector(".bd-card h3")).toBeTruthy();
    const levels = (row) => [...row.querySelectorAll(".bd-row-cards > li")].map((li) => (li.classList.contains("bd-now") ? "now"
      : Number(li.querySelector(".bd-question").getAttribute("aria-label").match(/at \$([\d,.]+)/)[1].replace(/,/g, ""))));
    const first = levels(rows[0]);
    const at = first.indexOf("now");
    expect(at).toBeGreaterThan(0);
    expect(first[at - 1]).toBeLessThanOrEqual(btc.index);
    expect(first[at + 1]).toBeGreaterThan(btc.index);
    const ks = first.filter((x) => x !== "now");
    expect(ks).toEqual([...ks].sort((a, b) => a - b));
    // Rows run by date across coins.
    const dates = rows.map((r) => r.getAttribute("aria-label"));
    expect(dates.slice(0, 2).every((d) => d.includes("Mon 5 Oct") || d.includes("Tue 6 Oct"))).toBe(true);
    // Filters keep working on the rows.
    await u.click(screen.getByRole("tab", { name: "HYPE" }));
    expect([...container.querySelectorAll(".bd-row")].every((r) => r.getAttribute("aria-label").startsWith("Hyperliquid"))).toBe(true);
    await u.click(screen.getByRole("tab", { name: "All coins" }));
    // Another order: the flat grid, with the coin and date back on each card.
    await u.selectOptions(screen.getByRole("combobox", { name: "Order" }), "mark");
    expect(container.querySelector(".bd-row")).toBeNull();
    expect(container.querySelector(".bd-grid .bd-card-top")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Filters/ }).textContent).toBe("Filters1");
    expect(container.textContent).not.toMatch(BANNED);
  });
});

describe("notices", () => {
  const followed = (over = {}) => ({ id: H, side: "yes", at: NOW - 3600, seen: { live: true, buy: 55, init: true }, ...over });
  const run = (doc, opts = {}) => computeNotices(doc, { boards: { BTC: btc }, now: NOW, ...opts });

  it("cost reached your level, once", () => {
    const { doc, fresh } = run({ follows: [followed({ level: 50 })] });
    expect(fresh.map((n) => n.kind)).toEqual(["level"]);
    expect(fresh[0].text).toBe("BTC Higher · $85,000 on Mon 5 Oct costs 49c per $1, at or below your 50c");
    expect(run(doc).fresh).toHaveLength(0);
  });
  it("a price is available again", () => {
    const { fresh } = run({ follows: [followed({ seen: { live: false, buy: null, init: true } })] });
    expect(fresh.map((n) => n.kind)).toEqual(["available"]);
    expect(fresh[0].text).toMatch(/has a price again: 49c per \$1/);
  });
  it("settles within 6 hours, once", () => {
    const now = Date.UTC(2026, 9, 5, 3) / 1000; // 5 hours before 08:00 UTC
    const { doc, fresh } = run({ follows: [followed()] }, { now });
    expect(fresh.map((n) => n.kind)).toEqual(["soon"]);
    expect(fresh[0].text).toMatch(/settles in 5h 0m, 08:00 UTC/);
    expect(run(doc, { now: now + 600 }).fresh).toHaveLength(0);
  });
  it("settled, with what it paid, from the board or the date's history file", () => {
    const f = { id: "BTC-20261003-A-82000-88000", side: "no", seen: { live: true, buy: 40, init: true } };
    const { fresh } = run({ follows: [f] });
    expect(fresh[0].kind).toBe("settled");
    expect(fresh[0].text).toBe("BTC Lower · $85,000 on Sat 3 Oct settled at $84,594: paid 57c per $1");
    const g = { id: "BTC-20260930-A-82000-88000", side: "yes", seen: { init: true } };
    expect(run({ follows: [g] }).fresh).toHaveLength(0); // no result known yet
    const viaHist = run({ follows: [g] }, { hist: { "BTC-20260930": { settle_price: 90000 } } }).fresh;
    expect(viaHist[0].text).toMatch(/settled at \$90,000: paid 100c per \$1/);
  });
  it("a research reading changed, only between two known readings", () => {
    const before = { follows: [followed()], research: { BTC: { regime: "REACC", signal: "WAIT", lean7: null, lean30: null } } };
    const { doc, fresh } = run(before, { markets: markets("up") });
    expect(fresh.map((n) => n.kind)).toEqual(["research"]);
    expect(fresh[0].text).toBe("BTC research: Regime now Trending up (was Cooling off); Engine reading now Strong up-setup (was No clear setup)");
    expect(run(doc, { markets: markets("up") }).fresh).toHaveLength(0);
    expect(run({ follows: [followed()] }, { markets: markets("up") }).fresh).toHaveLength(0); // first sight records only
    expect(researchChanges({ regime: null }, { regime: "MARKUP" })).toEqual([]);
  });
  it("records without notices on first sight, skips unloaded coins and dismissed notices", () => {
    expect(run({ follows: [followed({ level: 50, seen: { init: false } })] }).fresh).toHaveLength(0);
    expect(computeNotices({ follows: [followed({ level: 50 })] }, { boards: {}, now: NOW }).fresh).toHaveLength(0);
    const { doc } = run({ follows: [followed({ level: 50 })] });
    const key = doc.notices[0].key;
    const again = run({ ...doc, notices: [], dismissed: [key], follows: [followed({ level: 50 })] });
    expect(again.fresh).toHaveLength(0);
  });
  it("shows notices at the top of the Saloon, dismissible, with plain words", async () => {
    saveDoc({ follows: [followed({ level: 50 })], research: { BTC: { regime: "REACC", signal: "WAIT" } } });
    const u = userEvent.setup({ advanceTimers: () => {} });
    const { container } = render(<MemoryRouter><SaloonNotices /></MemoryRouter>);
    const region = await screen.findByRole("region", { name: "Notices" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(container.textContent).not.toMatch(BANNED);
    await u.click(within(region).getAllByRole("button", { name: /^Dismiss: / })[0]);
    expect(within(screen.getByRole("region", { name: "Notices" })).getAllByRole("listitem")).toHaveLength(1);
    await u.click(screen.getByRole("button", { name: /^Dismiss: / }));
    expect(screen.queryByRole("region", { name: "Notices" })).toBeNull();
    expect(loadDoc().dismissed).toHaveLength(2);
  });
});

describe("storage", () => {
  it("migrates an older list, drops what it cannot read and keeps the budget sane", () => {
    const doc = migrate([{ id: H, side: "yes" }, { id: H, side: "yes" }, { id: "nonsense", side: "yes" }, { id: H, side: "up" }, null]);
    expect(doc.version).toBe(1);
    expect(doc.follows.map((f) => [f.id, f.side, f.und, f.k])).toEqual([[H, "yes", "BTC", 85000]]);
    expect(doc.follows[0].settle_ts).toBe(Date.UTC(2026, 9, 5, 8) / 1000);
    expect(migrate({ version: 9, budget: -5, follows: "x", notices: [{ key: 1 }], dismissed: [3, "a"] })).toMatchObject({ budget: 100, follows: [], notices: [], dismissed: ["a"] });
    expect(migrate("garbage").follows).toEqual([]);
    expect(migrate({ follows: [{ id: H, side: "no", level: 150 }] }).follows[0].level).toBeNull();
  });
  it("survives broken JSON in storage and blocked storage", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadDoc().follows).toEqual([]);
    follow(H, "yes", { board: btc, now: NOW });
    expect(JSON.parse(localStorage.getItem(KEY)).follows).toHaveLength(1);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      expect(saveBudget(250)).toBe(250);
      expect(loadBudget()).toBe(250); // kept in memory for this visit
      setLevel(H, "yes", 45);
      expect(loadDoc().follows[0].level).toBe(45);
    } finally {
      spy.mockRestore();
    }
  });
  it("exports and imports follows, keeping existing settings", () => {
    follow(H, "yes", { board: btc, now: NOW });
    setLevel(H, "yes", 45);
    const text = exportFollows();
    expect(JSON.parse(text)).toMatchObject({ kind: "cowboy-follows", version: 1, follows: [{ id: H, side: "yes", level: 45 }] });
    localStorage.clear();
    _resetMemory();
    importFollows(text);
    importFollows(text);
    const doc = loadDoc();
    expect(doc.follows).toHaveLength(1);
    expect(doc.follows[0].level).toBe(45);
    expect(doc.follows[0].seen.init).toBe(false); // the first visit after import records only
    expect(() => importFollows("nope")).toThrow();
  });
  it("dismissing removes a notice and remembers its key", () => {
    saveDoc({ notices: [{ key: "a", text: "x" }, { key: "b", text: "y" }] });
    dismiss("a");
    expect(loadDoc().notices.map((n) => n.key)).toEqual(["b"]);
    expect(loadDoc().dismissed).toEqual(["a"]);
  });
});
