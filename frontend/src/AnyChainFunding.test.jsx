import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({ current: {} }));
const flags = vi.hoisted(() => ({ FUND_ANYCHAIN: true, MAINNET_FILLS: true, TESTNET_FILLS: false, QUESTIONS_ON: true }));
const net = vi.hoisted(() => ({ real: true, chainName: "Ethereum", appUrl: "https://app.derive.xyz", name: "mainnet" }));
vi.mock("./lib/flags.js", () => flags);
vi.mock("./lib/trade/config.js", () => ({ NETWORK: net, DEPOSIT_SUGGESTED: 100 }));
vi.mock("./lib/trade/account.js", () => ({ depositCheck: () => ({ ok: true, min: 10 }) }));
vi.mock("./lib/trade/anychain.js", () => ({ fundingChains: vi.fn(), fundingHoldings: vi.fn(), fundingQuote: vi.fn() }));
vi.mock("./lib/trade/seat.js", () => ({
  useSeat: () => state.current,
  bridgeDeposit: vi.fn(), dismissRefundedBridge: vi.fn(), refreshBridge: vi.fn(), retryBridgeRegistration: vi.fn(),
  acceptTerms: vi.fn(), connect: vi.fn(), deposit: vi.fn(), depositGasUsd: vi.fn(async () => null),
  holdSend: vi.fn((seat) => seat.bridge?.phase === "sending_unknown"), pickAccount: vi.fn(), refreshFunding: vi.fn(),
}));
import AnyChainFunding, { BridgeProgress } from "./components/trade/AnyChainFunding.jsx";
import { FundStep } from "./components/trade/SeatSetup.jsx";
import { fundingChains, fundingHoldings, fundingQuote } from "./lib/trade/anychain.js";
import { bridgeDeposit, dismissRefundedBridge, deposit, depositGasUsd, refreshBridge, refreshFunding, retryBridgeRegistration } from "./lib/trade/seat.js";
import { fakeWallet } from "./lib/trade/fakeWallet.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETH = `0x${"0".repeat(40)}`;
const ARB = `0x${"a".repeat(40)}`;
const DAI = `0x${"d".repeat(40)}`;
const DESTINATION = `0x${"c".repeat(40)}`;
const TX = `0x${"ab".repeat(32)}`;
const chains = [
  { id: 8453, name: "Base", balanceAvailable: true, mainnet: true, chainType: "EVM" },
  { id: 42161, name: "Arbitrum", balanceAvailable: true, mainnet: true, chainType: "EVM" },
  { id: 1, name: "Ethereum", balanceAvailable: true, mainnet: true, chainType: "EVM" },
  { id: 137, name: "Polygon", balanceAvailable: false, mainnet: true, chainType: "EVM" },
];
const token = (chainId, address, symbol, balance, formattedBalance, decimals = 6) => ({ chainId, address, symbol, balance, formattedBalance, decimals });
const holdings = {
  8453: [token(8453, USDC, "USDC", "250000000", "250"), token(8453, ETH, "ETH", "5000000000000000", "0.005", 18), token(8453, DAI, "DAI", "0", "0")],
  42161: [token(42161, ARB, "ARB", "12000000000000000000", "12", 18)],
  1: [token(1, DAI, "DAI", "0", "0")],
};
const quote = (values = {}) => ({ arrivesUsd: 49.7, minArrivesUsd: 49.45, costUsd: .36, seconds: 30, minDepositUsd: 10, safetyUsd: 1, createdAt: Date.now(), expiresAt: Date.now() + 60_000, ...values });
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
const ready = async () => screen.findByRole("combobox", { name: "From chain" });
const amount = (value) => fireEvent.change(screen.getByRole("textbox", { name: /^Amount in/ }), { target: { value } });
const getQuote = () => fireEvent.click(screen.getByRole("button", { name: "See route and cost" }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(flags, { FUND_ANYCHAIN: true, MAINNET_FILLS: true, TESTNET_FILLS: false });
  net.real = true;
  const provider = fakeWallet({ chainId: 1 });
  state.current = { wallet: provider.address, provider, depositAddress: DESTINATION, client: {}, busy: false, newAccount: false, loggedAs: "owner", saloon: { id: 100, usdc: 0 } };
  fundingChains.mockResolvedValue(chains);
  fundingHoldings.mockImplementation(async (_wallet, chain) => holdings[chain.id].map((t) => ({ ...t })));
  fundingQuote.mockImplementation(async () => quote());
  depositGasUsd.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("funding interface", () => {
  it("offers only supported chains and tokens with a positive balance, without asking the wallet", async () => {
    render(<AnyChainFunding />);
    const chain = await ready(), tokenSelect = screen.getByRole("combobox", { name: "Pay with" });
    expect(within(chain).getAllByRole("option").map((o) => o.textContent)).toEqual(["Base", "Arbitrum"]);
    expect(within(tokenSelect).getAllByRole("option").map((o) => o.textContent)).toEqual(["USDC", "ETH"]);
    expect(screen.getByText("Available: 250 USDC")).toBeTruthy();
    expect(fundingHoldings).toHaveBeenCalledTimes(3);
    expect(state.current.provider.calls).toHaveLength(0);
    fireEvent.change(chain, { target: { value: "42161" } });
    expect(within(screen.getByRole("combobox", { name: "Pay with" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["ARB"]);
    expect(screen.getByRole("textbox", { name: "Amount in ARB" }).value).toBe("");
  });

  it("requires a fresh quote after an amount or token change and sends only the quote shown", async () => {
    render(<AnyChainFunding />);
    await ready(); amount("50"); getQuote();
    const send = await screen.findByRole("button", { name: "Send 50 USDC" });
    const reviewed = await fundingQuote.mock.results[0].value;
    expect(fundingQuote).toHaveBeenCalledWith(expect.objectContaining({ wallet: state.current.wallet, depositAddress: DESTINATION, token: expect.objectContaining({ address: USDC }), amount: "50" }));
    fireEvent.click(send);
    expect(bridgeDeposit).toHaveBeenCalledWith(reviewed);
    amount("60");
    expect(screen.queryByRole("button", { name: /^Send / })).toBeNull();
    expect(screen.queryByLabelText("Funding quote")).toBeNull();
    getQuote(); await screen.findByRole("button", { name: "Send 60 USDC" });
    fireEvent.change(screen.getByRole("combobox", { name: "Pay with" }), { target: { value: ETH } });
    expect(screen.getByRole("textbox", { name: "Amount in ETH" }).value).toBe("");
    expect(screen.queryByRole("button", { name: /^Send / })).toBeNull();
    expect(screen.getByRole("button", { name: "See route and cost" }).disabled).toBe(true);
    expect(state.current.provider.calls).toHaveLength(0);
  });

  it("includes required approval in the estimated cost without rounding small gas to zero", async () => {
    fundingQuote.mockResolvedValueOnce(quote({ costUsd: 0.365, approvalRequired: true, approvalGasUsd: 0.005 }));
    render(<AnyChainFunding />);
    await ready(); amount("50"); getQuote();
    await screen.findByRole("button", { name: "Send 50 USDC" });
    expect(screen.getByText("Estimated total cost")).toBeTruthy();
    expect(screen.getByText("Approval gas, included")).toBeTruthy();
    expect(screen.getByText("Less than $0.01")).toBeTruthy();
    expect(bridgeDeposit).not.toHaveBeenCalled();
  });

  it("keeps a newer quote when a request for the previous amount returns late", async () => {
    const older = deferred(), newer = deferred();
    fundingQuote.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    render(<AnyChainFunding />);
    await ready(); amount("50"); getQuote();
    const olderSignal = fundingQuote.mock.calls[0][0].signal;
    amount("60");
    expect(olderSignal.aborted).toBe(true);
    getQuote();
    await act(async () => newer.resolve(quote({ arrivesUsd: 59.7 })));
    expect(screen.getByRole("button", { name: "Send 60 USDC" })).toBeTruthy();
    await act(async () => older.resolve(quote({ arrivesUsd: 49.7 })));
    expect(screen.getByRole("button", { name: "Send 60 USDC" })).toBeTruthy();
    expect(screen.getByText("$59.70")).toBeTruthy();
  });

  it("shows the exact no-route message with the cause in Info", async () => {
    fundingQuote.mockRejectedValueOnce(new Error("No fast route supports this token amount."));
    render(<AnyChainFunding />);
    await ready(); amount("50"); getQuote();
    const status = await screen.findByRole("status");
    expect(status.childNodes[0].textContent).toBe("No route right now");
    expect(screen.queryByRole("button", { name: /^Send / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why no route is available" }));
    expect(screen.getByRole("dialog").textContent).toContain("No fast route supports this token amount.");
    expect(bridgeDeposit).not.toHaveBeenCalled();
  });

  it("expires the quote without submitting it and distinguishes unreadable balances from zero", async () => {
    const partial = Object.assign([...holdings[8453]], { unavailable: 2 });
    fundingHoldings.mockImplementation(async (_wallet, chain) => chain.id === 8453 ? partial : []);
    render(<AnyChainFunding />);
    await ready();
    expect(screen.getByRole("button", { name: "About wallet balance coverage" })).toBeTruthy();
    fundingQuote.mockResolvedValueOnce(quote({ createdAt: Date.now() - 70_000, expiresAt: Date.now() - 10_000 }));
    amount("50"); getQuote();
    const send = await screen.findByRole("button", { name: "Send 50 USDC" });
    await waitFor(() => expect(send.disabled).toBe(true));
    expect(screen.getByRole("status").textContent).toContain("This quote has expired.");
    expect(bridgeDeposit).not.toHaveBeenCalled();
  });
});

describe("funding progress", () => {
  it("keeps checking after the estimate reaches zero, without claiming completion", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    state.current.bridge = { txHash: TX, startedAt: Date.now(), phase: "bridging", quote: quote({ seconds: 3 }) };
    render(<BridgeProgress />);
    expect(screen.getByText("3s")).toBeTruthy();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("Taking longer than estimated. Checking delivery…")).toBeTruthy();
    expect(screen.queryByText("USDC delivered. Waiting for Derive.")).toBeNull();
    expect(refreshBridge).toHaveBeenCalledTimes(1);
    expect(bridgeDeposit).not.toHaveBeenCalled();
  });

  it("treats bridge delivery and Derive credit separately and retries tracking without a new send", () => {
    state.current.bridge = { txHash: TX, startedAt: Date.now(), phase: "delivered", status: "DONE", quote: quote(), registrationError: new Error("Registration temporarily unavailable") };
    render(<FundStep ethUsd={3000} />);
    expect(screen.getByText("USDC delivered. Waiting for Derive.")).toBeTruthy();
    const steps = screen.getByRole("list", { name: "Funding steps" });
    expect(within(steps).getByText("Derive credit").classList.contains("complete")).toBe(false);
    expect(screen.queryByRole("button", { name: "Send USDC" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry tracking" }));
    expect(retryBridgeRegistration).toHaveBeenCalledTimes(1);
    expect(bridgeDeposit).not.toHaveBeenCalled();
    expect(deposit).not.toHaveBeenCalled();
    expect(state.current.provider.calls).toHaveLength(0);
  });

  it("holds funding when the wallet outcome is unknown without claiming a transfer was sent", () => {
    state.current.bridge = { phase: "sending_unknown", quote: quote() };
    render(<FundStep ethUsd={3000} />);
    expect(screen.getByText("Check your wallet transfer")).toBeTruthy();
    expect(screen.queryByText("Your deposit is on its way")).toBeNull();
    expect(screen.queryByText("Arriving")).toBeNull();
    expect(screen.queryByLabelText("Deposit progress")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Send / })).toBeNull();
    expect(screen.queryByRole("group", { name: "Funding method" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(refreshFunding).toHaveBeenCalledTimes(1);
    expect(bridgeDeposit).not.toHaveBeenCalled();
    expect(deposit).not.toHaveBeenCalled();
    expect(state.current.provider.calls).toHaveLength(0);
  });

  it.each(["refund", "revert"])("offers a new route only after the core verifies a %s, without sending funds", (kind) => {
    state.current.bridge = { txHash: TX, startedAt: Date.now(), phase: "failed", safeToRetry: true,
      status: { status: "FAILED", substatus: kind === "refund" ? "REFUNDED" : "SOURCE_REVERTED" }, quote: quote() };
    render(<FundStep ethUsd={3000} />);
    expect(screen.getByText("Your transfer needs attention")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose another funding route" }));
    expect(dismissRefundedBridge).toHaveBeenCalledTimes(1);
    expect(bridgeDeposit).not.toHaveBeenCalled();
    expect(deposit).not.toHaveBeenCalled();
    expect(state.current.provider.calls).toHaveLength(0);
  });

  it.each(["PARTIAL", "REFUND_IN_PROGRESS", "UNKNOWN", "REFUNDED"])("blocks a new deposit for %s unless recovery has been verified", (substatus) => {
    state.current.bridge = { txHash: TX, startedAt: Date.now(), phase: "attention", safeToRetry: false,
      status: { status: "DONE", substatus }, quote: quote() };
    render(<FundStep ethUsd={3000} />);
    expect(screen.queryByRole("button", { name: "Choose another funding route" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Send / })).toBeNull();
    expect(screen.queryByText("USDC delivered. Waiting for Derive.")).toBeNull();
    const steps = screen.getByRole("list", { name: "Funding steps" });
    expect(within(steps).getByText("Bridge delivery").classList.contains("complete")).toBe(false);
    expect(dismissRefundedBridge).not.toHaveBeenCalled();
  });

});
