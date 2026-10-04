// Saloon stage 2: where the browser trades and the fixed values it uses. Pure data, no network.
// Stage 2 runs on Derive's V3 testnet only (owner, 4 October 2026: testnet, dry run first). Mainnet
// is listed only as disabled: it has no endpoint here and nothing can select it.

export const NETWORKS = {
  testnet: {
    name: "testnet",
    enabled: true,
    wsUrl: "wss://testnet.api.derive.xyz/v3/ws",
    chainId: 11155111, // Ethereum Sepolia: the testnet's settlement chain and signing domain
    chainName: "Sepolia",
    appUrl: "https://testnet.app.derive.xyz/",
    usdc: "0x73Efab09362052D26FB93A730Be4F8a5EdC833af", // testnet USDC (mintable in Derive's testnet app)
    usdcDecimals: 6,
  },
  // Needs V3 mainnet to be live and the owner's written approval (design section 7, P8).
  mainnet: { name: "mainnet", enabled: false },
};

export const NETWORK = NETWORKS.testnet;

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
export const TRADE_COINS = ["BTC", "ETH"];
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
export const FIRM_MS = 12_000;
export const POLL_MS = 1_500;

/** RFQ fields Cowboy always sends: no builder fee, fills all or nothing (see the open questions). */
export const EXTRA_FEE = "0";
export const PARTIAL_FILL_STEP = "1";

/** Deposits: Derive's floor is $5; Cowboy refuses under $10 and suggests $50 or more. */
export const DEPOSIT_MIN = 10;
export const DEPOSIT_SUGGESTED = 50;
export const GAS_WARN_SHARE = 0.05;

/** Cowboy's public referral code from Derive's API Broker programme (empty until it exists). */
export const REFERRAL = import.meta.env.VITE_DERIVE_REFERRAL || "";
