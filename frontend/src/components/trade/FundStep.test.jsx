// The fund step and the header menu after the owner's first testnet run (4 October 2026): a deposit to
// the new-account address on its way holds back a second send, and a second account is named.
import React from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { _setSeatState, seatState } from "../../lib/trade/seat.js";
import { FundStep } from "./SeatSetup.jsx";
import ApproveCowboy, { SeatLine } from "./ApproveCowboy.jsx";
import { otherNote } from "./WalletMenu.jsx";
import { BANNED } from "../../lib/questions.js";

afterEach(cleanup);

describe("the fund step", () => {
  it("says the deposit is on its way, with Send off, while a new-account deposit is pending", () => {
    _setSeatState({ stage: "fund", wallet: "0xw", saloon: null, newAccount: true, depositAddress: "0x9a3c5be1b0e4d0f7c6d2a8e1f3b4c5d6e7f80912", arriving: 10, opening: 1 });
    const { container } = render(<FundStep ethUsd={null} />);
    expect(screen.getByText("Your deposit is on its way")).toBeTruthy();
    expect(screen.getByText("$10.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send USDC" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Check again" }).disabled).toBe(false);
    expect(container.querySelector(".tr-addr")).toBeNull(); // no address to send to again
    expect(container.textContent).not.toMatch(BANNED);
  });

  it("offers the send when nothing is on its way", () => {
    _setSeatState({ stage: "fund", wallet: "0xw", saloon: null, newAccount: true, depositAddress: "0x9a3c5be1b0e4d0f7c6d2a8e1f3b4c5d6e7f80912", arriving: 0, opening: 0 });
    render(<FundStep ethUsd={null} />);
    expect(screen.queryByText("Your deposit is on its way")).toBeNull();
    expect(screen.getByRole("button", { name: /Send \$100 USDC/ }).disabled).toBe(false);
    expect(screen.getByRole("link", { name: /Fund it on Derive instead/ }).getAttribute("href")).toMatch(/testnet\.app\.derive\.xyz/);
  });

  it("names the existing empty account the deposit goes to", () => {
    _setSeatState({ stage: "fund", wallet: "0xw", saloon: { id: 130001, usdc: 0 }, depositAddress: "0x9a3c5be1b0e4d0f7c6d2a8e1f3b4c5d6e7f80912", arriving: 0, opening: 0 });
    render(<FundStep ethUsd={null} />);
    expect(screen.getByText("Add USDC to your Derive account #130001")).toBeTruthy();
  });
});

describe("the header menu", () => {
  it("names another Derive account holding USDC, and moves nothing", () => {
    expect(otherNote({ saloon: { id: 9 }, others: { count: 1, usdc: 10 } })).toBe("You have another Derive account with $10.00; Cowboy uses this one.");
    expect(otherNote({ saloon: { id: 9 }, others: null })).toBeNull();
    expect(otherNote({ saloon: null, others: { count: 1, usdc: 10 } })).toBeNull();
  });
});

describe("the approval proposes an account", () => {
  const A = { id: 130002, usdc: 900, label: "", manager: 1 }, B = { id: 130001, usdc: 40, label: "", manager: 1 };

  it("names the account and its USDC, with one button", () => {
    _setSeatState({ stage: "approve", wallet: "0xw", saloon: A, choices: [A], subs: [A] });
    const { container } = render(<ApproveCowboy />);
    expect(container.querySelector(".tr-lead").textContent).toBe("Cowboy trades from your Derive account #130002 ($900.00).");
    expect(screen.getAllByRole("button").map((b) => b.textContent).filter((t) => t !== "i")).toEqual(["Approve Cowboy"]);
    expect(screen.queryByText("Use another account")).toBeNull();
    expect(container.textContent).not.toMatch(BANNED);
  });

  it("lists every funded account under Use another account, and picks one without moving anything", () => {
    _setSeatState({ stage: "approve", wallet: "0xw", saloon: A, choices: [A, B], subs: [A, B] });
    render(<ApproveCowboy />);
    const more = screen.getByRole("button", { name: "Use another account" });
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("list", { name: "Your funded Derive accounts" });
    expect(list.textContent).toMatch(/#130002 \$900\.00 · in use/);
    fireEvent.click(within(list).getByRole("button", { name: /#130001/ }));
    expect(seatState()).toMatchObject({ stage: "approve", saloon: { id: 130001 }, others: { count: 1, usdc: 900 } });
    expect(screen.getByText(/Cowboy trades from your Derive account/).textContent).toMatch(/#130001 \(\$40\.00\)/);
  });

  it("the seat line names the account, with Change account when there are several", () => {
    const key = { subaccount_id: A.id, expiry_sec: 1791700000 };
    _setSeatState({ stage: "ready", wallet: "0xw", saloon: A, choices: [A, B], subs: [A, B], key });
    const { container } = render(<SeatLine />);
    expect(container.textContent).toMatch(/Derive account #130002 \$900\.00/);
    fireEvent.click(screen.getByRole("button", { name: "Change account" }));
    fireEvent.click(screen.getByRole("button", { name: /#130001/ }));
    expect(seatState()).toMatchObject({ stage: "approve", saloon: { id: 130001 } });
  });
});
