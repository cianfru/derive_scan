import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import hype from "./fixtures/questions/HYPE.json";
import index from "./fixtures/questions/index.json";
import hist from "./fixtures/questions/history-BTC-20261009.json";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
vi.mock("./components/QuestionChart.jsx", () => ({ default: () => <div data-testid="chart" /> }));
import Questions from "./pages/Questions.jsx";
import MyQuestions from "./pages/MyQuestions.jsx";
import { BANNED } from "./lib/questions.js";

const T14 = 1791036000;
const markets = { coins: [{ und: "BTC", align: { version: 2, readings: {}, wallet_coverage: { ready: false } } }] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((T14 + 600) * 1000);
  docs.current = {
    "questions/index.json": index, "questions/BTC.json": btc, "questions/HYPE.json": hype,
    "questions/history/BTC-20261009.json": hist, "markets.json": markets,
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const show = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/questions" element={<Questions />} />
      <Route path="/questions/mine" element={<MyQuestions />} />
      <Route path="/questions/:und" element={<Questions />} />
      <Route path="/q/:id" element={<Questions />} />
    </Routes>
  </MemoryRouter>,
);

/** Every visible string and every (i) text on the screen. */
async function allText(container) {
  const user = userEvent.setup({ advanceTimers: () => {} });
  const texts = [container.textContent];
  for (const b of screen.queryAllByRole("button", { name: /about|rules|why|if only|where|explain|at derive/i })) {
    if (!b.classList.contains("info")) continue;
    await user.click(b);
    const pop = document.querySelector(".pop");
    if (pop) texts.push(`[(i) ${b.getAttribute("aria-label")}] ${pop.textContent}`);
    await user.click(b);
  }
  return texts;
}

function wordcheck(texts) {
  for (const t of texts) {
    expect(t, t.slice(0, 120)).not.toMatch(BANNED);
    // No percent anywhere in Questions copy except the zone (i).
    if (!t.startsWith("[(i) About the pay zone]")) expect(t, t.slice(0, 120)).not.toMatch(/%/);
  }
}

describe("the board", () => {
  it("lists every coin with a live question and the dates that pass, nearest first", () => {
    const { container } = show("/questions/BTC");
    const coins = screen.getByRole("tablist", { name: "Coin" });
    expect(within(coins).getAllByRole("tab").map((t) => t.textContent)).toEqual(index.coins.map((c) => c.und));
    const dates = within(screen.getByRole("tablist", { name: "Settlement date" })).getAllByRole("tab").map((t) => t.textContent);
    expect(dates[0]).toBe("Mon 5 Oct");
    expect(dates).toContain("This Friday · 9 Oct");
    expect(dates.join()).not.toMatch(/4 Oct/); // under a day: no tab
    expect(container.querySelector("[class*=pill]")).toBeNull();
  });

  it("shows the pay zone and the full-pay line in every row, the headline included", async () => {
    show("/questions/BTC");
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole("tab", { name: "This Friday · 9 Oct" }));
    const rows = screen.getAllByRole("row");
    expect(rows[0].getAttribute("aria-label")).toBe("Up or down from $85,000");
    for (const r of rows) {
      expect(r.querySelector("svg.payzone")).not.toBeNull();
      expect(r.textContent).toMatch(/\$1 from \$[\d,]+/);
    }
    const r86 = rows.find((r) => r.getAttribute("aria-label") === "Above $86,000");
    expect(within(r86).getByRole("link", { name: /^Yes 38 cents/ })).toBeTruthy();
    expect(within(r86).getByRole("link", { name: /^No 66 cents/ })).toBeTruthy();
    expect(screen.getByText("$84,823 now")).toBeTruthy();
  });

  it("passes the word check on every string and (i)", async () => {
    const { container } = show("/questions/BTC");
    const texts = await allText(container);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(texts.some((t) => t.startsWith("[(i) About the pay zone]") && t.includes("%"))).toBe(true);
    wordcheck(texts);
  });

  it("marks a thin coin's book, with an (i)", async () => {
    const { container } = show("/questions/HYPE");
    expect(screen.getByText("Thin book")).toBeTruthy();
    wordcheck(await allText(container));
  });

  it("shows an em dash for a side with no price, and paused prices as plain text", () => {
    const b = structuredClone(btc);
    const d = b.dates.find((x) => x.expiry === "20261005");
    const lv = d.levels.find((x) => x.ladder === 7);
    lv.no = { state: "no_quote" };
    docs.current["questions/BTC.json"] = b;
    show("/questions/BTC");
    const row = screen.getAllByRole("row").find((r) => r.getAttribute("aria-label") === `Above $${lv.k.toLocaleString("en-US")}`);
    expect(within(row).getByLabelText("No no price now").textContent).toContain("—");
    cleanup();
    vi.setSystemTime((T14 + 40 * 60) * 1000);
    show("/questions/BTC");
    expect(screen.getByText(/40 min old/)).toBeTruthy();
    cleanup();
    vi.setSystemTime((T14 + 120 * 60) * 1000);
    const { container } = show("/questions/BTC");
    expect(screen.getByText("Prices paused since 14:00 UTC")).toBeTruthy();
    expect(container.querySelectorAll("a.q-btn")).toHaveLength(0);
  });
});

describe("the question page", () => {
  it("shows the amount panel for $100, the worst case before any action button", async () => {
    const { container } = show("/q/BTC-20261009-A-83000-89000?side=yes");
    expect(screen.getByRole("heading", { level: 1, name: "BTC above $86,000 on Fri 9 Oct?" })).toBeTruthy();
    const figs = container.querySelector(".q-figs");
    expect(figs.textContent).toContain("Most you can lose$103.01");
    expect(figs.textContent).toContain("You pay$99.99 + fees about $3.01");
    expect(figs.textContent).toContain("Pays up to$264.42 from $89,000");
    expect(figs.textContent).toContain("At $86,000$132.21");
    const lose = screen.getAllByText("Most you can lose")[0];
    const get = screen.getByRole("button", { name: "Get Yes on Derive" });
    expect(lose.compareDocumentPosition(get) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b(agrees?|matches)\b/i);
    const texts = await allText(container);
    expect(texts.length).toBeGreaterThanOrEqual(8);
    wordcheck(texts);
  });

  it("lists the bought leg first in the ticket, on the tick", () => {
    const { container } = show("/q/BTC-20261009-A-83000-89000?side=yes");
    const legs = [...container.querySelectorAll(".q-legs li")].map((li) => li.textContent);
    expect(legs[0]).toMatch(/^1BuyBTC-20261009-83000-CAmount0.04407Limit2431$/);
    expect(legs[1]).toMatch(/^2SellBTC-20261009-89000-CAmount0.04407Limit162$/);
    expect(container.textContent).toContain("Place line 2 only after line 1 has filled.");
    expect(container.textContent).not.toMatch(/guarantee/i);
  });

  it("words a credit construction as cash received and held", () => {
    const { container } = show("/q/BTC-20261009-A-83000-89000?side=no");
    expect(container.querySelector(".q-ticket").textContent).toMatch(/You receive now\$[\d.,]+Derive holds against it/);
  });

  it("opens an old settled link at its settled view", () => {
    const { container } = show("/q/BTC-20261003-A-80000-86000");
    expect(container.textContent).toContain("Settled $84,594");
    expect(container.textContent).toContain("Yes paid 77c");
  });
});

describe("My questions", () => {
  it("values an open position at the sell-back price, a settled one by what it paid, and passes the word check", async () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([
      { key: "a", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
        question: "BTC above $86,000 on Fri 9 Oct?", answer: "Yes", settle_ts: 1791532800 },
      { key: "b", id: "BTC-20261003-A-80000-86000", und: "BTC", side: "yes", lo: 80000, hi: 86000, contracts: 0.01, paid: 50,
        question: "BTC above $83,000 on Sat 3 Oct?", answer: "Yes", settle_ts: 1791014400 },
    ]));
    const { container } = show("/questions/mine");
    expect(container.textContent).toContain("Sell back");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole("button", { name: "Sell back" }));
    const legs = [...container.querySelectorAll(".q-legs li")].map((li) => li.textContent);
    expect(legs[0]).toMatch(/^1Buy backBTC-20261009-89000-C/);
    wordcheck(await allText(container));
    await user.click(screen.getByRole("tab", { name: "Settled" }));
    expect(container.textContent).toMatch(/Got\$45\.94 \(77c per \$1\)/);
    localStorage.clear();
  });

  it("has an empty state", () => {
    try { localStorage.clear(); } catch { /* blocked */ }
    show("/questions/mine");
    expect(screen.getByText(/No questions yet/)).toBeTruthy();
  });
});
