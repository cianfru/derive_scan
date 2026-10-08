// The header's "Connect wallet" on a testnet build, before its code has loaded: the placeholder is
// there from the first render, and a tap on it connects once the trade chunk arrives. In its own file
// so the Shell's lazy wallet has not loaded yet when the test starts.
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import shapes from "./fixtures/trade/private_shapes.json";

vi.mock("./lib/flags.js", () => ({ FUND_ANYCHAIN: false, RYSK_MOCK: false, QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true, MAINNET_FILLS: false, ONE_TAP_FILLS: true, tradeMode: () => "testnet" }));
import Shell from "./components/Shell.jsx";
import { _setSeatDeps } from "./lib/trade/seat.js";
import { createClient } from "./lib/trade/derive.js";
import { fakeDerive } from "./lib/trade/fakeSocket.js";
import { fakeWallet } from "./lib/trade/fakeWallet.js";
import { TESTNET_WS } from "./lib/trade/config.js";

afterEach(() => { cleanup(); localStorage.clear(); });

it("connects once the code has loaded when the header's button was tapped before", async () => {
  window.scrollTo = () => {};
  localStorage.setItem("cowboy-saloon-terms:testnet", JSON.stringify({ at: 1 }));
  const fake = fakeDerive({
    handlers: {
      "public/login": shapes["public/login"],
      "private/get_subaccounts": shapes["private/get_subaccounts"],
      "private/get_subaccount": ({ subaccount_id }) => shapes["private/get_subaccount"][subaccount_id],
    },
  });
  const wallet = fakeWallet();
  _setSeatDeps({ findProvider: () => wallet, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) });
  render(<MemoryRouter><Shell /></MemoryRouter>);
  const header = document.querySelector("header.hdr");
  const slot = within(header).getByRole("button", { name: "Connect wallet" });
  expect(slot.dataset.ready).toBeUndefined();
  fireEvent.click(slot);
  expect(within(header).getByRole("button", { name: "Connecting" }).textContent).toBe("Connecting…");
  await waitFor(() => expect(within(header).getByRole("button", { name: /^Wallet 0x/ }).dataset.ready).toBe("1"));
  expect(wallet.calls.filter((c) => c.method === "eth_requestAccounts")).toHaveLength(1);
  expect(fake.calls("public/login")).toHaveLength(1);
});
