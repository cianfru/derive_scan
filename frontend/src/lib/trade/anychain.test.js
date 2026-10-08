import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import { NETWORK } from "./config.js";
import { FAST_ROUTE_SECONDS, NATIVE_TOKEN, bridgeRegistration, fundingAmount, fundingChains, fundingHoldings, fundingMinimum, fundingQuote, fundingRecovery, fundingStatus, validateFundingQuote } from "./anychain.js";

const wallet = "0x1111111111111111111111111111111111111111", deposit = "0x2222222222222222222222222222222222222222", token = "0x3333333333333333333333333333333333333333";
const request = () => ({ wallet, fromChain: 8453, token: { address: token, decimals: 6 }, fromAmount: "10000000", destination: { chainId: 1, address: deposit, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 } });
const raw = () => ({ tool: "relay", transactionId: "provider-id", action: { fromChainId: 8453, toChainId: 1, fromAddress: wallet, toAddress: deposit,
  fromToken: { chainId: 8453, address: token, decimals: 6 }, toToken: { chainId: 1, address: request().destination.token, decimals: 6, priceUSD: "1" }, fromAmount: "10000000" },
  estimate: { tool: "relay", fromAmount: "10000000", fromAmountUSD: "10", toAmount: "9800000", toAmountMin: "9700000", executionDuration: 4,
    approvalAddress: token, feeCosts: [{ amountUSD: "0.2" }], gasCosts: [{ amountUSD: "0.01", token: { address: NATIVE_TOKEN, chainId: 8453, decimals: 18, priceUSD: "2000" } }] },
  transactionRequest: { from: wallet, to: token, chainId: 8453, data: "0xabcd", value: "0" } });
const minimum = { minDepositUsd: 5, safetyUsd: 0.5 };
const universes = (min = "5") => [{ managers: [{ manager_id: 1, collaterals: [{ name: "USDC", address: NETWORK.usdcAsset, min_deposit_usd: min,
  erc20: { underlying_erc20: NETWORK.usdc, decimals: 6 } }] }] }];
const reply = (value) => ({ ok: true, json: async () => value });
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("reads the live collateral minimum without a fallback", async () => {
  expect(await fundingMinimum({ call: async () => universes("8") })).toMatchObject({ minDepositUsd: 8, safetyUsd: 0.8 });
  await expect(fundingMinimum({ call: async () => universes(null) })).rejects.toMatchObject({ code: "funding_minimum" });
  await expect(fundingMinimum({ call: async () => [] })).rejects.toMatchObject({ code: "funding_minimum" });
});

it("checks guaranteed arrival after fees and slippage, including a raised floor", () => {
  const quote = raw(); quote.estimate.toAmount = "5800000"; quote.estimate.toAmountMin = "5400000";
  expect(() => validateFundingQuote(quote, request(), minimum)).toThrow(/after route fees/);
  quote.estimate.toAmountMin = "5500000";
  expect(validateFundingQuote(quote, request(), minimum).minArrivesUsd).toBe(5.5);
  expect(() => validateFundingQuote(quote, request(), { minDepositUsd: 6, safetyUsd: 0.6 })).toThrow(/after route fees/);
  quote.action.toToken.priceUSD = "1.5"; quote.estimate.toAmountMin = "5400000";
  expect(() => validateFundingQuote(quote, request(), minimum)).toThrow(/after route fees/);
});

it.each(["wallet", "recipient", "chain", "token", "amount", "transaction"])("refuses a mismatched %s", (part) => {
  const q = raw();
  if (part === "wallet") q.action.fromAddress = deposit;
  if (part === "recipient") q.action.toAddress = wallet;
  if (part === "chain") q.action.toToken.chainId = 8453;
  if (part === "token") q.action.toToken.address = token;
  if (part === "amount") q.action.fromAmount = "9000000";
  if (part === "transaction") q.transactionRequest.chainId = 1;
  expect(() => validateFundingQuote(q, request(), minimum)).toThrow(/does not match/);
});

it("refuses unknown or slow delivery instead of quietly selecting a slow bridge", () => {
  const q = raw(); q.estimate.executionDuration = FAST_ROUTE_SECONDS + 1;
  expect(() => validateFundingQuote(q, request(), minimum)).toThrow(/slow route/);
  delete q.estimate.executionDuration;
  expect(() => validateFundingQuote(q, request(), minimum)).toThrow(/delivery estimate/);
});

it("counts net bridge cost plus top-level gas once and refuses unknown costs", () => {
  const q = raw(), m = validateFundingQuote(q, request(), minimum);
  expect(m.costUsd).toBeCloseTo(0.21);
  q.estimate.gasCosts = [];
  expect(() => validateFundingQuote(q, request(), minimum)).toThrow(/complete source-gas/);
  expect(bridgeRegistration(m, `0x${"ab".repeat(32)}`)).toMatchObject({ rail: "lifi", source_chain_id: 8453, source_token: token, deposit_address: deposit,
    expected_amount: "9800000", bridge_token_decimals: 6, provider_transfer_id: "provider-id" });
});

it.each(["PARTIAL", "REFUNDED", undefined])("does not call DONE %s a full USDC delivery", async (substatus) => {
  const q = validateFundingQuote(raw(), request(), minimum);
  const result = await fundingStatus(q, `0x${"ab".repeat(32)}`, { fetchImpl: async () => reply({ status: "DONE", substatus }) });
  expect(result.phase).not.toBe("delivered");
});

it("verifies completed USDC delivery separately from Derive crediting", async () => {
  const q = validateFundingQuote(raw(), request(), minimum);
  const status = { status: "DONE", substatus: "COMPLETED", toAddress: deposit, receiving: { chainId: 1, amount: "9800000", token: { address: request().destination.token, decimals: 6 } } };
  expect((await fundingStatus(q, `0x${"ab".repeat(32)}`, { fetchImpl: async () => reply(status) })).phase).toBe("delivered");
  status.receiving.amount = "1000000";
  expect((await fundingStatus(q, `0x${"ab".repeat(32)}`, { fetchImpl: async () => reply(status) })).phase).toBe("attention");
});

it("requests FASTEST with no Cowboy fee and uses exact token units", async () => {
  const fetchImpl = vi.fn(async (url, options) => {
    if (url.includes("/quote")) return reply(raw());
    const method = JSON.parse(options.body).method;
    return reply({ result: method === "eth_call" ? "0x0" : method === "eth_estimateGas" ? "0xca10" : "0x5b8d80" });
  });
  const quoted = await fundingQuote({ client: { call: async () => universes() }, wallet, depositAddress: deposit,
    chain: { id: 8453, mainnet: true, chainType: "EVM", metamask: { rpcUrls: ["https://base-rpc.publicnode.com"] } }, token: { address: token, chainId: 8453, decimals: 6, balance: "20000000" }, amount: "10", fetchImpl });
  const url = new URL(fetchImpl.mock.calls[0][0]);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ integrator: "cowboy", fee: "0", order: "FASTEST", fromAmount: "10000000", toAddress: deposit });
  expect(quoted.approvalRequired).toBe(true);
  expect(quoted.approvalGasUsd).toBeCloseTo(51728 * 6000000 / 1e18 * 2000);
  expect(quoted.costUsd).toBeCloseTo(0.21 + quoted.approvalGasUsd);
  expect(fundingAmount("0.123456", 6)).toBe("123456");
  expect(fundingAmount(".5", 6)).toBe("500000");
  expect(fundingAmount("1.", 6)).toBe("1000000");
  expect(() => fundingAmount("0.1234567", 6)).toThrow();
});

it("omits already-approved gas and refuses an unknown or reverting approval estimate", async () => {
  const args = { client: { call: async () => universes() }, wallet, depositAddress: deposit,
    chain: { id: 8453, mainnet: true, chainType: "EVM", metamask: { rpcUrls: ["https://base-rpc.publicnode.com"] } }, token: { address: token, chainId: 8453, decimals: 6, balance: "20000000" }, amount: "10" };
  const approved = vi.fn(async (url) => reply(url.includes("/quote") ? raw() : { result: "0x989680" }));
  const q = await fundingQuote({ ...args, fetchImpl: approved });
  expect(q.approvalGasUsd).toBe(0); expect(q.costUsd).toBeCloseTo(0.21);
  expect(approved).toHaveBeenCalledTimes(2);
  const unpriced = raw(); delete unpriced.estimate.gasCosts[0].token.priceUSD;
  const incomplete = async (url, options) => reply(url.includes("/quote") ? unpriced : { result: JSON.parse(options.body).method === "eth_call" ? "0x0" : "0x100" });
  await expect(fundingQuote({ ...args, fetchImpl: incomplete })).rejects.toMatchObject({ code: "funding_route" });
  const reverting = async (url, options) => reply(url.includes("/quote") ? raw() : JSON.parse(options.body).method === "eth_call" ? { result: "0x0" } : { error: { message: "approval needs a zero reset" } });
  await expect(fundingQuote({ ...args, fetchImpl: reverting })).rejects.toThrow(/zero reset/);
});

it("accepts only source-chain proof of a refund to this wallet and selected token", async () => {
  const q = validateFundingQuote(raw(), request(), minimum);
  q.request.chain = { id: 8453, metamask: { rpcUrls: ["https://base-rpc.publicnode.com"] } };
  const status = { status: "DONE", substatus: "REFUNDED", receiving: { txHash: `0x${"ab".repeat(32)}` } };
  const log = { address: token, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${"0".repeat(64)}`, `0x${wallet.slice(2).padStart(64, "0")}`], data: `0x${(9000000).toString(16).padStart(64, "0")}` };
  const fetchImpl = async (_url, options) => reply({ result: JSON.parse(options.body).method === "eth_getTransactionReceipt" ? { status: "0x1", logs: [log] } : "0x989680" });
  expect((await fundingRecovery(q, status, `0x${"ab".repeat(32)}`, { fetchImpl })).safeToRetry).toBe(true);
  log.address = deposit;
  expect((await fundingRecovery(q, status, `0x${"ab".repeat(32)}`, { fetchImpl })).safeToRetry).toBe(false);
  expect((await fundingRecovery(q, { status: "DONE", substatus: "PARTIAL" }, `0x${"ab".repeat(32)}`, { fetchImpl })).safeToRetry).toBe(false);
});

it("lists EVM mainnets and reads catalogue balances without wallet switching", async () => {
  const chain = { id: 8453, name: "Base", chainType: "EVM", mainnet: true, multicallAddress: token,
    metamask: { rpcUrls: ["https://base-rpc.publicnode.com"] }, nativeToken: { address: NATIVE_TOKEN, symbol: "ETH", chainId: 8453, decimals: 18, priceUSD: "2000" } };
  const multicall = new Interface(["function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[])"]);
  const fetchImpl = vi.fn(async (url) => {
    if (url.includes("/chains")) return reply({ chains: [chain, { ...chain, mainnet: false }] });
    if (url.includes("/tokens")) return reply({ tokens: { 8453: [{ address: token, chainId: 8453, decimals: 6, symbol: "USDC", priceUSD: "1" }] } });
    return reply({ result: multicall.encodeFunctionResult("aggregate3", [[[true, `0x${(1000000000000000n).toString(16).padStart(64, "0")}`], [true, `0x${(10000000n).toString(16).padStart(64, "0")}`]]]) });
  });
  const chains = await fundingChains({ fetchImpl });
  expect(chains).toHaveLength(1); expect(chains[0].balanceAvailable).toBe(true);
  const holdings = await fundingHoldings(wallet, chain, { fetchImpl });
  expect(holdings.find((t) => t.symbol === "USDC")).toMatchObject({ balance: "10000000", valueUsd: 10 });
  const failing = async (url) => url.includes("/tokens") ? fetchImpl(url) : reply({ error: { message: "unavailable" } });
  await expect(fundingHoldings(wallet, chain, { fetchImpl: failing })).rejects.toMatchObject({ code: "funding_balances" });
});

it("abandons cancelled catalogue reads", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(fundingChains({ signal: controller.signal, fetchImpl: vi.fn() })).rejects.toMatchObject({ name: "AbortError" });
});
