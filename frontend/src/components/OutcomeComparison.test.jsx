import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import OutcomeComparison from "./OutcomeComparison.jsx";
import btc from "../fixtures/questions/BTC.json";
import { BANNED, findLevel } from "../lib/questions.js";

const NOW = btc.prices_ts + 600;
const pick = (board, id, side) => {
  const { date, level } = findLevel(board, id);
  return { und: board.und, id, side, expiry: date.expiry, settleTs: date.settle_ts, level, board };
};
const higher = pick(btc, "BTC-20261009-A-83000-89000", "yes");
const lower = pick(btc, "BTC-20261030-A-82000-90000", "no");
const hypeBoard = { und: "HYPE", index: 88.13, prices_ts: btc.prices_ts,
  spec: { step: 0.1, min: 1, base: 0.5, taker: 0.0003, cap: 0.125 } };
const hype = { und: "HYPE", id: "HYPE-20261009-A-86-92", side: "yes", expiry: "20261009", settleTs: higher.settleTs, board: hypeBoard,
  level: { id: "HYPE-20261009-A-86-92", k: 89, lo: 86, hi: 92, state: "open",
    yes: { state: "open", form: "debit", buy: 0.5, size: 1e6,
      legs: [["HYPE-20261009-86-C", "buy", 4], ["HYPE-20261009-92-C", "sell", 1]] } } };

const figure = (card, label) => within(card).getByText(label, { selector: "dt" }).nextElementSibling.textContent;
afterEach(cleanup);

describe("read-only outcome comparison", () => {
  it("compares three explicit outcomes in choice order at one fee-inclusive decimal budget", () => {
    const onRemove = vi.fn(), onSelect = vi.fn();
    render(<OutcomeComparison selections={[hype, lower, higher]} budget={100.5} now={NOW} onRemove={onRemove} onSelect={onSelect} />);
    expect(screen.getByText(/each · fees included/).textContent).toBe("For $100.50 each · fees included");
    const cards = screen.getAllByRole("article");
    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual(["HYPE Higher $89", "BTC Lower $86,000", "BTC Higher $86,000"]);
    // Known recorded BTC quotes and a HYPE quote with a coarse amount step exercise rounding,
    // different dates and both payout directions without presenting return-based rankings.
    expect(figure(cards[0], "You pay / most you can lose")).toBe("$100.22incl. $2.72 fees");
    expect(figure(cards[0], "Most it pays")).toBe("$195.00");
    expect(figure(cards[0], "Most you can make")).toBe("+$94.78");
    expect(figure(cards[0], "Breakeven")).toBe("$89.08");
    expect(figure(cards[1], "You pay / most you can lose")).toBe("$100.50incl. $2.11 fees");
    expect(figure(cards[1], "Most it pays")).toBe("$173.84");
    expect(figure(cards[1], "Most you can make")).toBe("+$73.34");
    expect(figure(cards[1], "Breakeven")).toBe("$85,375");
    expect(figure(cards[1], "Pays in full")).toBe("$82,000 or below");
    expect(figure(cards[2], "You pay / most you can lose")).toBe("$100.49incl. $2.96 fees");
    expect(figure(cards[2], "Most it pays")).toBe("$257.88");
    expect(figure(cards[2], "Most you can make")).toBe("+$157.39");
    expect(figure(cards[2], "Breakeven")).toBe("$85,338");
    expect(figure(cards[2], "Pays in full")).toBe("$89,000 or above");
    expect(figure(cards[2], "Pays in part")).toBe("$83,000–$89,000");
    fireEvent.click(within(cards[0]).getByRole("button", { name: /Remove HYPE/ }));
    expect(onRemove).toHaveBeenCalledWith(`${hype.id}:yes`);
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Open details" }));
    expect(onSelect).toHaveBeenCalledWith(lower);
    expect(screen.queryByRole("button", { name: /Review|Trade|Connect/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("keeps missing selections visible and excludes undersized or invalid budgets from financial figures", () => {
    const missing = { id: higher.id, und: "BTC", side: "no", expiry: "20261009" };
    const { rerender } = render(<OutcomeComparison selections={[higher, missing]} budget={1} now={NOW} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText(/Smallest amount:/).textContent).toMatch(/\$24\.15/);
    expect(screen.getByText("Outcome data unavailable")).toBeTruthy();
    expect(screen.queryByText("Most it pays")).toBeNull();
    for (const budget of [NaN, Infinity, 0, -1]) {
      rerender(<OutcomeComparison selections={[higher, missing]} budget={budget} now={NOW} />);
      expect(screen.queryByText("Most it pays")).toBeNull();
      expect(screen.getByText("Enter an amount to compare")).toBeTruthy();
      expect(screen.getAllByRole("article")).toHaveLength(2);
    }
  });

  it("qualifies stale estimates and removes figures as prices pause or settlement begins", () => {
    const { rerender } = render(<OutcomeComparison selections={[higher]} budget={100} now={btc.prices_ts + 36 * 60} />);
    expect(screen.getByRole("status").textContent).toBe("Estimate · prices 36 min old");
    expect(screen.getByText("Most it pays")).toBeTruthy();
    rerender(<OutcomeComparison selections={[higher]} budget={100} now={btc.prices_ts + 91 * 60} />);
    expect(screen.getByRole("status").textContent).toBe("Prices paused");
    expect(screen.queryByText("Most it pays")).toBeNull();
    const settling = higher.settleTs - 1800;
    rerender(<OutcomeComparison selections={[{ ...higher, board: { ...btc, prices_ts: settling - 60 } }]} budget={100} now={settling} />);
    expect(screen.getByRole("status").textContent).toMatch(/^Settling/);
    expect(screen.queryByText("Most it pays")).toBeNull();
    rerender(<OutcomeComparison selections={[higher]} budget={100} now={higher.settleTs} />);
    expect(screen.getByRole("status").textContent).toBe("Settled");
    expect(screen.queryByText("Most it pays")).toBeNull();
  });

  it("keeps mismatched data unavailable and discloses the amount usable at a capped price", () => {
    const wrongLevel = { ...higher, level: lower.level };
    const missingFees = { ...hype, board: { ...hypeBoard, spec: {} } };
    const capped = { ...higher, level: { ...higher.level, yes: { ...higher.level.yes, size: 60 } } };
    render(<OutcomeComparison selections={[wrongLevel, missingFees, { ...capped, side: "yes" }]} budget={100.5} now={NOW} />);
    // Duplicate identity is a single choice, so inspect the capped outcome in a separate render.
    expect(screen.getByText("Outcome data unavailable")).toBeTruthy();
    expect(screen.getByText("Fee data unavailable")).toBeTruthy();
    expect(screen.queryByText("Most it pays")).toBeNull();
    expect(screen.getAllByRole("article")[0].querySelector("h3").textContent).toBe("BTC Higher $86,000");
    cleanup();
    render(<OutcomeComparison selections={[capped]} budget={100.5} now={NOW} />);
    const card = screen.getByRole("article");
    expect(figure(card, "Most it pays")).toBe("$60.00");
    expect(figure(card, "You pay / most you can lose")).toContain("$24.15");
    expect(screen.getByText(/Limited size at this price/).textContent).toBe("Limited size at this price · $24.15 of $100.50 used.");
  });

  it("shows a full-payout breakeven at equal cost, without treating a cost above payout as even", () => {
    const level = { id: "EQ-20261009-A-100-200", k: 150, lo: 100, hi: 200, state: "open",
      yes: { state: "open", form: "debit", buy: 0.99, size: 100,
        legs: [["EQ-20261009-100-C", "buy", 100], ["EQ-20261009-200-C", "sell", 1]] },
      no: { state: "open", form: "debit", buy: 0.99, size: 100,
        legs: [["EQ-20261009-200-P", "buy", 100], ["EQ-20261009-100-P", "sell", 1]] } };
    const board = { und: "EQ", index: 150, prices_ts: btc.prices_ts, spec: { base: 0.5, taker: 0, cap: 0, min: 1, step: 1 } };
    const selection = { id: level.id, und: "EQ", expiry: "20261009", settleTs: higher.settleTs, side: "yes", level, board };
    const { rerender } = render(<OutcomeComparison selections={[selection, { ...selection, side: "no" }]} budget={102} now={NOW} />);
    let cards = screen.getAllByRole("article");
    expect(figure(cards[0], "You pay / most you can lose")).toContain("$100.00");
    expect(figure(cards[0], "Most it pays")).toBe("$100.00");
    expect(figure(cards[0], "Breakeven")).toBe("$200 or above");
    expect(figure(cards[1], "Breakeven")).toBe("$100 or below");
    rerender(<OutcomeComparison selections={[{ ...selection, board: { ...board, spec: { ...board.spec, base: 1 } } }]} budget={102} now={NOW} />);
    cards = screen.getAllByRole("article");
    expect(figure(cards[0], "You pay / most you can lose")).toContain("$101.00");
    expect(figure(cards[0], "Breakeven")).toBe("None at this price");
    expect(figure(cards[0], "Most you can make")).toBe("None at this price");
  });
});
