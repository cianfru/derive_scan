// Public routing reads only. Wallet execution stays in the seat that owns the connected account.
import { Interface, getAddress, parseUnits } from "ethers";
import { NETWORK, PRIME_STANDARD } from "./config.js";

export const FUNDING_API = "https://li.quest/v1";
export const FUNDING_TIMEOUT_MS = 12_000;
export const FUNDING_QUOTE_MS = 60_000;
export const FAST_ROUTE_SECONDS = 120;
export const FUNDING_SAFETY_USD = 0.5;
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
export const FUNDING_RPC_SOURCES = ["https://ethereum-rpc.publicnode.com", "https://base-rpc.publicnode.com", "https://arbitrum-one-rpc.publicnode.com", "https://rpc.hyperliquid.xyz"];
const RPC_BY_CHAIN = { 1: "https://ethereum-rpc.publicnode.com", 8453: "https://base-rpc.publicnode.com", 42161: "https://arbitrum-one-rpc.publicnode.com", 999: "https://rpc.hyperliquid.xyz/evm" };
const multicall = /* @__PURE__ */ new Interface(["function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[])", "function getEthBalance(address addr) view returns (uint256)"]);
const erc20 = /* @__PURE__ */ new Interface(["function balanceOf(address owner) view returns (uint256)", "function allowance(address owner,address spender) view returns (uint256)", "function approve(address spender,uint256 amount) returns (bool)"]);
const address = (v) => { try { return getAddress(v); } catch { return null; } };
const same = (a, b) => !!address(a) && address(a) === address(b);
const amountOf = (v) => typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null;
const dollars = (v) => v != null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export const fundingError = (code, detail = "") => Object.assign(new Error(detail || code), { code, source: "Cowboy" });
const abort = () => Object.assign(new Error("Funding read cancelled"), { name: "AbortError" });

async function json(url, { signal, fetchImpl = globalThis.fetch, ...options } = {}) {
  if (signal?.aborted) throw abort();
  const controller = new AbortController();
  let timer;
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        let body; try { body = await response.json(); } catch { throw fundingError("funding_route", "The provider returned an unreadable response."); }
        if (signal?.aborted) throw abort();
        if (!response.ok) throw fundingError("funding_route", body?.message || `Provider request failed (${response.status}).`);
        return body;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fundingError("funding_route", "The provider did not answer in time.")); }, FUNDING_TIMEOUT_MS); }),
    ]);
  } catch (e) { if (signal?.aborted) throw abort(); if (e?.code) throw e; throw fundingError("funding_route", e?.message || "The provider is unavailable."); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
}
const api = (path, params, options) => json(`${FUNDING_API}/${path}?${new URLSearchParams(params)}`, options);

export function fundingRpc(chain) {
  const approved = RPC_BY_CHAIN[chain?.id];
  return approved && chain?.metamask?.rpcUrls?.includes(approved) ? approved : null;
}

export async function fundingChains(options = {}) {
  const { chains } = await api("chains", { chainTypes: "EVM" }, options);
  if (!Array.isArray(chains)) throw fundingError("funding_route", "The chain catalogue is unavailable.");
  return chains.filter((c) => c.chainType === "EVM" && c.mainnet === true && Number.isSafeInteger(c.id) && c.id > 0)
    .map((c) => ({ ...c, balanceAvailable: !!fundingRpc(c) && !!address(c.multicallAddress) }))
    .sort((a, b) => Number(b.balanceAvailable) - Number(a.balanceAvailable) || a.name.localeCompare(b.name));
}

/** Catalogue tokens and actual balances on one source chain; never prompts or changes the wallet. */
export async function fundingHoldings(wallet, chain, options = {}) {
  if (!address(wallet) || !fundingRpc(chain) || !address(chain?.multicallAddress)) throw fundingError("funding_balances", "Balance reads are not available on this chain yet.");
  const { tokens } = await api("tokens", { chains: String(chain.id) }, options);
  const listed = tokens?.[chain.id];
  if (!Array.isArray(listed)) throw fundingError("funding_balances", "The token catalogue is unavailable.");
  const unique = new Map([chain.nativeToken, ...listed].filter((t) => t && t.verificationStatus !== "flagged" && t.chainId === chain.id && address(t.address) && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36).map((t) => [t.address.toLowerCase(), t]));
  const catalogue = [...unique.values()];
  const majors = new Set(["USDC", "USDT", "DAI", "WETH", "WBTC", "HYPE"]);
  const all = options.expanded ? catalogue : catalogue.filter((t) => same(t.address, NATIVE_TOKEN) || majors.has(t.symbol) || t.tags?.includes("major_asset")).slice(0, 40);
  const holdings = [];
  let unavailable = 0;
  // Large catalogues use bounded multicalls instead of one RPC request per token.
  const startedAt = Date.now();
  const chunks = Array.from({ length: Math.ceil(all.length / 250) }, (_, i) => all.slice(i * 250, (i + 1) * 250));
  const readChunk = async (batch) => {
    const calls = batch.map((t) => ({ target: same(t.address, NATIVE_TOKEN) ? chain.multicallAddress : t.address, allowFailure: true,
      callData: same(t.address, NATIVE_TOKEN) ? multicall.encodeFunctionData("getEthBalance", [wallet]) : erc20.encodeFunctionData("balanceOf", [wallet]) }));
    const result = await json(fundingRpc(chain), { ...options, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: chain.multicallAddress, data: multicall.encodeFunctionData("aggregate3", [calls]) }, "latest"] }) });
    if (result.error || typeof result.result !== "string") throw fundingError("funding_balances", "The chain could not read these balances. Try again.");
    let balances; try { balances = multicall.decodeFunctionResult("aggregate3", result.result)[0]; } catch { throw fundingError("funding_balances", "The chain returned unreadable balances."); }
    batch.forEach((token, i) => {
      const row = balances[i];
      if (!row?.success || !/^0x[0-9a-f]{64}$/i.test(row.returnData)) { unavailable += 1; return; }
      const units = BigInt(row.returnData);
      if (units <= 0n) return;
      const balance = Number(units) / 10 ** token.decimals, price = dollars(token.priceUSD);
      holdings.push({ ...token, balance: units.toString(), formattedBalance: balance.toLocaleString("en-US", { maximumSignificantDigits: 8 }), valueUsd: price == null ? null : balance * price });
    });
  };
  for (let i = 0; i < chunks.length; i += 2) {
    if (Date.now() - startedAt > 30_000) throw fundingError("funding_balances", "The chain did not finish checking token balances in time. Try again.");
    await Promise.all(chunks.slice(i, i + 2).map(readChunk));
  }
  holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  return Object.assign(holdings, { unavailable, checkedAt: Date.now(), chainId: chain.id, wallet: address(wallet), scan: { checked: all.length, total: catalogue.length, complete: all.length === catalogue.length } });
}

/** Runtime minimum has no configured fallback: an unreadable collateral contract stops the route. */
export async function fundingMinimum(client) {
  const universes = await client.call("public/get_risk_universes", {}, { publicOnly: true });
  const collateral = (universes || []).flatMap((u) => u.managers || []).find((m) => m.manager_id === PRIME_STANDARD)?.collaterals?.find((c) => c.name === "USDC" && same(c.erc20?.underlying_erc20, NETWORK.usdc));
  const min = dollars(collateral?.min_deposit_usd);
  if (!(min > 0) || collateral?.erc20?.decimals !== 6) throw fundingError("funding_minimum", "Derive's current USDC deposit minimum could not be verified.");
  return { minDepositUsd: min, safetyUsd: Math.max(FUNDING_SAFETY_USD, min * 0.1), asset: collateral.address };
}

/** Destination adapter seam: later venues supply their own registered recipient and collateral. */
export const deriveFundingDestination = (depositAddress) => ({ venue: "derive", chainId: 1, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, address: depositAddress });

export function fundingAmount(amount, decimals) {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(amount)) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw fundingError("funding_amount", "Enter an amount in the selected token.");
  const normalized = String(amount).replace(/^\./, "0.").replace(/\.$/, "");
  try { const units = parseUnits(normalized, decimals); if (units <= 0n) throw new Error(); return units.toString(); } catch { throw fundingError("funding_amount", "Check the amount and the token's decimal places."); }
}

export function validateFundingQuote(raw, request, minimum, now = Date.now()) {
  const a = raw?.action, e = raw?.estimate, tx = raw?.transactionRequest;
  if (!a || !e || !tx || Number(a.fromChainId) !== request.fromChain || Number(a.toChainId) !== request.destination.chainId
    || !same(a.fromAddress, request.wallet) || !same(a.toAddress, request.destination.address)
    || !same(a.fromToken?.address, request.token.address) || !same(a.toToken?.address, request.destination.token)
    || Number(a.fromToken?.chainId) !== request.fromChain || Number(a.toToken?.chainId) !== request.destination.chainId
    || a.fromToken?.decimals !== request.token.decimals || a.toToken?.decimals !== request.destination.decimals
    || a.fromAmount !== request.fromAmount || amountOf(e.fromAmount) !== amountOf(request.fromAmount)
    || Number(tx.chainId) !== request.fromChain || (tx.from && !same(tx.from, request.wallet)) || !address(tx.to)
    || !/^0x(?:[0-9a-f]{2})+$/i.test(tx.data || "")) throw fundingError("funding_route", "The quote does not match this wallet, token, amount or deposit address.");
  const expected = amountOf(e.toAmount), guaranteed = amountOf(e.toAmountMin), unitUsd = dollars(a.toToken.priceUSD);
  if (tx.value != null && !/^(?:0x[0-9a-f]+|\d+)$/i.test(String(tx.value))) throw fundingError("funding_route", "The source transaction has an invalid native-token value.");
  if (!expected || !guaranteed || expected < guaranteed || !(unitUsd > 0)) throw fundingError("funding_route", "The provider did not give a valid minimum delivered amount.");
  const safeUnitUsd = Math.min(1, unitUsd);
  const arrivesUsd = Number(expected) / 10 ** request.destination.decimals * safeUnitUsd;
  const minArrivesUsd = Number(guaranteed) / 10 ** request.destination.decimals * safeUnitUsd;
  if (!Number.isFinite(arrivesUsd) || !Number.isFinite(minArrivesUsd)) throw fundingError("funding_route", "The delivered amount could not be verified.");
  if (same(request.token.address, NATIVE_TOKEN) && BigInt(tx.value || "0") !== BigInt(request.fromAmount)) throw fundingError("funding_route", "The source transaction value does not match the reviewed amount.");
  if (!same(request.token.address, NATIVE_TOKEN) && BigInt(tx.value || "0") !== 0n) throw fundingError("funding_route", "This route asks for an additional native-token payment. Cowboy cannot verify its complete cost.");
  if (!(minimum?.minDepositUsd > 0) || !(minimum?.safetyUsd > 0)) throw fundingError("funding_minimum");
  if (minArrivesUsd < minimum.minDepositUsd + minimum.safetyUsd) throw fundingError("funding_below_minimum", `At least $${(minimum.minDepositUsd + minimum.safetyUsd).toFixed(2)} must arrive after route fees and slippage. This route guarantees $${minArrivesUsd.toFixed(2)}.`);
  const seconds = dollars(e.executionDuration);
  if (seconds == null || seconds > FAST_ROUTE_SECONDS) throw fundingError("funding_slow", seconds == null ? "The provider did not give a delivery estimate." : `The fastest route currently estimates ${Math.ceil(seconds / 60)} minutes; Cowboy has not selected this slow route.`);
  const sentUsd = dollars(e.fromAmountUSD), gasRows = e.gasCosts;
  const gasUsd = Array.isArray(gasRows) && gasRows.length > 0 && gasRows.every((g) => dollars(g.amountUSD) != null) ? gasRows.reduce((total, g) => total + Number(g.amountUSD), 0) : null;
  const bridgeCostUsd = sentUsd == null ? null : Math.max(0, sentUsd - arrivesUsd);
  if (sentUsd == null || gasUsd == null) throw fundingError("funding_route", "The provider did not give a complete source-gas and route-cost estimate.");
  const quote = { request, raw, arrivesUsd, minArrivesUsd, sentUsd, bridgeCostUsd, gasUsd, costUsd: bridgeCostUsd == null || gasUsd == null ? null : bridgeCostUsd + gasUsd,
    seconds, slow: false, ...minimum, createdAt: now, expiresAt: now + FUNDING_QUOTE_MS };
  return quote;
}

export async function fundingQuote({ client, wallet, depositAddress, chain, token, amount, signal, fetchImpl }) {
  if (!address(wallet) || !address(depositAddress) || chain?.mainnet !== true || chain.chainType !== "EVM" || token?.chainId !== chain.id) throw fundingError("funding_route", "Choose a supported EVM source chain and token.");
  const fromAmount = fundingAmount(amount, token.decimals);
  if (amountOf(token.balance) != null && BigInt(fromAmount) > BigInt(token.balance)) throw fundingError("funding_amount", "This amount is above the wallet's token balance.");
  const request = { wallet: address(wallet), fromChain: chain.id, token: { ...token }, fromAmount, chain, destination: deriveFundingDestination(address(depositAddress)) };
  const minimum = await fundingMinimum(client);
  const raw = await api("quote", { fromChain: String(chain.id), toChain: "1", fromToken: token.address, toToken: request.destination.token,
    fromAddress: request.wallet, toAddress: request.destination.address, fromAmount, order: "FASTEST", integrator: "cowboy", fee: "0", slippage: "0.005", disableMessageSigning: "true" }, { signal, fetchImpl });
  const quote = validateFundingQuote(raw, request, minimum);
  if (same(token.address, NATIVE_TOKEN) || raw.estimate.skipApproval) return { ...quote, approvalRequired: false, approvalGasUsd: 0 };
  const rpc = fundingRpc(chain), spender = address(raw.estimate.approvalAddress);
  if (!rpc || !spender) throw fundingError("funding_route", "The token approval cost cannot be verified on this source chain.");
  const rpcRead = async (method, params) => {
    const result = await json(rpc, { signal, fetchImpl, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (result.error || !/^0x[0-9a-f]+$/i.test(result.result || "")) throw fundingError("funding_route", result.error?.message || "The source chain could not estimate approval gas. Check its native-token balance.");
    return BigInt(result.result);
  };
  const allowance = await rpcRead("eth_call", [{ to: token.address, data: erc20.encodeFunctionData("allowance", [wallet, spender]) }, "latest"]);
  if (allowance >= BigInt(fromAmount)) return { ...quote, approvalRequired: false, approvalGasUsd: 0 };
  const [gas, price] = await Promise.all([
    rpcRead("eth_estimateGas", [{ from: wallet, to: token.address, data: erc20.encodeFunctionData("approve", [spender, BigInt(fromAmount)]) }]),
    rpcRead("eth_gasPrice", []),
  ]);
  const nativePrice = dollars(raw.estimate.gasCosts.find((g) => Number(g.token?.chainId) === chain.id && same(g.token?.address, NATIVE_TOKEN) && g.token?.decimals === 18)?.token?.priceUSD);
  const approvalGasUsd = nativePrice == null ? null : Number(gas * price) / 1e18 * nativePrice;
  if (!(gas > 0n) || !(price > 0n) || !(nativePrice > 0) || !Number.isFinite(approvalGasUsd)) throw fundingError("funding_route", "A complete token-approval gas cost could not be verified.");
  return { ...quote, approvalRequired: true, approvalGasUsd, costUsd: quote.costUsd + approvalGasUsd };
}

export function bridgeRegistration(quote, sourceTxHash) {
  const { raw, request } = quote;
  if (!/^0x[0-9a-f]{64}$/i.test(sourceTxHash || "")) throw fundingError("funding_route", "The wallet did not return a transaction hash.");
  return { wallet: request.wallet, rail: "lifi", source_chain_id: request.fromChain, source_tx_hash: sourceTxHash,
    source_token: request.token.address, deposit_address: request.destination.address, bridge_token: request.destination.token,
    bridge_token_decimals: request.destination.decimals, expected_amount: raw.estimate.toAmount,
    provider_transfer_id: raw.transactionId ?? raw.estimate?.data?.bid?.transactionId ?? null, tool: raw.tool ?? raw.estimate.tool ?? null };
}

export async function fundingStatus(quote, txHash, options = {}) {
  const result = await api("status", { txHash, fromChain: String(quote.request.fromChain), toChain: String(quote.request.destination.chainId), bridge: quote.raw.tool || quote.raw.estimate.tool }, options);
  if (!["NOT_FOUND", "PENDING", "DONE", "FAILED"].includes(result?.status)) throw fundingError("funding_route", "The bridge status is not available yet.");
  const out = { ...result, phase: "on_way", notice: "The bridge is still being checked." };
  if (result.status === "FAILED" || result.substatus === "REFUNDED") return { ...out, phase: "failed", notice: result.substatus === "REFUNDED" ? "The bridge reports a refund. Check the source wallet; this was not a full USDC delivery." : "The bridge could not complete. Check its transaction before sending again." };
  if (result.substatus === "PARTIAL") return { ...out, phase: "attention", notice: "The bridge reports a partial transfer. The quoted USDC delivery has not been confirmed." };
  if (result.status === "DONE") {
    const receiving = result.receiving, amount = amountOf(receiving?.amount), target = quote.request.destination;
    if (result.substatus === "COMPLETED" && same(result.toAddress, target.address) && Number(receiving?.chainId) === target.chainId
      && same(receiving?.token?.address, target.token) && receiving.token.decimals === target.decimals
      && amount != null && amount >= BigInt(quote.raw.estimate.toAmountMin)) return { ...out, phase: "delivered", notice: "The bridge reports USDC delivered. Derive still needs to credit the deposit." };
    return { ...out, phase: "attention", notice: "The bridge finished, but delivery of the quoted USDC amount has not been verified. Check the transaction and Derive deposit status." };
  }
  return out;
}

/** A failed display status alone never releases the pending-deposit hold. Check source-chain proof. */
export async function fundingRecovery(quote, status, txHash, options = {}) {
  const rpc = fundingRpc(quote.request.chain), wallet = quote.request.wallet, token = quote.request.token;
  if (!rpc) return { safeToRetry: false };
  const readRpc = async (method, params) => {
    const body = await json(rpc, { ...options, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (body.error) throw fundingError("funding_route", "The source chain could not verify this transfer.");
    return body.result;
  };
  let proven = false, proof = null;
  if (status?.status === "FAILED") {
    const receipt = await readRpc("eth_getTransactionReceipt", [txHash]);
    proven = !!receipt && Number(receipt.status) === 0;
    if (proven) proof = "source_reverted";
  } else if (status?.status === "DONE" && status.substatus === "REFUNDED") {
    const hash = status.refund?.txHash || status.receiving?.txHash;
    if (/^0x[0-9a-f]{64}$/i.test(hash || "")) {
      const receipt = await readRpc("eth_getTransactionReceipt", [hash]);
      if (receipt && Number(receipt.status) === 1) {
        if (same(token.address, NATIVE_TOKEN)) {
          const transaction = await readRpc("eth_getTransactionByHash", [hash]);
          proven = same(transaction?.to, wallet) && BigInt(transaction.value || "0") > 0n;
        } else {
          const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
          const recipient = `0x${wallet.slice(2).toLowerCase().padStart(64, "0")}`;
          proven = (receipt.logs || []).some((log) => same(log.address, token.address) && log.topics?.[0]?.toLowerCase() === transferTopic
            && log.topics?.[2]?.toLowerCase() === recipient && /^0x[0-9a-f]{64}$/i.test(log.data || "") && BigInt(log.data) > 0n);
        }
        if (proven) proof = "source_refunded";
      }
    }
  }
  if (!proven) return { safeToRetry: false };
  const units = same(token.address, NATIVE_TOKEN) ? await readRpc("eth_getBalance", [wallet, "latest"])
    : await readRpc("eth_call", [{ to: token.address, data: erc20.encodeFunctionData("balanceOf", [wallet]) }, "latest"]);
  if (!/^0x[0-9a-f]+$/i.test(units || "")) throw fundingError("funding_balances", "The refunded balance could not be checked.");
  return { safeToRetry: true, proof, checkedAt: Date.now(), balance: BigInt(units).toString() };
}
