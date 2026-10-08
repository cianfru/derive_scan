import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../flags.js", async (original) => ({ ...await original(), FUND_ANYCHAIN: true }));
vi.mock("../pilot.js", () => ({ isPilot: () => true, forgetPilotInvite: () => {} }));
vi.mock("./config.js", async (original) => {
  const c = await original();
  return { ...c, MODE: "mainnet", NETWORK: { ...c.NETWORK, name: "mainnet", real: true, chainId: 1, wsUrl: "wss://fake", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" } };
});
import { NETWORK } from "./config.js";
import { createClient } from "./derive.js";
import { fakeDerive, deriveError } from "./fakeSocket.js";
import { fakeWallet } from "./fakeWallet.js";
import { _resetAssets } from "./account.js";
import { _setSeatDeps, _setSeatState, bridgeDeposit, connect, deposit as depositUsdc, retryBridgeRegistration, disconnect, dismissRefundedBridge, holdSend, refreshBridge, refreshFunding, seatState } from "./seat.js";
import { KEYS, read, write } from "./store.js";
import { validateFundingQuote } from "./anychain.js";

const token = "0x3333333333333333333333333333333333333333", deposit = "0x2222222222222222222222222222222222222222";
const chain = { id: 8453, mainnet: true, chainType: "EVM", metamask: { chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://base-rpc.publicnode.com"] } };
const risk = [{ managers: [{ manager_id: 1, collaterals: [{ name: "USDC", address: NETWORK.usdcAsset, min_deposit_usd: "5", erc20: { underlying_erc20: NETWORK.usdc, decimals: 6 } }] }] }];
function quoteFor(wallet) {
  const request = { wallet, fromChain: 8453, token: { address: token, chainId: 8453, decimals: 6, balance: "20000000" }, fromAmount: "10000000", chain,
    destination: { chainId: 1, address: deposit, token: NETWORK.usdc, decimals: 6 } };
  const raw = { tool: "relay", transactionId: "provider-id", action: { fromChainId: 8453, toChainId: 1, fromAddress: wallet, toAddress: deposit,
    fromToken: request.token, toToken: { chainId: 1, address: NETWORK.usdc, decimals: 6, priceUSD: "1" }, fromAmount: "10000000" },
    estimate: { tool: "relay", fromAmount: "10000000", fromAmountUSD: "10", toAmount: "9800000", toAmountMin: "9700000", executionDuration: 4, approvalAddress: token, gasCosts: [{ amountUSD: "0.01" }] },
    transactionRequest: { from: wallet, to: token, chainId: 8453, data: "0xabcd", value: "0" } };
  return validateFundingQuote(raw, request, { minDepositUsd: 5, safetyUsd: 0.5 });
}
function setup({ allowance = 10000000, newAccount = true, registerFails = false, register = null, changeRoute = false, costWorse = false, approvalCost = 0 } = {}) {
  const wallet = fakeWallet({ chainId: 1, allowance, emitSwitch: true });
  const account = { usdc: 0 };
  const fake = fakeDerive({ handlers: {
    "public/login": () => newAccount ? deriveError(14000) : [1],
    "private/get_subaccounts": { subaccount_ids: [1] },
    "private/get_subaccount": () => ({ subaccount_id: 1, manager_id: 1, label: "", collaterals: account.usdc ? [{ asset_name: "USDC", amount: String(account.usdc) }] : [] }),
    "public/register_deposit_address": { deposit_address: deposit },
    "public/get_pending_deposits": { pending_deposits: [] },
    "public/get_risk_universes": risk,
    "private/register_bridge_deposit": register || (registerFails ? deriveError(9002) : { bridge_status: "registered" }),
  } });
  const quote = quoteFor(wallet.address);
  quote.costUsd += approvalCost; quote.approvalGasUsd = approvalCost;
  _setSeatDeps({ findProvider: () => wallet, createClient: () => createClient({ url: NETWORK.wsUrl, WebSocketImpl: fake.WebSocketImpl, retries: 0 }),
    fundingQuote: async () => {
      const approved = wallet.calls.some((c) => c.method === "eth_sendTransaction" && c.params[0].data?.startsWith("0x095ea7b3"));
      return { ...quote, minArrivesUsd: quote.minArrivesUsd - (changeRoute ? 0.1 : 0),
        costUsd: quote.costUsd + (costWorse ? 0.004 : 0) - (approved ? approvalCost : 0), approvalGasUsd: approved ? 0 : approvalCost };
    } });
  write(KEYS.terms(), { at: Date.now() });
  return { wallet, fake, quote, account };
}
beforeEach(() => { localStorage.clear(); _resetAssets(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { disconnect(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("registers the source transfer and enters onWay without a second first-account sign-in", async () => {
  const { wallet, fake, quote } = setup();
  await connect(); expect(seatState().stage).toBe("fund");
  expect(wallet.calls.filter((c) => c.method === "personal_sign")).toHaveLength(1);
  await bridgeDeposit(quote);
  expect(seatState()).toMatchObject({ stage: "fund", busy: false, bridge: { phase: "on_way", txHash: `0x${"ab".repeat(32)}` } });
  expect(wallet.calls.filter((c) => c.method === "personal_sign")).toHaveLength(1);
  expect(wallet.calls.filter((c) => c.method === "eth_sendTransaction")).toHaveLength(1);
  expect(fake.calls("private/register_bridge_deposit")[0].params).toMatchObject({ wallet: wallet.address, rail: "lifi", source_chain_id: 8453, deposit_address: deposit, expected_amount: "9800000", provider_transfer_id: "provider-id" });
  expect(read(KEYS.sent(wallet.address)).bridge.source_chain_id).toBe(8453);
});

it("uses existing owner authentication without another sign-in and sends exact approval only when needed", async () => {
  const { wallet, fake, quote } = setup({ newAccount: false, allowance: 0 });
  await connect(); await bridgeDeposit(quote);
  expect(wallet.calls.filter((c) => c.method === "personal_sign")).toHaveLength(1);
  const transfers = wallet.calls.filter((c) => c.method === "eth_sendTransaction");
  expect(transfers).toHaveLength(2);
  expect(transfers[0].params[0].data.startsWith("0x095ea7b3")).toBe(true);
  expect(BigInt(`0x${transfers[0].params[0].data.slice(-64)}`)).toBe(10000000n);
  expect(transfers[1].params[0].data).toBe("0xabcd");
  expect(fake.calls("private/register_bridge_deposit")).toHaveLength(1);
});

it("stops a changed route before any source transaction", async () => {
  const { wallet, quote } = setup({ changeRoute: true });
  await connect(); await bridgeDeposit(quote);
  expect(wallet.calls.filter((c) => c.method === "eth_sendTransaction")).toHaveLength(0);
  expect(seatState().message).toMatch(/changed/);
});

it("asks for review even when a worsening fee is less than half a cent", async () => {
  const { wallet, quote } = setup({ costWorse: true }); await connect(); await bridgeDeposit(quote);
  expect(wallet.calls.filter((c) => c.method === "eth_sendTransaction")).toHaveLength(0);
  expect(seatState().message).toMatch(/changed/);
});

it("retains the paid approval estimate in total cost after rechecking the allowance", async () => {
  const { wallet, quote } = setup({ allowance: 0, approvalCost: 0.01 }); await connect(); await bridgeDeposit(quote);
  expect(wallet.calls.filter((c) => c.method === "eth_sendTransaction")).toHaveLength(2);
  expect(seatState().bridge.phase).toBe("on_way");
  expect(seatState().bridge.quote.costUsd).toBeCloseTo(quote.costUsd);
  expect(seatState().bridge.quote.approvalGasUsd).toBe(0.01);
});

it("retains the sent receipt when display registration fails and never sends it again", async () => {
  const { wallet, quote } = setup({ registerFails: true });
  await connect(); await bridgeDeposit(quote);
  expect(seatState().bridge).toMatchObject({ phase: "on_way", registrationError: expect.any(String) });
  await bridgeDeposit(quote);
  expect(wallet.calls.filter((c) => c.method === "eth_sendTransaction")).toHaveLength(1);
});

it("cancels on account change during approval without sending or restoring the old seat", async () => {
  const { wallet, fake, quote } = setup({ allowance: 0 });
  await connect();
  const request = wallet.request.bind(wallet);
  wallet.request = async (args) => {
    if (args.method === "eth_sendTransaction") { wallet.emit("accountsChanged", [deposit]); return `0x${"ab".repeat(32)}`; }
    return request(args);
  };
  await bridgeDeposit(quote);
  expect(seatState().stage).toBe("disconnected");
  expect(fake.calls("private/register_bridge_deposit")).toHaveLength(0);
});

it("keeps a source receipt under its original wallet when Disconnect happens during broadcast", async () => {
  const { wallet, fake, quote } = setup();
  await connect();
  const request = wallet.request.bind(wallet);
  wallet.request = async (args) => { if (args.method === "eth_sendTransaction") { disconnect(); return `0x${"ab".repeat(32)}`; } return request(args); };
  await bridgeDeposit(quote);
  expect(seatState().stage).toBe("disconnected");
  expect(read(KEYS.sent(wallet.address)).tx).toBe(`0x${"ab".repeat(32)}`);
  expect(fake.calls("private/register_bridge_deposit")).toHaveLength(0);
});

it("polls bridge and public deposit status without wallet prompts", async () => {
  const { wallet, fake, quote } = setup({ newAccount: false });
  await connect(); await bridgeDeposit(quote);
  fake.sockets.at(-1).drop();
  const before = wallet.calls.length;
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ status: "DONE", substatus: "COMPLETED", toAddress: deposit, receiving: { chainId: 1, amount: "9800000", token: { address: NETWORK.usdc, decimals: 6 } } }) }));
  await refreshBridge();
  expect(wallet.calls).toHaveLength(before);
  expect(seatState().bridge.phase).toBe("delivered");
});

it("reserves approval plus transfer gas before sending an approval", async () => {
  const { wallet, quote } = setup({ allowance: 0 });
  await connect();
  const request = wallet.request.bind(wallet);
  wallet.request = (args) => args.method === "eth_getBalance" ? Promise.resolve("0x1") : request(args);
  await bridgeDeposit(quote);
  expect(wallet.calls.filter((c) => c.method === "eth_sendTransaction")).toHaveLength(0);
  expect(seatState().message).toMatch(/source-chain gas/);
});

it("a late cancelled bridge cannot replace a newer same-wallet receipt or recovery identity", async () => {
  const { wallet, quote } = setup();
  let clock = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => clock);
  await connect();
  const request = wallet.request.bind(wallet);
  let release, started, sources = 0;
  const entered = new Promise((resolve) => { started = resolve; });
  const oldHash = `0x${"cd".repeat(32)}`, newHash = `0x${"ef".repeat(32)}`;
  wallet.request = async (args) => {
    if (args.method === "eth_sendTransaction" && args.params[0].data === "0xabcd") {
      if (++sources === 1) { started(); return new Promise((resolve) => { release = resolve; }); }
      return newHash;
    }
    return request(args);
  };
  const old = bridgeDeposit(quote);
  await entered;
  expect(read(KEYS.bridge(wallet.address)).phase).toBe("sending_unknown");
  disconnect();
  // Reproduce another confirmed same-wallet funding operation in another tab. The late result
  // must retain its own archive entry without replacing that tab's newer held transfer.
  clock += 10;
  const newer = { quote, txHash: newHash, startedAt: clock, started_at: clock, phase: "on_way" };
  write(KEYS.bridge(wallet.address), newer);
  write(KEYS.sent(wallet.address), { tx: newHash, at: clock, started_at: clock });
  release(oldHash); await old;
  expect(read(KEYS.sent(wallet.address)).tx).toBe(newHash);
  expect(read(KEYS.bridge(wallet.address)).txHash).toBe(newHash);
  expect(read(KEYS.bridgeHistory(wallet.address)).some((b) => b.txHash === oldHash)).toBe(true);
});

it("restores a pre-hash sending intent and holds another send after reconnect", async () => {
  const { wallet, quote } = setup();
  await connect();
  write(KEYS.bridge(wallet.address), { quote, txHash: null, phase: "sending_unknown", startedAt: Date.now(), started_at: Date.now() });
  disconnect(); await connect();
  expect(seatState()).toMatchObject({ stage: "fund", bridge: { phase: "sending_unknown", txHash: null } });
  expect(holdSend(seatState())).toBe(true);
  await bridgeDeposit(quote);
  expect(wallet.calls.filter((c) => c.method === "eth_sendTransaction")).toHaveLength(0);
});

it("clears a known source wallet rejection but retains ambiguous send failures", async () => {
  const { wallet, quote } = setup();
  await connect();
  const request = wallet.request.bind(wallet);
  wallet.request = (args) => args.method === "eth_sendTransaction" ? Promise.reject(Object.assign(new Error("Declined"), { code: 4001 })) : request(args);
  await bridgeDeposit(quote);
  expect(read(KEYS.bridge(wallet.address))).toBeNull();
  expect(holdSend(seatState())).toBe(false);
  wallet.request = (args) => args.method === "eth_sendTransaction" ? Promise.reject(Object.assign(new Error("Lost response"), { code: 4900 })) : request(args);
  await bridgeDeposit(quote);
  expect(read(KEYS.bridge(wallet.address)).phase).toBe("sending_unknown");
  expect(holdSend(seatState())).toBe(true);
});

it("cancels an unexpected return to Ethereum while source confirmation is pending", async () => {
  const { wallet, fake, quote } = setup(); await connect();
  const request = wallet.request.bind(wallet);
  wallet.request = async (args) => {
    if (args.method === "eth_sendTransaction") { expect(args.params[0].chainId).toBe("0x2105"); wallet.emit("chainChanged", "0x1"); return `0x${"ab".repeat(32)}`; }
    return request(args);
  };
  await bridgeDeposit(quote);
  expect(seatState().stage).toBe("disconnected");
  expect(fake.calls("private/register_bridge_deposit")).toHaveLength(0);
});

it("single-flights slow public polls and clears a recovered status error", async () => {
  const { wallet, quote } = setup(); await connect(); await bridgeDeposit(quote);
  _setSeatState({ ...seatState(), bridge: { ...seatState().bridge, statusError: "unavailable" } });
  let release; const response = new Promise((resolve) => { release = resolve; });
  const fetch = vi.fn(async () => response); vi.stubGlobal("fetch", fetch);
  const first = refreshBridge(), second = refreshBridge();
  expect(second).toBe(first); expect(fetch).toHaveBeenCalledTimes(1);
  release({ ok: true, json: async () => ({ status: "PENDING" }) }); await first;
  expect(seatState().bridge.statusError).toBeNull();
  expect(holdSend(seatState())).toBe(true);
});

it("does not resolve an existing account's bridge from an old positive USDC balance", async () => {
  const { wallet, quote, account } = setup({ newAccount: false }); await connect();
  account.usdc = 3;
  _setSeatState({ ...seatState(), saloon: { ...seatState().saloon, usdc: 3 }, depositAddress: deposit, stage: "fund" });
  await bridgeDeposit(quote);
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ status: "PENDING" }) }));
  await refreshFunding();
  expect(seatState()).toMatchObject({ stage: "fund", saloon: { usdc: 3 }, bridge: { phase: "on_way", baseline: { usdc: 3 } } });
  disconnect(); await connect();
  expect(seatState()).toMatchObject({ stage: "fund", bridge: { phase: "on_way" } });
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ status: "DONE", substatus: "COMPLETED", toAddress: deposit, receiving: { chainId: 1, amount: "9800000", token: { address: NETWORK.usdc, decimals: 6 } } }) }));
  await refreshFunding();
  expect(seatState().stage).toBe("fund");
  account.usdc = 12.8; await refreshFunding();
  expect(seatState()).toMatchObject({ stage: "approve", bridge: null });
  expect(read(KEYS.bridge(wallet.address))).toBeNull();
  expect(read(KEYS.bridgeHistory(wallet.address))[0].phase).toBe("credited");
});

it("does not release an unknown-hash intent from an existing positive balance", async () => {
  const { wallet, quote, account } = setup({ newAccount: false }); await connect();
  account.usdc = 3;
  write(KEYS.bridge(wallet.address), { quote, txHash: null, phase: "sending_unknown", startedAt: Date.now(), started_at: Date.now(), baseline: { subaccountId: 1, usdc: 3 } });
  disconnect(); await connect();
  expect(seatState()).toMatchObject({ stage: "fund", saloon: { usdc: 3 }, bridge: { phase: "sending_unknown" } });
  await refreshFunding();
  expect(seatState().stage).toBe("fund");
  expect(holdSend(seatState())).toBe(true);
  expect(read(KEYS.bridge(wallet.address)).phase).toBe("sending_unknown");
});

it("releases a verified reverted source transaction only after rechecking, retaining its archive", async () => {
  const { wallet, quote } = setup(); await connect(); await bridgeDeposit(quote);
  vi.stubGlobal("fetch", async (url, options) => {
    if (url.includes("/status")) return { ok: true, json: async () => ({ status: "FAILED" }) };
    const method = JSON.parse(options.body).method;
    return { ok: true, json: async () => ({ result: method === "eth_getTransactionReceipt" ? { status: "0x0" } : "0xa00000" }) };
  });
  await refreshBridge();
  expect(seatState().bridge.safeToRetry).toBe(true);
  await dismissRefundedBridge();
  expect(seatState().bridge).toBeNull();
  expect(holdSend(seatState())).toBe(false);
  expect(read(KEYS.bridgeHistory(wallet.address))[0].phase).toBe("refunded_verified");
});

// Review findings on #123 (8 October 2026).
it("returns the wallet to Ethereum before a direct deposit after a bridge attempt failed on the source chain", async () => {
  const { wallet, quote } = setup(); await connect();
  const request = wallet.request.bind(wallet);
  wallet.request = (args) => args.method === "eth_sendTransaction" ? Promise.reject(Object.assign(new Error("Declined"), { code: 4001 })) : request(args);
  await bridgeDeposit(quote);
  expect(Number(await wallet.request({ method: "eth_chainId" }))).toBe(8453);
  wallet.request = request;
  await depositUsdc(10);
  const sends = wallet.calls.map((c, i) => [c, i]).filter(([c]) => c.method === "eth_sendTransaction");
  const [, sendAt] = sends[sends.length - 1];
  const back = wallet.calls.map((c, i) => [c, i]).filter(([c, i]) => i < sendAt && c.method === "wallet_switchEthereumChain");
  expect(back[back.length - 1][0].params[0].chainId).toBe("0x1");
  expect(Number(await wallet.request({ method: "eth_chainId" }))).toBe(1);
});

it("recognises a delivered bridge as credited when Derive keeps a small deposit fee", async () => {
  const { wallet, quote, account } = setup({ newAccount: false }); await connect();
  account.usdc = 3;
  _setSeatState({ ...seatState(), saloon: { ...seatState().saloon, usdc: 3 }, depositAddress: deposit, stage: "fund" });
  await bridgeDeposit(quote);
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ status: "DONE", substatus: "COMPLETED", toAddress: deposit, receiving: { chainId: 1, amount: "9800000", token: { address: NETWORK.usdc, decimals: 6 } } }) }));
  account.usdc = 12.75; await refreshFunding();
  expect(seatState()).toMatchObject({ stage: "approve", bridge: null });
  expect(read(KEYS.bridgeHistory(wallet.address))[0].phase).toBe("credited");
});

it("signs in again when tracking is retried after the first sign-in expired", async () => {
  let fail = true;
  const { wallet, fake, quote } = setup({ register: () => fail ? deriveError(9002) : { bridge_status: "registered" } });
  await connect(); await bridgeDeposit(quote);
  expect(seatState().bridge.registrationError).toBeTruthy();
  const signs = wallet.calls.filter((c) => c.method === "personal_sign").length;
  const later = Date.now() + 5 * 60_000; vi.spyOn(Date, "now").mockReturnValue(later);
  fail = false;
  await retryBridgeRegistration();
  expect(wallet.calls.filter((c) => c.method === "personal_sign").length).toBe(signs + 1);
  expect(fake.calls("private/register_bridge_deposit").at(-1).params.timestamp).toBe(String(later));
  expect(seatState().bridge.registrationError).toBeNull();
});
