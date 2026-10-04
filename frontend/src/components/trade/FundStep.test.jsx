// The fund step and the header menu after the owner's first testnet run (4 October 2026): a deposit to
// the new-account address on its way holds back a second send, and a second account is named.
import React from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { _setSeatState } from "../../lib/trade/seat.js";
import { FundStep } from "./SeatSetup.jsx";
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
  });
});

describe("the header menu", () => {
  it("names another Derive account holding USDC, and moves nothing", () => {
    expect(otherNote({ saloon: { id: 9 }, others: { count: 1, usdc: 10 } })).toBe("You have another Derive account with $10.00; Cowboy uses this one.");
    expect(otherNote({ saloon: { id: 9 }, others: null })).toBeNull();
    expect(otherNote({ saloon: null, others: { count: 1, usdc: 10 } })).toBeNull();
  });
});
