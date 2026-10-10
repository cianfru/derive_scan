// Rysk: the listing, the trade's numbers, the signed confirmation and the trade flow, against Rysk's
// public replies saved on 10 October 2026 (src/fixtures/rysk) and fakes for the wallet, socket and fee.
import { describe, expect, it, vi } from "vitest";
import { Interface, getAddress, verifyTypedData } from "ethers";
import assets from "../../fixtures/rysk/assets.json";
import inventory from "../../fixtures/rysk/inventory.json";
import caps from "../../fixtures/rysk/caps.json";
import { capsRoom, nearestDate, nearestLevel, ryskCoins, ryskMarket } from "./market.js";
import { CONFIRMATION_TYPES, collateralUnits, confirmationBody, confirmationTypedData, contracts, echoes, premiumUnits, quoteFits, requestParams, snapSize } from "./order.js";
import { lockAndReceive } from "./trade.js";
import { parseRyskPilot, ryskPilot } from "./config.js";
import { fakeWallet } from "../trade/fakeWallet.js";

const NET = Object.freeze({
  name: "mainnet", real: true, chainId: 999, chainName: "HyperEVM", apiUrl: "https://v12.rysk.finance", rpc: "https://rpc.hyperliquid.xyz/evm",
  metamask: { chainId: "0x3e7", chainName: "HyperEVM", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: ["https://rpc.hyperliquid.xyz/evm"], blockExplorerUrls: ["https://hyperevmscan.io"] },
  rysk: "0x8c8bcb6d2c0e31c5789253ecc8431ca6209b4e35", marginPool: "0x24a44f1dc25540c62c1196FfC297dFC951C91aB4",
  usdc: "0xb88339cb7199b77e23db6e890353e22632ba630f", explorer: "https://hyperevmscan.io",
});
const LISTING = { assets, inventory, caps };
const UETH = "0xbe6727b535545c67d5caa73dea54865b92cf7907";
const MAKER = "0x1111111111111111111111111111111111111111";
const erc20 = new Interface(["function approve(address spender,uint256 amount) returns (bool)"]);

function quoteFor(req, { price = 25n * 10n ** 18n, validFor = 30, now = Math.floor(Date.now() / 1000) } = {}) {
  return {
    assetAddress: req.asset, chainId: req.chainId, expiry: req.expiry, isPut: req.isPut, isTakerBuy: false, maker: MAKER,
    nonce: "17", price: price.toString(), quantity: req.quantity, strike: req.strike, validUntil: now + validFor,
    usd: req.usd, collateralAsset: req.collateralAsset, signature: `0x${"ab".repeat(65)}`, apy: 9.3,
  };
}

describe("Rysk's listing as one coin's market", () => {
  it("locks the coin's own token for calls and USDC for puts, on HyperEVM", () => {
    const eth = ryskMarket("ETH", LISTING, NET);
    expect(eth.token.symbol).toBe("UETH");
    expect(eth.dates.map((d) => d.expiry)).toEqual([...eth.dates.map((d) => d.expiry)].sort((a, b) => a - b));
    const call = eth.dates[0].call[0], put = eth.dates[0].put[0];
    expect(call.collateral.toLowerCase()).toBe(UETH);
    expect(call.usd.toLowerCase()).toBe(NET.usdc);
    expect(put.collateral.toLowerCase()).toBe(NET.usdc);
    expect(put.asset.toLowerCase()).toBe(UETH);
    expect(eth.dates[0].call.map((l) => l.strike)).toEqual([...eth.dates[0].call.map((l) => l.strike)].sort((a, b) => a - b));
    expect(ryskMarket("HYPE", LISTING, NET).token.symbol).toBe("WHYPE");
  });

  it("leaves out coins Rysk does not list here", () => {
    expect(ryskMarket("XRP", LISTING, NET)).toBeNull();
    expect(ryskMarket("DOGE", LISTING, NET)).toBeNull();
    expect(ryskCoins(LISTING, NET)).toEqual(["ETH", "HYPE", "BTC"]);
  });

  it("opens on the date and level nearest the bubble picked", () => {
    const eth = ryskMarket("ETH", LISTING, NET);
    const d = nearestDate(eth, eth.dates[1].expiry + 3600);
    expect(d.expiry).toBe(eth.dates[1].expiry);
    const target = d.call[1].strike + 1;
    expect(nearestLevel(d.call, target).strike).toBe(d.call[1].strike);
  });

  it("reads what Rysk still takes from its caps", () => {
    const eth = ryskMarket("ETH", LISTING, NET);
    const room = capsRoom(caps, eth.dates[0].call[0], "ETH");
    expect(room.notional).toBeGreaterThan(0n);
    expect(room.contracts).toBeGreaterThan(0n);
  });
});

describe("a trade's numbers", () => {
  const eth = ryskMarket("ETH", LISTING, NET);
  it("sizes in whole steps of Rysk's minimum", () => {
    const min = eth.token.min, max = eth.token.max; // 0.5 and 100 UETH
    expect(snapSize(contracts("0.7"), min, max)).toBe(contracts("0.5"));
    expect(snapSize(contracts("1.2"), min, max)).toBe(contracts("1"));
    expect(snapSize(contracts("0.1"), min, max)).toBe(min);
    expect(snapSize(contracts("500"), min, max)).toBe(max);
    expect(contracts("abc")).toBeNull();
  });

  it("locks strike x contracts of USDC for a put and the contracts in the token for a call", () => {
    const put = { ...eth.dates[0].put[0], strikeText: "2000.000000", strike: 2000 };
    expect(collateralUnits(contracts("0.5"), put)).toBe(1_000_000_000n); // $1,000 in 6 decimals
    expect(collateralUnits(contracts("0.5"), eth.dates[0].call[0])).toBe(5n * 10n ** 17n);
    const btc = ryskMarket("BTC", LISTING, NET);
    expect(collateralUnits(contracts("0.025"), btc.dates[0].call[0])).toBe(2_500_000n); // UBTC has 8 decimals
  });

  it("asks for the strike in 8 decimals and pays the premium in 6", () => {
    const hype = ryskMarket("HYPE", LISTING, NET);
    const lvl = { ...hype.dates[0].call[0], strikeText: "100.500000" };
    const req = requestParams(lvl, contracts("25"), null, NET);
    expect(req.strike).toBe("10050000000");
    expect(req.quantity).toBe((25n * 10n ** 18n).toString());
    expect(req.taker).toBe("0x0000000000000000000000000000000000000000");
    expect(premiumUnits({ quantity: (5n * 10n ** 17n).toString(), price: (25n * 10n ** 18n).toString() })).toBe(12_500_000n);
  });

  it("takes only a firm quote for exactly what was asked, still valid", () => {
    const req = requestParams(eth.dates[0].call[0], contracts("0.5"), null, NET);
    const now = 1_800_000_000;
    const q = quoteFor(req, { now });
    expect(quoteFits(q, req, now)).toBe(true);
    expect(quoteFits({ ...q, quantity: "1" }, req, now)).toBe(false);
    expect(quoteFits({ ...q, isTakerBuy: true }, req, now)).toBe(false);
    expect(quoteFits({ ...q, strike: "1" }, req, now)).toBe(false);
    expect(quoteFits({ ...q, validUntil: now + 2 }, req, now)).toBe(false);
    expect(quoteFits({ ...q, price: "0" }, req, now)).toBe(false);
  });
});

describe("the confirmation the wallet signs", () => {
  it("uses Rysk's own types, in Rysk's order, on its domain", () => {
    expect(CONFIRMATION_TYPES.Confirmation.map((f) => `${f.name}:${f.type}`)).toEqual([
      "maker:address", "assetAddress:address", "chainId:uint256", "expiry:uint64", "isPut:bool", "nonce:uint64", "price:uint256",
      "quantity:uint256", "quoteNonce:uint64", "quoteSignature:bytes", "strike:uint256", "taker:address", "isTakerBuy:bool",
      "usd:address", "collateralAsset:address", "collateralAmount:uint256", "gasFee:uint256",
    ]);
    const req = requestParams(ryskMarket("ETH", LISTING, NET).dates[0].call[0], contracts("0.5"), null, NET);
    const body = confirmationBody(quoteFor(req), { taker: MAKER, collateralAmount: 5n * 10n ** 17n, nonce: 1791648000000 });
    const td = confirmationTypedData(body, 30000n, NET);
    expect(td.domain).toEqual({ name: "rysk", version: "0.0.0", chainId: 999, verifyingContract: NET.rysk });
    expect(td.message.gasFee).toBe("30000");
    expect(td.message.isTakerBuy).toBe(false);
    expect(echoes(body, { ...body, gasFee: "30000" })).toBe(true);
    expect(echoes(body, { ...body, price: "1" })).toBe(false);
  });
});

/** Rysk's socket and gas-fee endpoint for the flow; `confirm` answers with a transaction hash. */
function fakes({ gasFee = "40000", confirm = () => `0x${"cd".repeat(32)}`, wallet = {} } = {}) {
  const provider = fakeWallet({ chainId: 1, usdc: 10n ** 30n, ...wallet });
  const sent = [];
  const socket = { call: vi.fn(async (method, params) => { sent.push({ method, params }); return confirm(params); }) };
  const fetchImpl = vi.fn(async (url, init) => ({ ok: true, json: async () => ({ ...JSON.parse(init.body), gasFee }) }));
  return { provider, socket, fetchImpl, sent };
}

describe("locking and receiving the premium", () => {
  const eth = ryskMarket("ETH", LISTING, NET);
  const level = eth.dates[0].call[0];
  const req = requestParams(level, contracts("0.5"), null, NET);

  it("switches to HyperEVM, approves the exact collateral, signs once and sends once", async () => {
    const f = fakes();
    const wallet = getAddress(f.provider.address);
    const steps = [];
    const res = await lockAndReceive({ provider: f.provider, wallet, net: NET, socket: f.socket, level, quote: async () => quoteFor(req), fetchImpl: f.fetchImpl, onStep: (k, s) => steps.push(`${k}:${s.status}`), sleep: async () => {} });
    expect(f.provider.calls.find((c) => c.method === "wallet_switchEthereumChain").params[0].chainId).toBe("0x3e7");
    const approve = f.provider.calls.find((c) => c.method === "eth_sendTransaction").params[0];
    const [spender, amount] = erc20.decodeFunctionData("approve", approve.data);
    expect(spender).toBe(getAddress(NET.marginPool));
    expect(amount).toBe(5n * 10n ** 17n);
    expect(approve.to.toLowerCase()).toBe(UETH);
    expect(f.socket.call).toHaveBeenCalledTimes(1);
    const confirm = f.sent[0];
    expect(confirm.method).toBe("confirm");
    expect(confirm.params.isEIP1271).toBe(false);
    expect(confirm.params.gasFee).toBe("40000");
    const td = confirmationTypedData(confirm.params, confirm.params.gasFee, NET);
    const { EIP712Domain, ...types } = td.types;
    expect(verifyTypedData(td.domain, types, td.message, confirm.params.signature)).toBe(wallet);
    expect(res.premium).toBe(12_500_000n);
    expect(res.received).toBe(12_460_000n);
    expect(Object.keys(res.timings)).toEqual(["network", "check", "approve", "fee", "sign", "send", "settle"]);
    expect(steps).toContain("settle:done");
  });

  it("skips the approval when the allowance already covers it", async () => {
    const f = fakes({ wallet: { allowance: 10n ** 30n } });
    const steps = [];
    await lockAndReceive({ provider: f.provider, wallet: getAddress(f.provider.address), net: NET, socket: f.socket, level, quote: async () => quoteFor(req), fetchImpl: f.fetchImpl, onStep: (k, s) => steps.push(`${k}:${s.status}`), sleep: async () => {} });
    expect(steps).toContain("approve:skipped");
    expect(f.provider.calls.filter((c) => c.method === "eth_sendTransaction")).toHaveLength(0);
  });

  it("sends nothing when trading is closed", async () => {
    const f = fakes();
    await expect(lockAndReceive({ provider: f.provider, wallet: getAddress(f.provider.address), net: NET, socket: f.socket, level, quote: async () => quoteFor(req), allow: async () => "Trading is paused right now.", fetchImpl: f.fetchImpl, sleep: async () => {} }))
      .rejects.toMatchObject({ code: "rysk_closed", message: "Trading is paused right now." });
    expect(f.provider.calls.filter((c) => c.method === "eth_sendTransaction" || c.method === "eth_signTypedData_v4")).toHaveLength(0);
    expect(f.socket.call).not.toHaveBeenCalled();
  });

  it("stops before signing when Rysk's gas fee would eat the premium", async () => {
    const f = fakes({ gasFee: "12500000", wallet: { allowance: 10n ** 30n } });
    await expect(lockAndReceive({ provider: f.provider, wallet: getAddress(f.provider.address), net: NET, socket: f.socket, level, quote: async () => quoteFor(req), fetchImpl: f.fetchImpl, sleep: async () => {} }))
      .rejects.toMatchObject({ code: "rysk_fee_over_premium" });
    expect(f.provider.calls.some((c) => c.method === "eth_signTypedData_v4")).toBe(false);
  });

  it("asks again when the premium fell since it was shown", async () => {
    const f = fakes({ wallet: { allowance: 10n ** 30n } });
    await expect(lockAndReceive({ provider: f.provider, wallet: getAddress(f.provider.address), net: NET, socket: f.socket, level, shownPremium: 14_000_000n, quote: async () => quoteFor(req), fetchImpl: f.fetchImpl, sleep: async () => {} }))
      .rejects.toMatchObject({ code: "rysk_premium_changed" });
    expect(f.socket.call).not.toHaveBeenCalled();
  });

  it("never resends a confirmation whose answer did not come", async () => {
    const f = fakes({ confirm: () => { throw Object.assign(new Error("late"), { code: "rysk_timeout" }); }, wallet: { allowance: 10n ** 30n } });
    await expect(lockAndReceive({ provider: f.provider, wallet: getAddress(f.provider.address), net: NET, socket: f.socket, level, quote: async () => quoteFor(req), fetchImpl: f.fetchImpl, sleep: async () => {} }))
      .rejects.toMatchObject({ code: "rysk_unknown", unknown: true });
    expect(f.socket.call).toHaveBeenCalledTimes(1);
  });

  it("refuses when the fee endpoint does not echo the trade", async () => {
    const f = fakes({ wallet: { allowance: 10n ** 30n } });
    f.fetchImpl.mockImplementation(async (url, init) => ({ ok: true, json: async () => ({ ...JSON.parse(init.body), price: "1", gasFee: "1" }) }));
    await expect(lockAndReceive({ provider: f.provider, wallet: getAddress(f.provider.address), net: NET, socket: f.socket, level, quote: async () => quoteFor(req), fetchImpl: f.fetchImpl, sleep: async () => {} }))
      .rejects.toMatchObject({ code: "rysk_fee" });
  });
});

describe("the real-money pilot", () => {
  it("is nobody when unset, listed wallets, or everyone with all", () => {
    expect(ryskPilot("0xAbC0000000000000000000000000000000000001", parseRyskPilot(""))).toBe(false);
    expect(ryskPilot("0xAbC0000000000000000000000000000000000001", parseRyskPilot("0xabc0000000000000000000000000000000000001"))).toBe(true);
    expect(ryskPilot("0x0000000000000000000000000000000000000002", parseRyskPilot("all"))).toBe(true);
  });
});
