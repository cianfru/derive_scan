import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, act } from "@testing-library/react";
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
      <Route path="/saloon" element={<Questions />} />
      <Route path="/saloon/mine" element={<MyQuestions />} />
      <Route path="/saloon/:und" element={<Questions />} />
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
    const { container } = show("/saloon/BTC");
    const coins = screen.getByRole("tablist", { name: "Coin" });
    expect(within(coins).getAllByRole("tab").map((t) => t.textContent)).toEqual(index.coins.map((c) => c.und));
    const dates = within(screen.getByRole("tablist", { name: "Settlement date" })).getAllByRole("tab").map((t) => t.textContent);
    expect(dates[0]).toBe("Mon 5 Oct");
    expect(dates).toContain("This Friday · 9 Oct");
    expect(dates.join()).not.toMatch(/4 Oct/); // under a day: no tab
    expect(container.querySelector("[class*=pill]")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })[0].textContent).toBe("Saloon");
    // The guided flow: coin, date, then higher or lower on the date's headline level.
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")).slice(0, 3)).toEqual(["Coin", "Date", "Higher or lower"]);
  });

  it("names the answers Higher and Lower, with the pay zone in every row and in every answer's name", async () => {
    const { container } = show("/saloon/BTC");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole("tab", { name: "This Friday · 9 Oct" }));
    await user.click(screen.getByRole("button", { name: "Other levels" }));
    const rows = screen.getAllByRole("row");
    expect(rows[0].getAttribute("aria-label")).toBe("Higher or lower than $85,000");
    expect(rows[0].textContent).toContain("$177 above today");
    for (const r of rows) {
      expect(r.querySelector("svg.payzone")).not.toBeNull();
      expect(r.textContent).toMatch(/\$[\d,]+–\$[\d,]+/);
      for (const a of r.querySelectorAll(".q-btn")) expect(a.getAttribute("aria-label")).toMatch(/^(Higher, full \$1 from|Lower, full \$1 at or below) \$[\d,]+, /);
    }
    const r86 = rows.find((r) => r.getAttribute("aria-label") === "Higher or lower than $86,000");
    expect(within(r86).getByRole("link", { name: "Higher, full $1 from $89,000, 38 cents per $1" })).toBeTruthy();
    // Debit only: the put spread at 66.02c, shown 67c (the call twin was 66c).
    expect(within(r86).getByRole("link", { name: "Lower, full $1 at or below $83,000, 67 cents per $1" })).toBeTruthy();
    expect(screen.getByText("$84,823 now")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b(Yes|No|Up|Down)\b/);
    expect(container.textContent).not.toMatch(/\bby (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
  });

  it("marks the question shown in the flow in the ladder", async () => {
    const { container } = show("/saloon/BTC");
    expect(container.querySelector(".q-ladder")).toBeNull(); // folded under Other levels
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole("button", { name: "Other levels" }));
    const head = container.querySelector(".q-row.headline");
    expect(head.getAttribute("aria-selected")).toBe("true");
  });

  it("passes the word check on every string and (i)", async () => {
    const { container } = show("/saloon/BTC");
    const texts = await allText(container);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(texts.some((t) => t.startsWith("[(i) About the pay zone]") && t.includes("%"))).toBe(true);
    wordcheck(texts);
  });

  it("marks a thin coin's book, and an older credit side has no price, never cash received", async () => {
    const { container } = show("/saloon/HYPE");
    expect(screen.getByText("Thin book")).toBeTruthy();
    expect(container.textContent).not.toMatch(/receive now|Derive holds/i);
    wordcheck(await allText(container));
    cleanup();
    const credit = "HYPE-20261009-A-86-92";
    const { container: c2 } = show(`/q/${credit}?side=yes`);
    expect(c2.textContent).toContain("No price now for Higher");
    expect(c2.querySelector(".q-ticket")).toBeNull();
    expect(c2.textContent).not.toMatch(/receive now|Derive holds/i);
  });

  it("says No price now, with its reason, for a side with no price, and paused prices as plain text", async () => {
    const b = structuredClone(btc);
    const d = b.dates.find((x) => x.expiry === "20261005");
    const lv = d.levels.find((x) => x.ladder === 7);
    lv.no = { state: "screen_wide" };
    docs.current["questions/BTC.json"] = b;
    const { container } = show("/saloon/BTC");
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole("button", { name: "Other levels" }));
    const row = screen.getAllByRole("row").find((r) => r.getAttribute("aria-label") === `Higher or lower than $${lv.k.toLocaleString("en-US")}`);
    const off = within(row).getByRole("group", { name: /^Lower, full \$1 at or below \$[\d,]+, no price now$/ });
    expect(off.textContent).toContain("No price now");
    expect(off.textContent).not.toContain("—");
    await userEvent.setup({ advanceTimers: () => {} }).click(within(off).getByRole("button", { name: /^Why Lower has no price/ }));
    expect(document.querySelector(".pop").textContent).toMatch(/too wide/);
    expect(container.querySelector(".q-board").textContent).not.toContain("—");
    cleanup();
    vi.setSystemTime((T14 + 40 * 60) * 1000);
    show("/saloon/BTC");
    expect(screen.getByText(/40 min old/)).toBeTruthy();
    cleanup();
    vi.setSystemTime((T14 + 120 * 60) * 1000);
    const { container: c3 } = show("/saloon/BTC");
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole("button", { name: "Other levels" }));
    expect(screen.getByText("Prices paused since 14:00 UTC")).toBeTruthy();
    expect(c3.querySelectorAll("a.q-btn")).toHaveLength(0);
  });
});

const Q86 = "/q/BTC-20261009-A-83000-89000";

describe("the question page", () => {
  it("picks no answer for the user: no amount, no ticket and no action until one is picked", async () => {
    const { container } = show(Q86);
    expect(screen.getByRole("heading", { level: 1, name: "BTC higher or lower than $86,000 on Fri 9 Oct, 08:00 UTC?" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(radios[0].getAttribute("aria-label")).toBe("Higher, full $1 from $89,000, 38 cents per $1");
    expect(container.querySelector(".q-amount")).toBeNull();
    expect(container.querySelector(".q-ticket")).toBeNull();
    expect(container.querySelector(".md-unpicked .payzone")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review trade" })).toBeNull();
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(radios[0]);
    // A marketplace selection shows amount and payout immediately. Orders stay behind review.
    expect(container.querySelector(".q-amount")).not.toBeNull();
    expect(container.querySelector(".q-ticket")).toBeNull();
    expect(screen.getByRole("region", { name: "What it pays" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review trade" })).toBeTruthy();
    expect(screen.getByTestId("chart")).toBeTruthy();
  });

  it("shows pay, fees, total, most it pays, most you can make, breakeven and settlement, the worst case before any action", async () => {
    const { container } = show(`${Q86}?side=yes`);
    const figs = container.querySelector(".q-amount .op-figs").textContent;
    // The budget convention: $100 typed is the total, Derive's fees included. 0.04277 contracts:
    // $97.05 for the two options + $2.95 fees = $100.00 (was $99.99 + $3.01 = $103.01 before fees).
    expect(figs).toContain("You payi$100.00 incl. fees");
    expect(container.querySelector(".md-preview .op-fees-line").textContent).toBe("Derive fees $2.95");
    expect(figs).toContain("Most it paystotal back, full $1 from $89,000$256.62");
    expect(figs).toContain("Most you can makeafter what you pay+$156.62");
    expect(figs).toContain("BreakeveniBTC at $85,338");
    expect(container.querySelector(".md-heading").textContent).toContain("Settles Fri 9 Oct, 08:00 UTC");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole("button", { name: "What you pay" }));
    expect(document.querySelector(".pop").textContent).toContain("$97.05 for the two options plus Derive's fees, about $2.95. It is the most you can lose.");
    await user.click(screen.getByRole("button", { name: "What you pay" }));
    const lose = screen.getByText("Your cost is the most you can lose.");
    const get = screen.getByRole("button", { name: "Review trade" });
    expect(lose.compareDocumentPosition(get) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ex = [...container.querySelectorAll(".md-payoff-study .op-ex tbody tr")].map((r) => r.textContent);
    expect(ex).toEqual(["$83,000 or lower$0.00-$100.00", "$86,000$128.31+$28.31", "$89,000 or higher$256.62+$156.62"]);
    expect(container.textContent).toContain("Selling back before 08:00 UTC is valued at Derive's sell-back price then, not by this chart.");
    expect(container.textContent).not.toMatch(/\b(agrees?|matches)\b/i);
    const texts = await allText(container);
    texts.push(container.querySelector(".op-range").getAttribute("aria-valuetext"));
    expect(texts.length).toBeGreaterThanOrEqual(8);
    wordcheck(texts);
  });

  it("moves the settlement slider by keyboard value and shows the same payout as the ramp", () => {
    const { container } = show(`${Q86}?side=yes`);
    const range = screen.getByRole("slider", { name: "BTC price at settlement" });
    expect(range.getAttribute("aria-valuetext")).toBe("BTC at $84,800: pays 30c per $1, you get $76.99, loss $23.01");
    const at = (v) => { fireEvent.change(range, { target: { value: String(v) } }); return range.getAttribute("aria-valuetext"); };
    expect(at(83000)).toBe("BTC at $83,000: pays 0c per $1, you get $0.00, loss $100.00");
    expect(at(86000)).toBe("BTC at $86,000: pays 50c per $1, you get $128.31, profit $28.31");
    expect(at(89000)).toBe("BTC at $89,000: pays 100c per $1, you get $256.62, profit $156.62");
    expect(container.querySelector(".op-read").textContent).toBe("If BTC settles at$89,000Pays per $1100cYou get$256.62Profit+$156.62");
    wordcheck([container.textContent]);
  });

  it("mirrors Lower: full below the zone, nothing above it", () => {
    const { container } = show(`${Q86}?side=no`);
    const ex = [...container.querySelectorAll(".md-payoff-study .op-ex tbody tr")].map((r) => r.textContent);
    expect(ex[0]).toMatch(/^\$83,000 or lower\$[\d.,]+\+\$/);
    expect(ex[2]).toMatch(/^\$89,000 or higher\$0\.00-\$/);
    expect(container.querySelector(".op-figs").textContent).toContain("total back, full $1 at or below $83,000");
  });

  it("recalculates immediately when the amount or answer changes and closes the previous order review", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    const { container } = show(`${Q86}?side=yes`);
    fireEvent.change(screen.getByRole("textbox", { name: /Amount, fees included/ }), { target: { value: "200" } });
    const amount = parseFloat(container.querySelector(".md-preview .op-total dd").textContent.replace(/[$,]/g, ""));
    expect(amount).toBeLessThanOrEqual(200);
    expect(amount).toBeGreaterThan(199.9);
    await user.click(screen.getByRole("button", { name: "Review trade" }));
    expect(screen.getByRole("dialog", { name: "Ticket" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What it pays" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to payout" }));
    await user.click(screen.getAllByRole("radio")[1]);
    expect(container.querySelector(".q-ticket")).toBeNull();
    expect(container.querySelector(".md-preview .op-figs").textContent).toContain("full $1 at or below $83,000");
    expect(screen.getByRole("textbox", { name: /Amount, fees included/ }).value).toBe("200");
    await user.click(screen.getByRole("button", { name: "Other levels" }));
    const nextLevel = screen.getAllByRole("row").find((row) => !row.classList.contains("headline") && row.querySelector("a.q-btn.yes"));
    await user.click(nextLevel.querySelector("a.q-btn.yes"));
    expect(screen.getByRole("textbox", { name: /Amount, fees included/ }).value).toBe("200");
  });

  it.each(["paused", "retired"])("does not expose orders for a %s outcome through a selected-side deep link", (state) => {
    const b = structuredClone(btc);
    if (state === "paused") b.paused = true;
    else b.dates.find((d) => d.expiry === "20261009").levels.find((lv) => lv.id === Q86.slice(3)).state = "retired";
    docs.current["questions/BTC.json"] = b;
    const { container } = show(`${Q86}?side=yes`);
    expect(screen.getByRole("button", { name: "Review trade" }).disabled).toBe(true);
    expect(container.querySelector(".q-ticket")).toBeNull();
    expect(container.querySelector(".md-preview")).toBeNull();
    expect(container.textContent).toContain("No price now for Higher");
  });

  it("keeps the trade on Cowboy: no orders to place by hand, no link to Derive, one-tap coming", async () => {
    const { container } = show(`${Q86}?side=yes`);
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole("button", { name: "Review trade" }));
    const ticket = container.querySelector(".q-ticket");
    expect(ticket.querySelector(".q-onetap-note").textContent).toContain("One-tap trading is coming to Cowboy.");
    expect(ticket.querySelector("details.q-details, .q-hand, a[href]")).toBeNull();
    expect(ticket.textContent).not.toMatch(/Open Derive|I placed it|BTC-20261009-\d+-[CP]/);
    expect(ticket.textContent).toMatch(/You payi\$[\d.,]+ incl\. fees/);
  });

  it("words the Lower ticket as a payment, never cash received", async () => {
    const { container } = show(`${Q86}?side=no`);
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole("button", { name: "Review trade" }));
    const t = container.querySelector(".q-ticket").textContent;
    expect(t).not.toMatch(/receive now|Derive holds/i);
    expect(t).toMatch(/You payi\$[\d.,]+ incl\. fees/);
  });

  it("opens the phone ticket as a dialog: focus moves in, Escape closes it and focus returns", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    const { container } = show(`${Q86}?side=yes`);
    const open = screen.getByRole("button", { name: "Review trade" });
    await user.click(open);
    const sheet = screen.getByRole("dialog", { name: "Ticket" });
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(sheet.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 8; i++) { await user.tab(); expect(sheet.contains(document.activeElement)).toBe(true); }
    await user.keyboard("{Escape}");
    expect(container.querySelector(".q-sheet.open")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("stops offering a date from 07:30 UTC by the clock, whatever the file says", () => {
    const b = structuredClone(btc);
    b.prices_ts = Date.UTC(2026, 9, 9, 7, 15) / 1000; // a fresh 07:15 file, its level still "open"
    docs.current["questions/BTC.json"] = b;
    vi.setSystemTime(Date.UTC(2026, 9, 9, 7, 45));
    const { container } = show(`${Q86}?side=yes`);
    expect(container.textContent).toContain("Settling · average from 07:30 to 08:00 UTC");
    expect(screen.queryByRole("button", { name: "Review trade" })).toBeNull();
    expect(container.querySelector(".q-ticket")).toBeNull();
  });

  it("opens an old settled link at its settled view", () => {
    const { container } = show("/q/BTC-20261003-A-80000-86000");
    expect(container.textContent).toContain("Settled $84,594");
    expect(container.textContent).toContain("Higher paid 77c");
  });
});

describe("Positions", () => {
  const open = { key: "a", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
    question: "BTC above $86,000 on Fri 9 Oct?", answer: "Yes", settle_ts: 1791532800,
    legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both" };
  const old = { key: "b", id: "BTC-20261003-A-80000-86000", und: "BTC", side: "yes", lo: 80000, hi: 86000, contracts: 0.01, paid: 50,
    question: "BTC above $83,000 on Sat 3 Oct?", answer: "Yes", settle_ts: 1791014400 };

  it("values an open position at the sell-back price after exit fees, closes it by hand, and passes the word check", async () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([open, old]));
    const { container } = show("/saloon/mine");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Positions");
    const card = container.querySelector(".q-card");
    expect(card.textContent).toContain("BTC higher or lower than $86,000 on Fri 9 Oct, 08:00 UTC?");
    expect(card.textContent).toContain("Higher · full $1 from $89,000");
    expect(card.textContent).toContain("Placed by hand · both filled");
    const fig = (name) => within(card).getByText(name).closest("div").querySelector("dd").textContent;
    expect(fig("You paid")).toBe("$103.01");
    expect(fig("Most it pays")).toBe("$264.42"); // 6,000 x 0.04407
    // 0.3463 x 6,000 x 0.04407 = $91.57 gross, less Derive's two exit fees.
    const worth = Number(fig("Value now").replace(/[$,]/g, ""));
    expect(worth).toBeLessThan(91.57);
    expect(fig("Profit / loss now")).toBe(`-$${(103.01 - worth).toFixed(2)}`);
    expect(fig("At 08:00 UTC, today's price")).toMatch(/^-\$\d+\.\d\d$/);
    // The card is the date's group: its header names the coin, date, countdown and today's index.
    expect(card.querySelector("h2").textContent).toBe("BTC · Fri 9 Oct, 08:00 UTC");
    expect(card.querySelector(".q-group-meta").textContent).toMatch(/^in \d+d \d+hnow \$[\d,]+1 position/);
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole("button", { name: "Close" }));
    // The close summary first: proceeds, fees and the result, then the orders inside Order details.
    const sum = container.querySelector(".q-close-sum").textContent;
    expect(sum).toMatch(/You get, after fees\$[\d.]+/);
    expect(sum).toContain(`Profit / loss if closed nowafter the $103.01 you paid-$${(103.01 - worth).toFixed(2)}`);
    expect(sum).toMatch(/If held to 08:00 UTC instead/);
    const legs = [...container.querySelectorAll(".q-legs li")].map((li) => li.textContent);
    expect(legs[0]).toMatch(/^1Buy backBTC-20261009-89000-C/);
    expect(container.querySelector(".q-details").open).toBe(false);
    wordcheck(await allText(container));
    await user.click(screen.getByRole("button", { name: "I sold it back" }));
    await user.click(screen.getByRole("checkbox", { name: "Both orders filled" }));
    await user.click(screen.getByRole("checkbox", { name: "I don't know when" }));
    await user.type(screen.getByRole("textbox", { name: "What the options brought, before fees" }), "91.50");
    await user.type(screen.getByRole("textbox", { name: "Derive's fees to sell back" }), "1.50");
    await user.click(screen.getByRole("button", { name: "Close the position" }));
    expect(container.querySelectorAll(".q-card")).toHaveLength(0);
    await user.click(screen.getByRole("tab", { name: "Closed" }));
    expect(container.textContent).toContain("Closed · sold back by hand");
    expect(container.textContent).toMatch(/Got backafter fees\$90\.00/);
    expect(container.textContent).toContain("-$13.01");
    expect(container.textContent).toMatch(/Got77c per \$1\$45\.94/); // the older entry, settled
    expect(container.textContent).toContain("Settled at $84,594 · got $45.94");
    localStorage.clear();
  });

  it("never values a partial fill as the answer", () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([{ ...open, exec: "hand_partial" }]));
    const { container } = show("/saloon/mine");
    expect(container.textContent).toContain("Placed by hand · only the first filled");
    const card = container.querySelector(".q-card");
    for (const name of ["Most it pays", "Value now", "Profit / loss now", "At 08:00 UTC, today's price"]) {
      expect(within(card).getByText(name).closest("div").querySelector("dd").textContent).toBe("Not available yeti");
    }
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(container.querySelector(".q-figs").textContent).not.toContain("—");
    localStorage.clear();
  });

  it("offers no sell-back price for options the board no longer prices for that answer", () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([{ ...open, side: "no", legs: ["BTC-20261009-89000-C", "BTC-20261009-83000-C"] }]));
    const { container } = show("/saloon/mine");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(container.querySelector(".q-figs").textContent).toContain("No price now");
    localStorage.clear();
  });

  it("has an empty state", () => {
    try { localStorage.clear(); } catch { /* blocked */ }
    show("/saloon/mine");
    expect(screen.getByRole("heading", { name: "No positions yet" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the Saloon" }).getAttribute("href")).toBe("/saloon");
    // Export and import sit under "Saved in this browser".
    expect(screen.getByRole("button", { name: "Export" }).closest("details.q-saved")).not.toBeNull();
  });
});
