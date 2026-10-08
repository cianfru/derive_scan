// Saloon stage 2: the user's own browser wallet (EIP-1193, injected). Ordinary wallets only at first.
// Cowboy asks the wallet to sign; it never sees the wallet's key.
import { Interface, getAddress, hexlify, toUtf8Bytes, verifyTypedData } from "ethers";
import { NETWORK } from "./config.js";
import { WalletError, asWalletError, walletCode } from "./derive.js";

const erc20 = new Interface(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const fundingErc20 = /* @__PURE__ */ new Interface(["function allowance(address owner,address spender) view returns (uint256)", "function approve(address spender,uint256 amount) returns (bool)"]);
const hex = (n) => `0x${BigInt(n).toString(16)}`;

/** The injected wallet, if the browser has one. */
export function findProvider(win = globalThis.window) {
  const p = win?.ethereum;
  return p && typeof p.request === "function" ? p : null;
}

/** One request to the wallet. A refusal comes back as a WalletError (source "wallet"), never as Derive's. */
async function ask(provider, args, step) {
  try {
    return await provider.request(args);
  } catch (e) {
    throw asWalletError(e, step);
  }
}

/** The wallet does not know the chain: 4902, or MetaMask's -32603 carrying 4902 inside. */
export const unknownChain = (e) => walletCode(e) === 4902 || e?.data?.originalError?.code === 4902;

/** wallet_addEthereumChain's parameters for the network's settlement chain (MetaMask docs, "Add a network"). */
export const addChainParams = (net = NETWORK) => ({
  chainId: hex(net.chainId), chainName: net.chainName, nativeCurrency: net.nativeCurrency, rpcUrls: net.rpcUrls, blockExplorerUrls: net.explorerUrls,
});

/**
 * Ask for the wallet's address and move it to the build's chain (Sepolia, or Ethereum on mainnet). A
 * wallet without Sepolia is asked once to add it, then to switch again. Contract wallets are refused for now; if the wallet
 * cannot say (eth_getCode fails), it is taken as an ordinary wallet.
 */
export async function connectWallet(provider, { chainId = NETWORK.chainId, net = NETWORK } = {}) {
  const [account] = (await ask(provider, { method: "eth_requestAccounts" }, "request account")) || [];
  if (!account) throw new WalletError(4001, "no account", null, "request account");
  const address = getAddress(account);
  const current = Number(await ask(provider, { method: "eth_chainId" }, "switch network"));
  if (current !== chainId) {
    const sw = () => ask(provider, { method: "wallet_switchEthereumChain", params: [{ chainId: hex(chainId) }] }, "switch network");
    try {
      await sw();
    } catch (e) {
      if (!unknownChain(e) || net.addable === false) throw e; // Ethereum itself is never "added"
      await ask(provider, { method: "wallet_addEthereumChain", params: [addChainParams({ ...net, chainId })] }, "add network");
      await sw();
    }
  }
  let code = null;
  try {
    code = await provider.request({ method: "eth_getCode", params: [address, "latest"] });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    try { console.warn("[Cowboy] check wallet type failed; taken as an ordinary wallet", e); } catch { /* no console */ }
  }
  if (code && code !== "0x") throw new WalletError("contract_wallet", "contract wallet", null, "check wallet type");
  return address;
}

/** EIP-191 personal_sign of the login timestamp. */
export const personalSign = (provider, address, message) =>
  ask(provider, { method: "personal_sign", params: [hexlify(toUtf8Bytes(message)), address] });

/** EIP-712 typed data, checked to come back signed by `address`. */
export async function signTypedData(provider, address, typedData) {
  const signature = await ask(provider, { method: "eth_signTypedData_v4", params: [address, JSON.stringify(typedData)] });
  const { EIP712Domain, ...types } = typedData.types;
  const signer = verifyTypedData(typedData.domain, types, typedData.message, signature);
  if (getAddress(signer) !== getAddress(address)) throw new WalletError("wrong_signer", "signed by another account");
  return signature;
}

/** USDC in base units from dollars (6 decimals), never in floating point beyond the cent. */
export const usdcUnits = (dollars, decimals = NETWORK.usdcDecimals) => BigInt(Math.round(dollars * 100)) * 10n ** BigInt(decimals - 2);

/** The ERC-20 transfer that funds the Saloon account: from the wallet to Derive's deposit address. */
export function usdcTransfer(from, to, dollars, { usdc = NETWORK.usdc } = {}) {
  return { from, to: usdc, data: erc20.encodeFunctionData("transfer", [getAddress(to), usdcUnits(dollars)]) };
}
export const sendTransaction = (provider, tx) => ask(provider, { method: "eth_sendTransaction", params: [tx] });

/** Funding may visit one source chain. Every wallet action rechecks its owner and chain. */
export async function fundingWalletIdentity(provider, wallet, chainId, assertActive = () => {}) {
  assertActive();
  const accounts = await ask(provider, { method: "eth_accounts" }, "check funding wallet");
  assertActive();
  if (!accounts?.[0] || getAddress(accounts[0]) !== getAddress(wallet)) throw Object.assign(new Error("Funding wallet changed"), { code: "funding_account" });
  const chain = Number(await ask(provider, { method: "eth_chainId" }, "check funding network"));
  assertActive();
  if (chain !== chainId) throw Object.assign(new Error("Funding network changed"), { code: "funding_account" });
}

export async function switchFundingChain(provider, wallet, chain, assertActive = () => {}) {
  assertActive();
  const current = Number(await ask(provider, { method: "eth_chainId" }, "switch funding network"));
  assertActive();
  if (current !== chain.id) {
    const request = { method: "wallet_switchEthereumChain", params: [{ chainId: hex(chain.id) }] };
    try { await ask(provider, request, "switch funding network"); }
    catch (e) {
      assertActive();
      if (!unknownChain(e) || !chain.metamask || chain.id === NETWORK.chainId) throw e;
      await ask(provider, { method: "wallet_addEthereumChain", params: [chain.metamask] }, "add funding network");
      assertActive();
      await ask(provider, request, "switch funding network");
    }
  }
  await fundingWalletIdentity(provider, wallet, chain.id, assertActive);
}

export async function fundingAllowance(provider, wallet, token, spender) {
  const raw = await ask(provider, { method: "eth_call", params: [{ to: token, data: fundingErc20.encodeFunctionData("allowance", [wallet, spender]) }, "latest"] }, "check token approval");
  return BigInt(raw);
}
export const fundingApproval = (wallet, token, spender, units) => ({ from: wallet, to: token, data: fundingErc20.encodeFunctionData("approve", [spender, BigInt(units)]) });

/** Reserve source gas before paying for token approval, then repeat with a wallet gas estimate. */
export async function fundingPreflight(provider, wallet, quote, { approval = null, assertActive = () => {} } = {}) {
  const request = quote.request, raw = quote.raw.transactionRequest;
  await fundingWalletIdentity(provider, wallet, request.fromChain, assertActive);
  const [balance, price] = await Promise.all([
    ask(provider, { method: "eth_getBalance", params: [wallet, "latest"] }, "check source gas"),
    ask(provider, { method: "eth_gasPrice" }, "check source gas"),
  ]);
  assertActive();
  const value = BigInt(raw.value || "0"), native = /^0x0{40}$/i.test(request.token.address);
  if (!native) {
    const tokenBalance = await ask(provider, { method: "eth_call", params: [{ to: request.token.address, data: erc20.encodeFunctionData("balanceOf", [wallet]) }, "latest"] }, "check source token balance");
    assertActive();
    if (BigInt(tokenBalance) < BigInt(request.fromAmount)) throw Object.assign(new Error("The selected token balance changed before sending."), { code: "funding_amount" });
  }
  const transfer = { from: wallet, to: raw.to, data: raw.data, value: hex(value) };
  let sendGas;
  try { sendGas = BigInt(await ask(provider, { method: "eth_estimateGas", params: [transfer] }, "check source gas")); }
  catch (e) {
    assertActive();
    if ([4001, 4100, 4900, 4901].includes(e?.code)) throw e;
    if (!approval) throw e;
    // An unapproved ERC20 transfer may not simulate yet. Use the provider's quoted gas limit for
    // this pre-approval reserve; the real wallet simulation is mandatory after the approval lands.
    const quoted = raw.gasLimit ?? quote.raw.estimate.gasCosts?.find((g) => g.estimate)?.estimate;
    if (!quoted) throw Object.assign(new Error("Source gas could not be checked before token approval."), { code: "funding_gas" });
    sendGas = BigInt(quoted);
  }
  assertActive();
  const approvalGas = approval ? BigInt(await ask(provider, { method: "eth_estimateGas", params: [approval] }, "check approval gas")) : 0n;
  assertActive();
  if (sendGas <= 0n || BigInt(price) <= 0n) throw Object.assign(new Error("Source gas could not be verified."), { code: "funding_gas" });
  const reserve = (sendGas + approvalGas) * BigInt(price) * 150n / 100n;
  if (BigInt(balance) < value + reserve) throw Object.assign(new Error("The source wallet needs native tokens for both the approval and transfer gas, with a margin."), { code: "funding_gas" });
}

/** Wait only for an approval already sent; never resends a transaction. */
export async function fundingReceipt(provider, hash, { assertActive = () => {}, tries = 60, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let i = 0; i < tries; i++) {
    assertActive();
    const receipt = await ask(provider, { method: "eth_getTransactionReceipt", params: [hash] }, "confirm token approval");
    assertActive();
    if (receipt) {
      if (Number(receipt.status) !== 1) throw Object.assign(new Error("Token approval failed"), { code: "funding_route" });
      return receipt;
    }
    await sleep(1000);
  }
  throw Object.assign(new Error("Token approval is still pending. Check the wallet before trying again."), { code: "funding_route" });
}

/** The wallet's USDC on the settlement chain, in dollars. */
export async function usdcBalance(provider, address, { usdc = NETWORK.usdc, decimals = NETWORK.usdcDecimals } = {}) {
  const out = await ask(provider, { method: "eth_call", params: [{ to: usdc, data: erc20.encodeFunctionData("balanceOf", [address]) }, "latest"] });
  return Number(BigInt(out)) / 10 ** decimals;
}

/** The wallet's own gas estimate for a transaction, in ETH. */
export async function gasEth(provider, tx) {
  const [gas, price] = await Promise.all([
    ask(provider, { method: "eth_estimateGas", params: [tx] }),
    ask(provider, { method: "eth_gasPrice" }),
  ]);
  return Number(BigInt(gas) * BigInt(price)) / 1e18;
}
