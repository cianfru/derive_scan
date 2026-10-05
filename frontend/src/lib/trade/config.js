// Saloon stage 2: where the browser trades and the fixed values it uses. Pure data, no network.
// Each build reaches exactly one Derive network, chosen at build time by VITE_SALOON_TRADE:
//   "1" / "dryrun" / "testnet": Derive's V3 testnet (dry run first; P6 real fills on testnet).
//   "mainnet": Derive's V3 mainnet, real money (P8). Fills stay closed until the owner opens them:
//   the published `trading_mainnet` switch (unset means off) and the pilot wallet list.
// The other network's endpoint is not in the build at all: the comparisons below are folded at
// build time, so a testnet build carries no mainnet URL and a mainnet build no testnet URL.
// Values come from Derive's docs (Introduction, Contracts, Action signing, Programmatic onboarding)
// and derive-py 0.1.3 (config/contracts.py); token addresses from public/get_all_currencies.
import { tradeMode } from "../flags.js";
import { mainnetOpen } from "./live.js";

/** The endpoints fills may go to; null for the network this build does not reach. */
export const TESTNET_WS = import.meta.env.VITE_SALOON_TRADE === "mainnet" ? null : "wss://testnet.api.derive.xyz/v3/ws";
export const MAINNET_WS = import.meta.env.VITE_SALOON_TRADE === "mainnet" ? "wss://api.derive.xyz/v3/ws" : null;
export const TESTNET_CHAIN = 11155111;
export const MAINNET_CHAIN = 1;

/** This build's network. */
export const NETWORK = import.meta.env.VITE_SALOON_TRADE === "mainnet"
  ? Object.freeze({
    name: "mainnet",
    enabled: true,
    real: true, // real money: every trade screen says so plainly
    wsUrl: MAINNET_WS,
    chainId: MAINNET_CHAIN, // Ethereum: the mainnet's settlement chain and signing domain
    chainName: "Ethereum",
    addable: false, // every wallet has Ethereum; Cowboy only asks to switch to it
    // The action domain's separator on this chain (Derive docs, Contracts; derive-py CONFIGS).
    domainSeparator: "0xda616dfabb88681b08e1592820a41d55ddc62d68de110e327ae99d734506fe19",
    appUrl: "https://app.derive.xyz/",
    // USDC on Ethereum (public/get_all_currencies: USDC spot erc20.underlying_erc20, 6 decimals).
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    usdcDecimals: 6,
    // Derive's own USDC asset (public/get_all_currencies: USDC spot address). A fallback only: the
    // page reads the collateral list itself.
    usdcAsset: "0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b",
  })
  : Object.freeze({
    name: "testnet",
    enabled: true,
    real: false,
    wsUrl: TESTNET_WS,
    chainId: TESTNET_CHAIN, // Ethereum Sepolia: the testnet's settlement chain and signing domain
    chainName: "Sepolia",
    addable: true,
    domainSeparator: "0x24d674cd5f2b9d564691c51e9d88f649b99246a2244dd74ce27b96578d773e85",
    // For wallet_addEthereumChain when the wallet lacks Sepolia (MetaMask docs, "Add a network").
    // symbol kept to 6 characters or fewer: some MetaMask versions refuse longer ones.
    nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    explorerUrls: ["https://sepolia.etherscan.io"],
    appUrl: "https://testnet.app.derive.xyz/",
    usdc: "0x73Efab09362052D26FB93A730Be4F8a5EdC833af", // testnet USDC (mintable in Derive's testnet app)
    usdcDecimals: 6,
    // Derive's own USDC asset on the testnet (public/get_risk_universes, PRIME collaterals, "USDC"
    // address; its erc20.underlying_erc20 is `usdc` above). Pending deposits name this address.
    // A fallback only: the page reads the collateral list itself.
    usdcAsset: "0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b",
  });

/** The build's networks by name: only its own. */
export const NETWORKS = { [NETWORK.name]: NETWORK };

/** This build's mode: "testnet" or "mainnet" (fills), "dryrun" (nothing fills) or "off". */
export const MODE = tradeMode(import.meta.env?.VITE_SALOON_TRADE, true);
/** Real money in this build. */
export const REAL_MONEY = MODE === "mainnet";

/**
 * The fill guard: fills (private/execute_quote) are allowed only
 *   - in a "testnet" build, on the testnet network, its Sepolia signing domain and its endpoint; or
 *   - in a "mainnet" build, on the mainnet network, its Ethereum signing domain and its endpoint,
 *     and only while `live` is true (the published mainnet switch allows it for a pilot wallet).
 * Anything else is refused. A build carries only its own endpoint, so the other network never matches.
 */
export function fillsAllowed(network, mode, live = false) {
  if (!network || network.enabled !== true) return false;
  if (mode === "testnet") {
    return !!TESTNET_WS && network.name === "testnet" && network.chainId === TESTNET_CHAIN && network.wsUrl === TESTNET_WS;
  }
  if (mode === "mainnet") {
    return live === true && MODE === "mainnet" && !!MAINNET_WS && network.name === "mainnet"
      && network.chainId === MAINNET_CHAIN && network.wsUrl === MAINNET_WS;
  }
  return false;
}

/**
 * The client's last check before private/execute_quote goes on the wire: the testnet's endpoint (in
 * a testnet or dry-run build), or the mainnet's in a mainnet build while the published switch allows
 * this direction for this pilot wallet. Every other endpoint is refused.
 */
export function executeAllowed(url, { wallet = null, direction = null } = {}) {
  if (!url) return false;
  if (TESTNET_WS && url === TESTNET_WS) return true;
  if (MAINNET_WS && url === MAINNET_WS) return MODE === "mainnet" && mainnetOpen(wallet, direction);
  return false;
}

/** Fixed protocol values from Derive's docs (Action signing, Contracts), the same on every network. */
export const PROTOCOL = {
  actionTypehash: "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17",
  domainName: "Matching",
  domainVersion: "1.0",
  verifyingContract: "0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD",
  rfqModule: "0x9371352CCef6f5b36EfDFE90942fFE622Ab77F1D",
  setSessionKeyModule: "0xe330CF64ff6EbF41699aad344Cb21d78db1D2bb6",
};

/** BTC and ETH options sit in Derive's PRIME universe; its Standard manager is 1 (public/get_risk_universes). */
export const PRIME_STANDARD = 1;
/** One tap for every coin on the board (owner, 5 October 2026: "available across the board"; it was BTC and ETH). */
export const TRADE_COINS = "all";
export const SALOON_LABEL = "Cowboy";
export const KEY_LABEL = "Cowboy Saloon";

/** The one scope a Saloon key holds: RFQ trading on option legs (wire string, and its protocol code). */
export const RFQ_OPTION_SCOPE = "trade:rfq:option";
export const RFQ_OPTION_SCOPE_CODE = 10;
export const KEY_DAYS = 7;
/** Derive keeps a key valid for at least 5 minutes; switching off sets an expiry just past that. */
export const SWITCH_OFF_SEC = 330;

/** Ticket timing (design 2.4): wait up to 10 s for a quote, show each quote as firm for 12 s, re-read
 * the best quote every 1.5 s. */
export const QUOTE_WAIT_MS = 10_000;
/** When Derive's order book beats every quote, a ticket asks again by itself, this many requests in all. */
export const BOOK_ASKS = 3;
export const FIRM_MS = 12_000;
export const POLL_MS = 1_500;
/** After a tap with no clear answer (timeout, dropped socket): re-read the RFQ this many times, this
 * far apart, before saying "Checking your fill". Never re-send the execution. */
export const CHECK_TRIES = 6;
export const CHECK_MS = 1_500;

/** RFQ fields Cowboy always sends: no builder fee, fills all or nothing (see the open questions).
 * A fill that still comes back below 100% is recorded as filled, and the rest is cancelled. */
export const EXTRA_FEE = "0";
export const PARTIAL_FILL_STEP = "1";

/** Deposits: Derive's floor is $5; Cowboy refuses under $10 and suggests $50 or more. */
export const DEPOSIT_MIN = 10;
export const DEPOSIT_SUGGESTED = 50;
export const GAS_WARN_SHARE = 0.05;
/** A deposit Derive lists as "confirmed" is past its L1 confirmations and waits only for the
 * sequencer, which applies it within minutes; the row can stay listed after that. Past this age a
 * confirmed row no longer holds back a new deposit. */
export const CONFIRMED_STALE_MS = 30 * 60_000;
/** A deposit sent from this browser holds back another send to the new-account address this long,
 * until Derive lists it. */
export const SENT_HOLD_MS = 30 * 60_000;

/** Cowboy's public referral code from Derive's API Broker programme (empty until it exists). */
export const REFERRAL = import.meta.env?.VITE_DERIVE_REFERRAL || "";
