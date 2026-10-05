// A stand-in for a browser wallet (EIP-1193), for tests and local previews only. It signs with a
// throwaway key made from a public test phrase; it is never funded and never registered anywhere.
import { Wallet, getBytes, keccak256, toUtf8Bytes } from "ethers";

export function fakeWallet({ phrase = "cowboy test owner", chainId = 11155111, code = "0x", reject = new Set(), gas = 52000, gasPrice = 2e9, usdc = 250e6, exposed = true } = {}) {
  const w = new Wallet(keccak256(toUtf8Bytes(phrase)));
  const calls = [];
  let chain = chainId;
  const handlers = { accountsChanged: new Set(), chainChanged: new Set() };
  const provider = {
    address: w.address,
    calls,
    on(event, fn) { handlers[event]?.add(fn); },
    removeListener(event, fn) { handlers[event]?.delete(fn); },
    /** Tests: the wallet's own event (a switch made in the wallet). */
    emit(event, data) { if (event === "chainChanged") chain = Number(data); handlers[event]?.forEach((fn) => fn(data)); },
    listeners: (event) => handlers[event]?.size || 0,
    async request({ method, params }) {
      calls.push({ method, params });
      if (reject.has(method)) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      switch (method) {
        case "eth_requestAccounts": return [w.address.toLowerCase()];
        case "eth_accounts": return exposed ? [w.address.toLowerCase()] : [];
        case "eth_chainId": return `0x${chain.toString(16)}`;
        case "wallet_switchEthereumChain": chain = parseInt(params[0].chainId, 16); return null;
        case "eth_getCode": return code;
        case "personal_sign": return w.signMessage(getBytes(params[0]));
        case "eth_signTypedData_v4": {
          const td = JSON.parse(params[1]);
          const { EIP712Domain, ...types } = td.types;
          return w.signTypedData(td.domain, types, td.message);
        }
        case "eth_estimateGas": return `0x${gas.toString(16)}`;
        case "eth_gasPrice": return `0x${Math.round(gasPrice).toString(16)}`;
        case "eth_call": return `0x${BigInt(usdc).toString(16).padStart(64, "0")}`;
        case "eth_sendTransaction": return `0x${"ab".repeat(32)}`;
        default: throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      }
    },
  };
  return provider;
}
