// Builds with the Saloon on but no one-tap (production today): one plain line above the manual ticket,
// with why there are two orders in an (i). Selling back by hand carries no such line.
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: false, TESTNET_FILLS: false }));
import QuestionTicket from "./components/QuestionTicket.jsx";
import { BANNED, budgetTicket, findLevel } from "./lib/questions.js";

afterEach(cleanup);
const ID = "BTC-20261009-A-82000-88000";
const { level, date } = findLevel(btc, ID);
const t = budgetTicket(level, "yes", 100, btc);
const show = (props = {}) => render(<MemoryRouter><QuestionTicket und="BTC" question="BTC above $85,000?" answer="Higher" level={level} sideKey="yes"
  t={t} board={btc} pricesTs={btc.prices_ts} settleTs={date.settle_ts} expiry={date.expiry} {...props} /></MemoryRouter>);

it("says plainly above the manual ticket that one-tap trading is coming, with the two orders explained in an (i)", async () => {
  show();
  const ticket = screen.getByRole("region", { name: "Place on Derive" });
  const note = ticket.querySelector(".q-onetap-note");
  expect(note.textContent).toContain("One-tap trading is coming to Cowboy. For now, place the two orders on Derive yourself.");
  expect(ticket.firstElementChild).toBe(note);
  await userEvent.setup().click(within(note).getByRole("button", { name: "Why two orders" }));
  const why = screen.getByRole("dialog").textContent;
  expect(why).toContain("two options traded together");
  for (const s of [note.textContent, why]) expect(s).not.toMatch(BANNED);
});

it("leaves the line off the sell-back ticket", () => {
  show({ closing: true, answer: "Higher" });
  expect(screen.queryByText(/One-tap trading is coming/)).toBeNull();
});
