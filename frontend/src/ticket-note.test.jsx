// Builds with the Saloon on but no one-tap (production today): the trade's figures under one plain
// line, one-tap trading is coming, with how an answer trades in an (i); no orders to place by hand
// and no link to Derive. Selling back a position placed by hand earlier carries no such line.
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: false, TESTNET_FILLS: false, MAINNET_FILLS: false, ONE_TAP_FILLS: false }));
import QuestionTicket from "./components/QuestionTicket.jsx";
import { BANNED, budgetTicket, findLevel } from "./lib/questions.js";

afterEach(cleanup);
const ID = "BTC-20261009-A-82000-88000";
const { level, date } = findLevel(btc, ID);
const t = budgetTicket(level, "yes", 100, btc);
const show = (props = {}) => render(<MemoryRouter><QuestionTicket und="BTC" question="BTC above $85,000?" answer="Higher" level={level} sideKey="yes"
  t={t} board={btc} pricesTs={btc.prices_ts} settleTs={date.settle_ts} expiry={date.expiry} {...props} /></MemoryRouter>);

it("says plainly that one-tap trading is coming, with how an answer trades in an (i), and no way to Derive", async () => {
  show();
  const ticket = screen.getByRole("region", { name: "Your trade" });
  const note = ticket.querySelector(".q-onetap-note");
  expect(note.textContent).toContain("One-tap trading is coming to Cowboy.");
  expect(note.textContent).not.toMatch(/yourself|by hand/);
  expect(ticket.firstElementChild).toBe(note);
  expect(ticket.querySelector("a[href], details.q-details")).toBeNull();
  expect(ticket.textContent).not.toMatch(/Open Derive|I placed it/);
  await userEvent.setup().click(within(note).getByRole("button", { name: "About one-tap trading" }));
  const why = screen.getByRole("dialog").textContent;
  expect(why).toContain("two Derive options traded together at one price");
  for (const s of [note.textContent, why]) expect(s).not.toMatch(BANNED);
});

it("leaves the line off the sell-back ticket", () => {
  show({ closing: true, answer: "Higher" });
  expect(screen.queryByText(/One-tap trading is coming/)).toBeNull();
});
