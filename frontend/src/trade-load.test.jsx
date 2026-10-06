// One-tap builds: while the trade chunk loads the ticket reads "Loading one-tap…" (never the manual
// ticket), and when the chunk fails to load (a stale page after a deploy) it offers a reload, with the
// manual ticket behind "Place by hand".
import React from "react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";
import { budgetTicket, findLevel } from "./lib/questions.js";

const ctl = vi.hoisted(() => ({ gate: null, fail: false }));
vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true }));

const ID = "BTC-20261009-A-82000-88000";
const { level, date } = findLevel(btc, ID);
const t = budgetTicket(level, "yes", 100, btc);
let release;
beforeEach(() => {
  vi.resetModules();
  ctl.gate = new Promise((r) => { release = r; });
  ctl.fail = false;
  vi.doMock("./components/trade/TradePanel.jsx", async () => {
    await ctl.gate;
    if (ctl.fail) throw new Error("Failed to fetch dynamically imported module");
    return { default: () => <section aria-label="One tap">one tap</section> };
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function show() {
  const { default: Ticket } = await import("./components/QuestionTicket.jsx");
  return render(<MemoryRouter><Ticket und="BTC" question="BTC above $85,000?" answer="Higher" level={level} sideKey="yes"
    t={t} board={btc} pricesTs={btc.prices_ts} settleTs={date.settle_ts} expiry={date.expiry} /></MemoryRouter>);
}

it("shows a loading line, not the manual ticket, while the trade code loads", async () => {
  await show();
  expect(screen.getByRole("status").textContent).toBe("Loading one-tap…");
  expect(screen.queryByRole("region", { name: "Your trade" })).toBeNull();
  release();
  expect(await screen.findByRole("region", { name: "One tap" })).toBeTruthy();
  expect(screen.queryByText("Loading one-tap…")).toBeNull();
});

it("offers a reload when the trade code fails to load, and no way to place by hand", async () => {
  ctl.fail = true;
  release();
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
  await show();
  expect(await screen.findByText("Reload to trade in one tap")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Your trade" })).toBeNull();
  const u = userEvent.setup();
  await u.click(screen.getByRole("button", { name: "Reload" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Place by hand" })).toBeNull();
  vi.unstubAllGlobals();
});
