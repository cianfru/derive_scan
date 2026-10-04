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
    expect(screen.getAllByRole("heading", { level: 1 })[0].textContent).toBe("Saloon Price outcomes");
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
    expect(screen.queryByRole("button", { name: "Place on Derive" })).toBeNull();
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(radios[0]);
    // Picking opens the amount step; the preview and the orders wait for its one action.
    expect(container.querySelector(".q-amount")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Place on Derive" })).toBeNull();
    expect(container.querySelector(".q-ticket")).toBeNull();
    await user.click(screen.getByRole("button", { name: "See what it pays" }));
    expect(screen.getByRole("region", { name: "What it pays" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Place on Derive" })).toBeTruthy();
  });

  it("shows pay, fees, total, most it pays, most you can make, breakeven and settlement, the worst case before any action", async () => {
    const { container } = show(`${Q86}?side=yes`);
    const figs = container.querySelector(".q-amount .op-figs").textContent;
    expect(figs).toContain("You pay$99.99");
    expect(figs).toContain("Derive fees, abouti$3.01");
    expect(figs).toContain("Total, the most you can lose$103.01");
    expect(figs).toContain("Most it paystotal back, full $1 from $89,000$264.42");
    expect(figs).toContain("Most you can makeafter what you pay+$161.41");
    expect(figs).toContain("BreakeveniBTC at $85,337");
    expect(figs).toContain("SettlesFri 9 Oct, 08:00 UTC");
    const lose = screen.getAllByText("Total, the most you can lose")[0];
    const get = screen.getByRole("button", { name: "Place on Derive" });
    expect(lose.compareDocumentPosition(get) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ex = [...container.querySelectorAll(".q-amount .op-ex tbody tr")].map((r) => r.textContent);
    expect(ex).toEqual(["$83,000 or lower$0.00-$103.01", "$86,000$132.21+$29.20", "$89,000 or higher$264.42+$161.41"]);
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
    expect(range.getAttribute("aria-valuetext")).toBe("BTC at $84,800: pays 30c per $1, you get $79.33, loss $23.68");
    const at = (v) => { fireEvent.change(range, { target: { value: String(v) } }); return range.getAttribute("aria-valuetext"); };
    expect(at(83000)).toBe("BTC at $83,000: pays 0c per $1, you get $0.00, loss $103.01");
    expect(at(86000)).toBe("BTC at $86,000: pays 50c per $1, you get $132.21, profit $29.20");
    expect(at(89000)).toBe("BTC at $89,000: pays 100c per $1, you get $264.42, profit $161.41");
    expect(container.querySelector(".op-read").textContent).toContain("If BTC settles at $89,000, this pays 100c per $1: you get $264.42");
    wordcheck([container.textContent]);
  });

  it("mirrors Lower: full below the zone, nothing above it", () => {
    const { container } = show(`${Q86}?side=no`);
    const ex = [...container.querySelectorAll(".q-amount .op-ex tbody tr")].map((r) => r.textContent);
    expect(ex[0]).toMatch(/^\$83,000 or lower\$[\d.,]+\+\$/);
    expect(ex[2]).toMatch(/^\$89,000 or higher\$0\.00-\$/);
    expect(container.querySelector(".op-figs").textContent).toContain("total back, full $1 at or below $83,000");
  });

  it("keeps the orders inside a closed Order details, the bought leg first, on the tick", () => {
    const { container } = show(`${Q86}?side=yes`);
    const details = container.querySelector(".q-ticket details.q-details");
    expect(details.open).toBe(false);
    expect(details.querySelector("summary").textContent).toBe("Order details");
    const ticket = container.querySelector(".q-ticket");
    const outside = [...ticket.childNodes].filter((n) => n !== details).map((n) => n.textContent).join(" ");
    expect(outside).not.toMatch(/BTC-20261009-\d+-[CP]/);
    const legs = [...details.querySelectorAll(".q-legs li")].map((li) => li.textContent);
    expect(legs[0]).toMatch(/^1BuyBTC-20261009-83000-CAmount0.04407Limit2431$/);
    expect(legs[1]).toMatch(/^2SellBTC-20261009-89000-CAmount0.04407Limit162$/);
    expect(details.textContent).toContain("Place line 2 only after line 1 has filled.");
    expect(container.textContent).not.toMatch(/guarantee/i);
  });

  it("shows what the first order needs on its own, and what it can lose if line 2 never fills", () => {
    const { container } = show(`${Q86}?side=yes`);
    const hand = container.querySelector(".q-hand").textContent;
    // Line 1 buys the 83,000 call alone: 0.04407 x 2,431 = $107.13, plus its fee.
    expect(hand).toContain("Cash needed for line 1$107.13");
    expect(hand).toMatch(/If only line 1 fills, most you can lose\$108\.\d\d/);
    expect(hand).toContain("Once both fill, most you can lose$103.01");
  });

  it("words the Lower ticket as a payment, never cash received", () => {
    const { container } = show(`${Q86}?side=no`);
    const t = container.querySelector(".q-ticket").textContent;
    expect(t).not.toMatch(/receive now|Derive holds/i);
    expect(t).toMatch(/You payi\$[\d.,]+ incl\. fees/);
  });

  it("asks what filled before saving a position, and saves nothing for Not yet", async () => {
    localStorage.clear();
    const user = userEvent.setup({ advanceTimers: () => {} });
    const { container } = show(`${Q86}?side=yes`);
    const ticket = container.querySelector(".q-ticket");
    await user.click(within(ticket).getByRole("button", { name: "I placed it" }));
    await user.click(within(ticket).getByRole("radio", { name: "Not yet" }));
    expect(within(ticket).getByText(/Nothing saved/)).toBeTruthy();
    expect(within(ticket).queryByRole("button", { name: "Save to Positions" })).toBeNull();
    await user.click(within(ticket).getByRole("radio", { name: "Only the first" }));
    const paid = within(ticket).getByRole("textbox", { name: "What you paid in total" });
    expect(paid.value).toBe("103.01");
    await user.clear(paid);
    await user.type(paid, "108.50");
    await user.click(within(ticket).getByRole("button", { name: "Save to Positions" }));
    const saved = JSON.parse(localStorage.getItem("cowboy-questions"));
    expect(saved).toHaveLength(1);
    expect(saved[0].estimate).toBeCloseTo(103.01, 2);
    expect(saved[0]).toMatchObject({ exec: "hand_partial", paid: 108.5, side: "yes",
      legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"] });
    localStorage.clear();
  });

  it("opens the phone ticket as a dialog: focus moves in, Escape closes it and focus returns", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    const { container } = show(`${Q86}?side=yes`);
    const open = screen.getByRole("button", { name: "Place on Derive" });
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
    expect(screen.queryByRole("button", { name: "Place on Derive" })).toBeNull();
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
    expect(fig("Settles")).toBe("Fri 9 Oct, 08:00 UTC");
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
    const got = screen.getByRole("textbox", { name: "What you got back, after fees" });
    await user.clear(got);
    await user.type(got, "90");
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
