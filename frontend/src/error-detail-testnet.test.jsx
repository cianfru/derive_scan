// Testnet builds: an error in the seat carries "Details for testing" in an (i) beside its plain message.
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true, tradeMode: () => "testnet" }));
import { ConnectStep } from "./components/trade/SeatSetup.jsx";
import { _setSeatDeps } from "./lib/trade/seat.js";
import { createClient } from "./lib/trade/derive.js";
import { fakeDerive } from "./lib/trade/fakeSocket.js";
import { fakeWallet } from "./lib/trade/fakeWallet.js";
import { TESTNET_WS } from "./lib/trade/config.js";

afterEach(() => { cleanup(); localStorage.clear(); });

it("shows the step, source and code behind a wallet error", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const w = fakeWallet({ chainId: 1 });
  const provider = { ...w, request: (a) => (a.method === "wallet_switchEthereumChain" ? Promise.reject(Object.assign(new Error("Unrecognized chain"), { code: 4902 }))
    : a.method === "wallet_addEthereumChain" ? Promise.reject(Object.assign(new Error("User rejected"), { code: 4001 })) : w.request(a)) };
  _setSeatDeps({ findProvider: () => provider, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fakeDerive().WebSocketImpl }) });
  const user = userEvent.setup();
  render(<ConnectStep />);
  await user.click(screen.getByRole("button", { name: "Connect wallet" }));
  expect(await screen.findByText("You declined in your wallet.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Details for testing" }));
  const pop = screen.getByRole("dialog", { name: "Details for testing" });
  expect(pop.textContent).toMatch(/Step\s*add network/);
  expect(pop.textContent).toMatch(/Source\s*wallet/);
  expect(pop.textContent).toMatch(/Code\s*4001/);
  expect(pop.textContent).toMatch(/User rejected/);
  warn.mockRestore();
});
