// Saloon stage 2: the user's own browser wallet (EIP-1193, injected). Ordinary wallets only at first.
// Cowboy asks the wallet to sign; it never sees the wallet's key.
import { Interface, getAddress, hexlify, toUtf8Bytes, verifyTypedData } from "ethers";
import { NETWORK } from "./config.js";
import { WalletError, asWalletError, walletCode } from "./derive.js";

const erc20 = new Interface(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
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
 * Ask for the wallet's address and move it to the testnet's chain. A wallet without the chain is
 * asked once to add it, then to switch again. Contract wallets are refused for now; if the wallet
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
      if (!unknownChain(e)) throw e;
      await ask(provider, { method: "wallet_addEthereumChain", params: [addChainParams({ ...net, chainId })] }, "add network");
      await sw();
    }
  }
  let code = null;
  try {
    code = await provider.request({ method: "eth_getCode", params: [address, "latest"] });
  } catch (e) {
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
