// Builds other than the testnet one keep plain messages only: no codes on screen.
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: false, MAINNET_FILLS: false, ONE_TAP_FILLS: false, tradeMode: () => "dryrun" }));
import { ConnectStep } from "./components/trade/SeatSetup.jsx";
import { _setSeatDeps } from "./lib/trade/seat.js";
import { createClient } from "./lib/trade/derive.js";
import { fakeDerive } from "./lib/trade/fakeSocket.js";
import { fakeWallet } from "./lib/trade/fakeWallet.js";
import { TESTNET_WS } from "./lib/trade/config.js";

afterEach(() => { cleanup(); localStorage.clear(); });

it("shows the plain message without testing details", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const w = fakeWallet();
  const provider = { ...w, request: (a) => (a.method === "eth_requestAccounts" ? Promise.reject(Object.assign(new Error("Locked"), { code: 4100 })) : w.request(a)) };
  _setSeatDeps({ findProvider: () => provider, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fakeDerive().WebSocketImpl }) });
  const user = userEvent.setup();
  render(<ConnectStep />);
  await user.click(screen.getByRole("button", { name: "Connect wallet" }));
  expect(await screen.findByText("Your wallet hasn't given this site access yet. Unlock it and try again.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Details for testing" })).toBeNull();
  expect(document.body.textContent).not.toMatch(/4100/);
  warn.mockRestore();
});
