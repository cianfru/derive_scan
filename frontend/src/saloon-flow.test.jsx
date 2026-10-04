import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import index from "./fixtures/questions/index.json";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: path ? docs.current[path] ?? null : null, error: null }) }));
vi.mock("./components/QuestionChart.jsx", () => ({ default: () => <div data-testid="chart" /> }));
import Questions from "./pages/Questions.jsx";
import { BANNED } from "./lib/questions.js";

const T14 = 1791036000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((T14 + 600) * 1000);
  docs.current = { "questions/index.json": index, "questions/BTC.json": btc, "markets.json": { coins: [] } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const show = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/saloon/guided" element={<Questions />} />
      <Route path="/saloon/:und" element={<Questions />} />
      <Route path="/q/:id" element={<Questions />} />
    </Routes>
  </MemoryRouter>,
);
const user = () => userEvent.setup({ advanceTimers: () => {} });
const primaries = (region) => region.querySelectorAll(".btn.primary");
const step = (name) => screen.queryByRole("region", { name });

describe("the guided flow", () => {
  it("opens on coin, date and higher or lower, with no direction picked and nothing to place", () => {
    const { container } = show("/saloon/guided");
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(step("Amount")).toBeNull();
    expect(step("What it pays")).toBeNull();
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(0);
    // The ladder and the price history are folded away.
    expect(container.querySelector(".q-ladder")).toBeNull();
    expect(container.querySelector("details.q-history").open).toBe(false);
    expect(screen.queryByTestId("chart")).toBeNull();
    for (const n of ["Coin", "Date", "Higher or lower"]) expect(primaries(step(n))).toHaveLength(0);
  });

  it("reaches the outcome preview in two taps from /saloon/guided, one primary action per step", async () => {
    const u = user();
    show("/saloon/guided");
    await u.click(screen.getAllByRole("radio")[1]); // 1: Lower
    const amount = step("Amount");
    expect(primaries(amount)).toHaveLength(1);
    expect(within(amount).getByRole("button", { name: "See what it pays" }).classList.contains("primary")).toBe(true);
    // The bar names the chosen answer and the most you can lose, which is the amount, fees included.
    const bar = within(amount).getByLabelText("Your answer");
    expect(bar.textContent).toMatch(/^Lower · \$[\d,]+ · Mon 5 Octmost you can lose \$[\d.]+ · fees included/);
    await u.click(within(amount).getByRole("button", { name: "See what it pays" })); // 2
    const preview = step("What it pays");
    expect(preview.querySelector(".op-figs")).not.toBeNull();
    expect(primaries(preview)).toHaveLength(1);
    expect(primaries(step("Amount"))).toHaveLength(0);
    expect(within(preview).getByRole("button", { name: "Place on Derive" })).toBeTruthy();
    // The selection reads the same in the picks, the bar and the ticket.
    expect(screen.getAllByRole("radio")[1].getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".q-ticket h3").textContent).toMatch(/Lower · full \$1 at or below/);
    for (const t of [document.body.textContent]) expect(t).not.toMatch(BANNED);
  });

  it("lands a deep link with an answer on the preview", () => {
    show("/q/BTC-20261009-A-83000-89000?side=yes");
    expect(step("What it pays")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Review orders" })).toBeTruthy();
  });

  it("puts the full ladder under Other levels; a pick opens that outcome with its amount and payout", async () => {
    const u = user();
    const { container } = show("/saloon/BTC");
    const other = screen.getByRole("button", { name: "Other levels" });
    expect(other.getAttribute("aria-expanded")).toBe("false");
    await u.click(other);
    expect(container.querySelector(".q-ladder")).not.toBeNull();
    const row = screen.getAllByRole("row").find((r) => !r.classList.contains("headline") && r.querySelector("a.q-btn.yes"));
    const k = row.getAttribute("aria-label").replace("Higher or lower than ", "");
    await u.click(row.querySelector("a.q-btn.yes"));
    expect(screen.getByRole("heading", { level: 1, name: new RegExp(`than \\${k.replace(/,/g, ",")} on`) })).toBeTruthy();
    expect(step("Amount")).not.toBeNull();
    expect(step("What it pays")).not.toBeNull();
    expect(container.querySelector(".q-ladder")).toBeNull();
    expect(screen.getAllByRole("radio")[0].getAttribute("aria-checked")).toBe("true");
  });

  it("changing the date clears the answer: a new date is a new choice", async () => {
    const u = user();
    show("/saloon/BTC");
    await u.click(screen.getAllByRole("radio")[0]);
    expect(step("Amount")).not.toBeNull();
    await u.click(screen.getByRole("tab", { name: "This Friday · 9 Oct" }));
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(step("Amount")).toBeNull();
  });

  it("shows the price history only when opened", async () => {
    const u = user();
    const { container } = show("/saloon/BTC");
    await u.click(container.querySelector("details.q-history summary"));
    expect(screen.getByTestId("chart")).toBeTruthy();
  });
});
