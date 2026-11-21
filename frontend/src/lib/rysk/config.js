// Rysk V12 on HyperEVM: where the browser asks for premiums and confirms trades, chosen at build time
// by VITE_RYSK ("testnet" or "mainnet"; anything else leaves it off) inside a build with the Saloon on.
// Owner, 10 October 2026: "try it first and see where the blockers are". Each build reaches one Rysk
// network only: the comparisons fold at build time, so a testnet build carries no mainnet host.
// Values come from Rysk's own app (app.rysk.finance, read 10 October 2026): the taker socket, the
// signing domain and the contracts the trade page uses. Kept in its own module (not lib/flags.js) so
// tests that mock the flags need not know about it.
const RAW = import.meta.env.VITE_RYSK;
const QUESTIONS = import.meta.env.VITE_QUESTIONS === "1";

/** "testnet", "mainnet" or "off". */
export const RYSK_MODE = QUESTIONS && RAW === "mainnet" ? "mainnet" : QUESTIONS && RAW === "testnet" ? "testnet" : "off";
/** The Receive premium tab trades on Rysk (instead of the illustration). */
export const RYSK_ON = QUESTIONS && (RAW === "mainnet" || RAW === "testnet");

/** HyperEVM in wallet_addEthereumChain's shape (MetaMask docs, "Add a network"). */
const chainParams = (id, name, rpc, explorer) => ({
  chainId: `0x${id.toString(16)}`, chainName: name, nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: [rpc], blockExplorerUrls: [explorer],
});

export const RYSK = QUESTIONS && RAW === "mainnet"
  ? Object.freeze({
    name: "mainnet",
    real: true,
    wsUrl: "wss://v12.rysk.finance/taker",
    apiUrl: "https://v12.rysk.finance",
    chainId: 999,
    chainName: "HyperEVM",
    rpc: "https://rpc.hyperliquid.xyz/evm",
    explorer: "https://hyperevmscan.io",
    metamask: chainParams(999, "HyperEVM", "https://rpc.hyperliquid.xyz/evm", "https://hyperevmscan.io"),
    // The signing domain's contract ("rysk", version 0.0.0) and the pool the collateral is approved to.
    rysk: "0x8c8bcb6d2c0e31c5789253ecc8431ca6209b4e35",
    marginPool: "0x24a44f1dc25540c62c1196FfC297dFC951C91aB4",
    // USDC on HyperEVM: puts are secured with it and every premium is paid in it.
    usdc: "0xb88339cb7199b77e23db6e890353e22632ba630f",
    appUrl: "https://app.rysk.finance/",
  })
  : QUESTIONS && RAW === "testnet"
    ? Object.freeze({
      name: "testnet",
      real: false,
      wsUrl: "wss://rip-testnet.rysk.finance/taker",
      apiUrl: "https://rip-testnet.rysk.finance",
      chainId: 998,
      chainName: "HyperEVM Testnet",
      rpc: "https://rpc.hyperliquid-testnet.xyz/evm",
      explorer: "https://testnet.purrsec.com",
      metamask: chainParams(998, "HyperEVM Testnet", "https://rpc.hyperliquid-testnet.xyz/evm", "https://testnet.purrsec.com"),
      rysk: "0x0122db8Ed9B9B49F3FD8774d93773C2e2A564E81",
      marginPool: "0xB586aBB1b69611284A855BAECE6707bf353C035b",
      usdc: "0x69E37eCb273a23B8864A5f39520Bf97c6768b65C",
      appUrl: "https://testnet.rysk.finance/",
    })
    : null;

// Real money on Rysk: only wallets on this build's list (VITE_RYSK_PILOT, comma-separated; "all" is
// everyone; empty or unset is nobody), and only while the published mainnet switch is on.
const ADDRESS = /^0x[0-9a-f]{40}$/;
export function parseRyskPilot(raw) {
  if (String(raw ?? "").trim().toLowerCase() === "all") return "all";
  return new Set(String(raw ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => ADDRESS.test(s)));
}
export const RYSK_PILOT = /* @__PURE__ */ parseRyskPilot(import.meta.env.VITE_RYSK_PILOT);
export const ryskPilot = (wallet, list = RYSK_PILOT) =>
  list === "all" || (typeof wallet === "string" && list instanceof Set && list.has(wallet.toLowerCase()));
