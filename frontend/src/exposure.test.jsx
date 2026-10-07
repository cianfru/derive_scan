import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import index from "./fixtures/questions/index.json";
import hist from "./fixtures/questions/history-BTC-20261009.json";
import { BANNED, budgetTicket, findLevel } from "./lib/questions.js";
import { _resetMemory, loadPositions } from "./lib/positions.js";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
vi.mock("./components/QuestionChart.jsx", () => ({ default: () => <div data-testid="chart" /> }));
import Questions from "./pages/Questions.jsx";
import MyQuestions from "./pages/MyQuestions.jsx";

const T14 = 1791036000; // Sat 3 Oct 2026 14:00 UTC
const S9 = 1791532800;
const markets = { generated_at: T14 - 900, coins: [{ und: "BTC", align: { version: 2, readings: {}, wallet_coverage: { ready: false } } }] };

/** A journal position on Fri 9 Oct, as "I placed it" saves it. */
function rec({ key, id, side, contracts, premium, fees, legs, exec = "hand_both" }) {
  const [, , , lo, hi] = id.split("-");
  return {
    key, id, und: "BTC", side, lo: +lo, hi: +hi, contracts, paid: premium + fees, settle_ts: S9, exec, network: "mainnet", v: 2,
    legs: legs.map(([n]) => n), at: T14 - 600,
    journal: { schema: 1, source: "manual", venue: "Derive", network: "mainnet", saved_ts: T14 - 600,
      package: { id, und: "BTC", side, direction: side === "yes" ? "Higher" : "Lower", expiry: "20261009", zone: "", legs: [] },
      fill: { ts: T14 - 900, complete: exec === "hand_both", legs: legs.map(([name, sq]) => ({ name, act: sq > 0 ? "buy" : "sell", planned: contracts, qty: Math.abs(sq), signed_qty: sq, price: null })) },
      cost: { premium, fees, fees_basis: "entered", total: premium + fees, breakeven: null, breakeven_basis: "unavailable" },
      mark: { value: premium - 1, ts: T14 - 900, source: "Derive mark, Cowboy board" }, context: null },
  };
}
const HIGHER = rec({ key: "h", id: "BTC-20261009-A-83000-89000", side: "yes", contracts: 0.04277, premium: 97.05, fees: 2.95,
  legs: [["BTC-20261009-83000-C", 0.04277], ["BTC-20261009-89000-C", -0.04277]] });
const LOWER = rec({ key: "l", id: "BTC-20261009-A-80000-86000", side: "no", contracts: 0.05, premium: 88.5, fees: 3.1,
  legs: [["BTC-20261009-86000-P", 0.05], ["BTC-20261009-80000-P", -0.05]] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T14 * 1000);
  _resetMemory();
  localStorage.clear();
  docs.current = { "questions/index.json": index, "questions/BTC.json": btc, "questions/history/BTC-20261009.json": hist, "markets.json": markets };
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
const fig = (root, name) => within(root).getByText(name).closest("div").querySelector("dd").textContent;

describe("combined exposure on Positions", () => {
  it("groups two tickets on one date into one card with one payoff, the combined worst case, the total and a Close per line", async () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([HIGHER, LOWER]));
    const { container } = show("/saloon/mine");
    const cards = container.querySelectorAll(".q-group");
    expect(cards).toHaveLength(1);
    const g = cards[0];
    expect(g.querySelector("h2").textContent).toBe("BTC · Fri 9 Oct, 08:00 UTC");
    expect(g.querySelector(".q-group-meta").textContent).toMatch(/^in 5d 18hnow \$84,823/);
    expect(g.querySelector(".q-group-meta").textContent).toContain("2 positions");
    // The card's picture is BTC's own price up to the settlement (owner, 7 October 2026), not a payoff line.
    expect(within(g).getByRole("region", { name: "BTC price up to the settlement, BTC on Fri 9 Oct" })).toBeTruthy();
    const figs = g.querySelector(".q-position-figures");
    // At 86,000 Lower pays nothing and Higher half its width: $191.60 - $128.31.
    expect(fig(figs, "Most you can lose")).toMatch(/^\$63\.29 · tickets one by one \$191\.60/);
    expect(fig(figs, "Most it pays")).toBe("$300.00");
    expect(fig(figs, "Breakeven")).toMatch(/^\$\d{2},\d{3} and \$\d{2},\d{3}$/);
    expect(fig(figs, "You paid")).toBe("$191.60");
    // The group's value now is the sum of its lines.
    const lines = [...g.querySelectorAll(".q-pos-line")];
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.querySelector(".q-card-title").textContent)).toEqual(["Higher than $86,000", "Lower than $83,000"]);
    const val = (root) => Number(fig(root, "Value now").replace(/[$,]/g, ""));
    expect(val(figs)).toBeCloseTo(val(lines[0]) + val(lines[1]), 2);
    expect(fig(lines[0], "Contracts")).toBe("0.04277");
    expect(container.querySelector(".q-exp-total").textContent).toContain("$63.29");
    // Two Close buttons, one per line, each opening its own sell-back under its line.
    const closes = within(g).getAllByRole("button", { name: "Close" });
    expect(closes).toHaveLength(2);
    expect(closes.map((b) => b.closest(".q-pos-line"))).toEqual(lines);
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(closes[1]);
    expect(closes[1].getAttribute("aria-expanded")).toBe("true");
    expect(lines[1].querySelector(".q-close-sum")).not.toBeNull();
    expect(lines[0].querySelector(".q-close-sum")).toBeNull();
    // Each line keeps its folded details.
    expect(lines.map((l) => l.querySelector(".q-position-details").open)).toEqual([false, false]);
    expect(container.textContent).not.toMatch(BANNED);
  });

  it("shows one card per coin and date, adds each date's worst case, and keeps the Closed tab's cards", async () => {
    const later = { ...LOWER, key: "l2", id: "BTC-20261016-A-80000-86000", settle_ts: S9 + 7 * 86400,
      journal: { ...LOWER.journal, package: { ...LOWER.journal.package, expiry: "20261016" } } };
    const eth = { ...HIGHER, key: "e", id: "ETH-20261009-A-3000-3200", und: "ETH", lo: 3000, hi: 3200,
      journal: { ...HIGHER.journal, package: { ...HIGHER.journal.package, id: "ETH-20261009-A-3000-3200", und: "ETH" },
        fill: { ...HIGHER.journal.fill, legs: [{ name: "ETH-20261009-3000-C", act: "buy", planned: 0.04277, qty: 0.04277, signed_qty: 0.04277 }, { name: "ETH-20261009-3200-C", act: "sell", planned: 0.04277, qty: 0.04277, signed_qty: -0.04277 }] } } };
    const closed = { ...LOWER, key: "c", closed_at: T14 - 60, proceeds: 90 };
    localStorage.setItem("cowboy-questions", JSON.stringify([HIGHER, later, eth, closed]));
    const { container } = show("/saloon/mine");
    const cards = [...container.querySelectorAll(".q-group")];
    expect(cards.map((c) => c.querySelector("h2").textContent)).toEqual(["BTC · Fri 9 Oct, 08:00 UTC", "ETH · Fri 9 Oct, 08:00 UTC", "BTC · Fri 16 Oct, 08:00 UTC"]);
    expect(container.querySelectorAll(".q-pos-line")).toHaveLength(0); // one position each: Close sits on the card
    for (const c of cards) expect(within(c).queryAllByRole("button", { name: "Close" }).length).toBeLessThanOrEqual(1);
    expect(within(cards[0]).getByRole("button", { name: "Close" }).closest(".q-position-tools")).not.toBeNull();
    expect(container.querySelector(".q-exp-total").textContent).toMatch(/\$\d/);
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole("tab", { name: "Closed" }));
    expect(container.querySelector(".q-group")).toBeNull();
    expect(container.querySelector(".q-exp-total")).toBeNull();
    const card = container.querySelector(".q-card.q-position");
    expect(card.querySelector(".q-card-status").textContent).toContain("Closed · sold back by hand");
    expect(fig(card, "Got back")).toBe("$90.00");
    expect(fig(card, "Sold back")).toMatch(/^2026-10-03$/);
    expect(card.querySelector(".ex-chart")).toBeNull();
  });

  it("puts a single position's status and Close on its card, with the details folded", async () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([HIGHER]));
    const { container } = show("/saloon/mine");
    const card = container.querySelector(".q-group");
    expect(card.querySelector(".q-group-pos").textContent).toContain("BTC higher or lower than $86,000 on Fri 9 Oct, 08:00 UTC?");
    expect(card.querySelector(".q-group-pos .q-card-status").textContent).toBe("Placed by hand · both filledi");
    const close = within(card).getByRole("button", { name: "Close" });
    expect(close.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector(".q-position-details").open).toBe(false);
    expect(fig(card.querySelector(".q-position-figures"), "Most you can lose")).toBe("$100.00");
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(close);
    expect(close.getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelector(".q-close-sum")).not.toBeNull();
  });

  it("still shows a position the combined figures leave out, inside its date's card", () => {
    const missing = { ...LOWER, key: "m", journal: { ...LOWER.journal, cost: null }, paid: undefined, exec: "hand_both" };
    delete missing.journal.cost;
    const pkg = { ...missing, journal: { ...missing.journal } };
    localStorage.setItem("cowboy-questions", JSON.stringify([HIGHER, pkg]));
    const { container } = show("/saloon/mine");
    const g = container.querySelector(".q-group");
    expect(g.querySelectorAll(".q-pos-line")).toHaveLength(2);
    expect(g.querySelector(".q-group-chart").textContent).toMatch(/1 of 2 positions not in this chart/);
    const figs = g.querySelector(".q-position-figures");
    expect(fig(figs, "Most you can lose")).toBe("Not available yeti");
    expect(fig(figs, "You paid")).toBe("Not available yeti");
  });
});

describe("a proposed trade on top of what is held", () => {
  it("draws the trade over the held curve and shows the figures with it", () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([HIGHER]));
    const { container } = show("/q/BTC-20261009-A-80000-86000?side=no");
    const held = screen.getByRole("region", { name: "With what you hold" });
    expect(held.querySelectorAll("path.pz-line")).toHaveLength(2);
    expect(held.querySelectorAll("path.ex-held")).toHaveLength(1);
    const rows = [...held.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows[0][0]).toBe("Most you can lose");
    expect(rows[0][1]).toBe("$100.00");
    const t = budgetTicket(findLevel(btc, "BTC-20261009-A-80000-86000").level, "no", 100, btc);
    const after = Number(rows[0][2].replace(/[$,]/g, ""));
    expect(after).toBeLessThan(100 + t.mostLose);
    expect(rows[1][0]).toBe("Most it pays");
    expect(container.textContent).not.toMatch(BANNED);
  });

  it("stays away when nothing is held on that date", () => {
    show("/q/BTC-20261009-A-80000-86000?side=no");
    expect(screen.queryByRole("region", { name: "With what you hold" })).toBeNull();
  });
});

describe("J2 on Positions: selling back part, settlement and the realized summary", () => {
  it("records a partial sell-back, keeps the rest open, then records settlement and sums the results", async () => {
    localStorage.setItem("cowboy-questions", JSON.stringify([HIGHER]));
    const user = userEvent.setup({ advanceTimers: () => {} });
    const { container, unmount } = show("/saloon/mine");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "I sold it back" }));
    await user.click(screen.getByRole("checkbox", { name: "Both orders filled" }));
    const qty = screen.getByRole("textbox", { name: "Contracts sold back" });
    await user.clear(qty);
    await user.type(qty, "0.02");
    fireEvent.change(screen.getByLabelText("When it sold, UTC"), { target: { value: "2026-10-03T13:58" } });
    await user.type(screen.getByRole("textbox", { name: "What the options brought, before fees" }), "41");
    await user.click(screen.getByRole("checkbox", { name: "I don't know the fees" }));
    expect(container.querySelector(".q-journal-form").textContent).toContain("The other 0.02277 contracts stay open.");
    await user.click(screen.getByRole("button", { name: "Save the sell-back" }));
    const [p] = loadPositions();
    expect(p.closed_at).toBeUndefined();
    expect(p.exits).toHaveLength(1);
    expect(p.exits[0]).toMatchObject({ kind: "close", qty: 0.02, gross: 41, fees_basis: "estimated", ts: Date.UTC(2026, 9, 3, 13, 58) / 1000 });
    expect(p.exits[0].mark.ts).toBe(btc.prices_ts);
    // Still open, with the rest; the summary counts the part sold back.
    expect(container.querySelectorAll(".q-card")).toHaveLength(1);
    expect(container.textContent).toContain("Realized so far");
    expect(container.querySelector(".q-realized-sum").textContent).toMatch(/1 result: 1 sold back, 0 settled/);
    await user.click(screen.getByText("Where the result came from"));
    const part = container.querySelector(".q-real-p");
    expect(part.textContent).toContain("Sold back 0.02 contracts");
    expect(part.textContent).toContain("Package value change");
    // The parts add up to the result, to the cent.
    const nums = [...part.querySelectorAll('[aria-label="Where it came from"] dd')].map((d) => Number(d.textContent.replace(/[+$,]/g, "")));
    const net = Number(fig(part, "Realized P/L").replace(/[+$,]/g, ""));
    expect(Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100).toBe(net);
    expect(fig(part, "Exit fees")).toMatch(/^\$/);
    expect(part.textContent).toContain("Estimated");
    unmount();

    // After 08:00 UTC on the date with Derive's settlement price published, the rest settles.
    vi.setSystemTime((S9 + 3600) * 1000);
    docs.current["questions/history/BTC-20261009.json"] = { ...hist, settle_price: 86000 };
    const again = show("/saloon/mine");
    const [q] = loadPositions();
    expect(q.exits.map((e) => e.kind)).toEqual(["close", "settle"]);
    expect(q.exits[1].gross).toBeCloseTo(0.02277 * 3000, 9);
    const sum = again.container.querySelector(".q-realized-sum").textContent;
    expect(sum).toMatch(/2 results: 1 sold back, 1 settled/);
    await user.click(screen.getByRole("tab", { name: "Closed" }));
    const card = again.container.querySelector(".q-card");
    const got = Number(fig(card, "Got back").replace(/[$,]/g, ""));
    expect(got).toBeCloseTo(q.exits[0].net + 0.02277 * 3000, 2);
    expect(card.querySelector(".q-card-status").textContent).toContain(`got $${(0.02277 * 3000).toFixed(2)}`);
    const pl = Number(fig(card.querySelector(".q-figs.grid"), "Realized P/L").replace(/[+$,]/g, ""));
    expect(pl).toBeCloseTo(got - 100, 2);
    expect(again.container.textContent).not.toMatch(BANNED);
  });
});
