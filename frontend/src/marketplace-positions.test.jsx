import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import { _resetMemory, loadPositions } from "./lib/positions.js";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path] ?? null }) }));
import MyQuestions from "./pages/MyQuestions.jsx";

const position = {
  key: "recorded-position", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes",
  lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01, settle_ts: 1791532800,
  legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both",
};
const show = (positions) => {
  localStorage.setItem("cowboy-questions", JSON.stringify(positions));
  return render(<MemoryRouter><MyQuestions /></MemoryRouter>);
};
const figure = (card, name) => within(card).getByText(name).closest("div").querySelector("dd");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((1791036000 + 600) * 1000);
  localStorage.clear();
  _resetMemory();
  docs.current = { "questions/BTC.json": btc };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("compact Positions", () => {
  it("keeps the value and execution state visible while the full record expands and removes only the saved record", async () => {
    const { container } = show([position]);
    const row = container.querySelector(".q-position");
    const details = row.querySelector(".q-position-details");
    expect(details.open).toBe(false);
    expect(figure(row, "You paid").textContent).toBe("$103.01");
    expect(Number(figure(row, "Value now").textContent.replace(/[$,]/g, ""))).toBeLessThan(91.57);
    expect(within(row).getByText("Placed by hand · both filled")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Remove" }).closest("details").open).toBe(false);
    expect(within(row).getByRole("button", { name: "Close" })).toBeTruthy();

    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(within(row).getByText("Position details"));
    expect(details.open).toBe(true);
    expect(figure(row, "Most it pays").textContent).toBe("$264.42");
    expect(within(row).getByRole("heading", { name: "Since you entered" })).toBeTruthy();
    await user.click(within(row).getByText("Entry record"));
    expect(row.querySelector(".q-entry").open).toBe(true);
    expect(row.querySelector(".q-entry").textContent).toContain(position.legs[0]);
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    expect(loadPositions()).toEqual([]);
    expect(screen.getByRole("heading", { name: "No positions yet" })).toBeTruthy();
  });

  it("keeps missing marks and incomplete fills unknown instead of displaying a portfolio value", () => {
    docs.current = {};
    const { container } = show([position, { ...position, key: "partial", exec: "hand_partial" }]);
    const [whole, part] = container.querySelectorAll(".q-position");
    expect(figure(whole, "Value now").textContent).toBe("No price nowi");
    expect(figure(whole, "Profit / loss now").textContent).toBe("Not available yeti");
    expect(figure(part, "Value now").textContent).toBe("Not available yeti");
    expect(within(part).getByText("Placed by hand · only the first filled")).toBeTruthy();
    expect(within(part).queryByRole("button", { name: "Close" })).toBeNull();
    expect(container.querySelector(".q-portfolio-summary").textContent).not.toContain("$");
    expect(screen.getByText("Open positions").nextElementSibling.textContent).toBe("2");
    expect(screen.getByText("Incomplete fills").nextElementSibling.textContent).toBe("1");
  });
});
