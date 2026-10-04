// Saloon stage 2: the user's own browser wallet (EIP-1193, injected). Ordinary wallets only at first.
// Cowboy asks the wallet to sign; it never sees the wallet's key.
import { Interface, getAddress, hexlify, toUtf8Bytes, verifyTypedData } from "ethers";
import { NETWORK } from "./config.js";

const erc20 = new Interface(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const hex = (n) => `0x${BigInt(n).toString(16)}`;

/** The injected wallet, if the browser has one. */
export function findProvider(win = globalThis.window) {
  const p = win?.ethereum;
  return p && typeof p.request === "function" ? p : null;
}

/** Ask for the wallet's address and move it to the testnet's chain. Contract wallets are refused for now. */
export async function connectWallet(provider, { chainId = NETWORK.chainId } = {}) {
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  if (!account) throw Object.assign(new Error("no account"), { code: 4001 });
  const address = getAddress(account);
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current !== chainId) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex(chainId) }] });
  const code = await provider.request({ method: "eth_getCode", params: [address, "latest"] });
  if (code && code !== "0x") throw Object.assign(new Error("contract wallet"), { code: "contract_wallet" });
  return address;
}

/** EIP-191 personal_sign of the login timestamp. */
export const personalSign = (provider, address, message) =>
  provider.request({ method: "personal_sign", params: [hexlify(toUtf8Bytes(message)), address] });

/** EIP-712 typed data, checked to come back signed by `address`. */
export async function signTypedData(provider, address, typedData) {
  const signature = await provider.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(typedData)] });
  const { EIP712Domain, ...types } = typedData.types;
  const signer = verifyTypedData(typedData.domain, types, typedData.message, signature);
  if (getAddress(signer) !== getAddress(address)) throw Object.assign(new Error("signed by another account"), { code: "wrong_signer" });
  return signature;
}

/** USDC in base units from dollars (6 decimals), never in floating point beyond the cent. */
export const usdcUnits = (dollars, decimals = NETWORK.usdcDecimals) => BigInt(Math.round(dollars * 100)) * 10n ** BigInt(decimals - 2);

/** The ERC-20 transfer that funds the Saloon account: from the wallet to Derive's deposit address. */
export function usdcTransfer(from, to, dollars, { usdc = NETWORK.usdc } = {}) {
  return { from, to: usdc, data: erc20.encodeFunctionData("transfer", [getAddress(to), usdcUnits(dollars)]) };
}
export const sendTransaction = (provider, tx) => provider.request({ method: "eth_sendTransaction", params: [tx] });

/** The wallet's USDC on the settlement chain, in dollars. */
export async function usdcBalance(provider, address, { usdc = NETWORK.usdc, decimals = NETWORK.usdcDecimals } = {}) {
  const out = await provider.request({ method: "eth_call", params: [{ to: usdc, data: erc20.encodeFunctionData("balanceOf", [address]) }, "latest"] });
  return Number(BigInt(out)) / 10 ** decimals;
}

/** The wallet's own gas estimate for a transaction, in ETH. */
export async function gasEth(provider, tx) {
  const [gas, price] = await Promise.all([
    provider.request({ method: "eth_estimateGas", params: [tx] }),
    provider.request({ method: "eth_gasPrice" }),
  ]);
  return Number(BigInt(gas) * BigInt(price)) / 1e18;
}
