const lease = (state) => ({ trading_mainnet: state, trading_issued_at: Date.now() / 1000, trading_valid_until: Date.now() / 1000 + 900 });
// Real-money one tap (P8): the mainnet build, its constants, its two-layer off switch and the fill
// guard in every combination. Builds are simulated by setting VITE_SALOON_TRADE (and the pilot list)
// before the modules load. Every Derive answer is a frame from a fake socket: nothing touches a network.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import shapes from "../../fixtures/trade/private_shapes.json";
import frames from "../../fixtures/trade/public_frames.json";
import rec from "../../fixtures/trade/testnet_rfq_trades.json";
import { fakeDerive } from "./fakeSocket.js";

const TESTNET_URL = "wss://testnet.api.derive.xyz/v3/ws";
const MAINNET_URL = "wss://api.derive.xyz/v3/ws";
// Derive docs, Contracts / Action signing: DOMAIN_SEPARATOR per network (also derive-py CONFIGS).
const MAINNET_DOMAIN = "0xda616dfabb88681b08e1592820a41d55ddc62d68de110e327ae99d734506fe19";
const TESTNET_DOMAIN = "0x24d674cd5f2b9d564691c51e9d88f649b99246a2244dd74ce27b96578d773e85";
const PILOT = "0x4201C60C3c85e641c9837588429F59CA57e22bE2";
const OTHER = "0x00000000000000000000000000000000000000AA";
const SUB = 86514;
const RFQ = rec.rfq_id;
const LEGS = [
  { instrument_name: "BTC-20261005-90000-C", direction: "buy", amount: "0.01" },
  { instrument_name: "BTC-20261005-92000-C", direction: "sell", amount: "0.01" },
];
const ASSET = frames.frames.find((f) => f.method === "public/get_instrument" && f.frame.result).frame.result.base_asset_address;
const instrument = ({ instrument_name }) => ({ instrument_name, base_asset_address: ASSET, base_asset_sub_id: String(90000 + Number(instrument_name.split("-")[2])) });
function bestQuote({ direction = "buy" } = {}) {
  const b = shapes["private/rfq_get_best_quote"];
  return {
    ...b, direction, estimated_total_cost: "0.95", estimated_fee: "0.65125", suggested_max_fee: "1.2", orderbook_total_cost: "0.95",
    best_quote: { ...b.best_quote, quote_id: "7e6d5c4b-3a29-4817-9605-f4e3d2c1b0a9", rfq_id: RFQ, subaccount_id: 70001, direction: direction === "buy" ? "sell" : "buy",
      legs: [{ ...LEGS[0], price: "121" }, { ...LEGS[1], price: "26" }] },
  };
}
const executed = () => ({
  cancel_reason: "", creation_timestamp: 1790949750400, direction: "buy", extra_fee: "0", fee: "0.65125", fill_pct: "1",
  label: "BTC-20261005-A-90000-92000:yes", legs: [{ ...LEGS[0], price: "121" }, { ...LEGS[1], price: "26" }], liquidity_role: "taker",
  max_fee: "1.2", quote_id: rec.taker[0].quote_id, rfq_filled_pct: "1", rfq_id: RFQ, status: "filled", subaccount_id: SUB,
});
const history = (rows) => ({ subaccount_id: SUB, trades: rows.map((t) => ({ ...t, label: "BTC-20261005-A-90000-92000:yes" })), pagination: { count: rows.length, num_pages: 1 } });

/** Loads the trading modules as a build with these variables would. */
async function build(env) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const config = await import("./config.js");
  const live = await import("./live.js");
  const derive = await import("./derive.js");
  const rfq = await import("./rfq.js");
  const sign = await import("./sign.js");
  const limits = await import("./limits.js");
  const store = await import("./store.js");
  const pilot = await import("../pilot.js");
  return { config, live, derive, rfq, sign, limits, store, pilot };
}
const MAINNET_ENV = { VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "mainnet", VITE_SALOON_PILOT: `${PILOT.toLowerCase()}, not-an-address` };
const TESTNET_ENV = { VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "testnet", VITE_SALOON_PILOT: "" };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.resetModules(); });

describe("mainnet constants (Derive docs and derive-py)", () => {
  it("a mainnet build reaches Derive V3 mainnet only: Ethereum, its domain, its endpoint", async () => {
    const { config, sign } = await build(MAINNET_ENV);
    expect(config.MODE).toBe("mainnet");
    expect(config.MAINNET_WS).toBe(MAINNET_URL);
    expect(config.TESTNET_WS).toBeNull();
    expect(config.NETWORK).toMatchObject({ name: "mainnet", enabled: true, real: true, chainId: 1, chainName: "Ethereum", wsUrl: MAINNET_URL, addable: false,
      appUrl: "https://app.derive.xyz/", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", usdcDecimals: 6, usdcAsset: "0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b" });
    expect(Object.keys(config.NETWORKS)).toEqual(["mainnet"]);
    expect(config.NETWORK.domainSeparator).toBe(MAINNET_DOMAIN);
    expect(sign.domainSeparator(1)).toBe(MAINNET_DOMAIN);
    // Fixed on every network (Action signing): typehash, Matching domain, RFQ and session-key modules.
    expect(config.PROTOCOL).toMatchObject({
      actionTypehash: "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17", domainName: "Matching", domainVersion: "1.0",
      verifyingContract: "0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD", rfqModule: "0x9371352CCef6f5b36EfDFE90942fFE622Ab77F1D",
      setSessionKeyModule: "0xe330CF64ff6EbF41699aad344Cb21d78db1D2bb6",
    });
    expect(keccak256(toUtf8Bytes("Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)"))).toBe(config.PROTOCOL.actionTypehash);
    expect(config.EXTRA_FEE).toBe("0");
  });

  it("a testnet build reaches the testnet only, its domain matching Derive's", async () => {
    const { config, sign } = await build(TESTNET_ENV);
    expect(config.MAINNET_WS).toBeNull();
    expect(config.TESTNET_WS).toBe(TESTNET_URL);
    expect(Object.keys(config.NETWORKS)).toEqual(["testnet"]);
    expect(config.NETWORK.domainSeparator).toBe(TESTNET_DOMAIN);
    expect(sign.domainSeparator(11155111)).toBe(TESTNET_DOMAIN);
  });

  it("keeps mainnet's browser keys apart from the testnet's", async () => {
    const m = await build(MAINNET_ENV);
    expect(m.store.KEYS.key(PILOT)).toBe(`cowboy-saloon-key:mainnet:${PILOT.toLowerCase()}`);
    expect(m.store.KEYS.lastWallet()).toBe("cowboy-saloon-wallet:mainnet");
    expect(m.store.KEYS.lastWallet()).toBe(m.pilot.LAST_MAINNET_WALLET);
    const t = await build(TESTNET_ENV);
    expect(t.store.KEYS.key(PILOT)).toBe(`cowboy-saloon-key:testnet:${PILOT.toLowerCase()}`);
  });
});

describe("the fill guard, every combination", () => {
  const MAINNET_NET = { name: "mainnet", enabled: true, wsUrl: MAINNET_URL, chainId: 1 };
  const TESTNET_NET = { name: "testnet", enabled: true, wsUrl: TESTNET_URL, chainId: 11155111 };

  it("mainnet build: fills only on mainnet, its endpoint and chain, and only while live", async () => {
    const { config } = await build(MAINNET_ENV);
    const N = config.NETWORK;
    expect(config.fillsAllowed(N, "mainnet", true)).toBe(true);
    expect(config.fillsAllowed(N, "mainnet", false)).toBe(false);
    expect(config.fillsAllowed(N, "mainnet")).toBe(false);
    expect(config.fillsAllowed(N, "testnet", true)).toBe(false);
    expect(config.fillsAllowed(N, "dryrun", true)).toBe(false);
    expect(config.fillsAllowed(N, "off", true)).toBe(false);
    expect(config.fillsAllowed(TESTNET_NET, "testnet", true)).toBe(false); // a mainnet build never reaches the testnet
    expect(config.fillsAllowed(TESTNET_NET, "mainnet", true)).toBe(false);
    expect(config.fillsAllowed({ ...N, wsUrl: TESTNET_URL }, "mainnet", true)).toBe(false);
    expect(config.fillsAllowed({ ...N, chainId: 11155111 }, "mainnet", true)).toBe(false);
    expect(config.fillsAllowed({ ...N, enabled: false }, "mainnet", true)).toBe(false);
    expect(config.fillsAllowed(undefined, "mainnet", true)).toBe(false);
  });

  it("testnet build: fills only on the testnet; mainnet never, even live", async () => {
    const { config } = await build(TESTNET_ENV);
    expect(config.fillsAllowed(config.NETWORK, "testnet")).toBe(true);
    expect(config.fillsAllowed(config.NETWORK, "mainnet", true)).toBe(false);
    expect(config.fillsAllowed(MAINNET_NET, "mainnet", true)).toBe(false);
    expect(config.fillsAllowed(MAINNET_NET, "testnet", true)).toBe(false);
    expect(config.fillsAllowed({ ...config.NETWORK, wsUrl: MAINNET_URL }, "testnet")).toBe(false);
    expect(config.fillsAllowed(config.NETWORK, "dryrun")).toBe(false);
  });

  it("client guard: the endpoint, the switch, the direction and the pilot wallet", async () => {
    const { config, live } = await build(MAINNET_ENV);
    expect(config.executeAllowed(TESTNET_URL, { wallet: PILOT, direction: "buy" })).toBe(false);
    live.setMainnetSwitch(lease("off"));
    expect(config.executeAllowed(MAINNET_URL, { wallet: PILOT, direction: "buy" })).toBe(false);
    live.setMainnetSwitch(lease("on"));
    expect(config.executeAllowed(MAINNET_URL, { wallet: PILOT, direction: "buy" })).toBe(true);
    expect(config.executeAllowed(MAINNET_URL, { wallet: PILOT.toLowerCase(), direction: "sell" })).toBe(true);
    expect(config.executeAllowed(MAINNET_URL, { wallet: OTHER, direction: "buy" })).toBe(false);
    expect(config.executeAllowed(MAINNET_URL, { wallet: null, direction: "buy" })).toBe(false);
    expect(config.executeAllowed(MAINNET_URL, { wallet: PILOT, direction: null })).toBe(false);
    live.setMainnetSwitch(lease("sell_only"));
    expect(config.executeAllowed(MAINNET_URL, { wallet: PILOT, direction: "buy" })).toBe(false);
    expect(config.executeAllowed(MAINNET_URL, { wallet: PILOT, direction: "sell" })).toBe(true);
    live.setMainnetSwitch(lease("maybe"));
    expect(config.executeAllowed(MAINNET_URL, { wallet: PILOT, direction: "sell" })).toBe(false);
    const t = await build(TESTNET_ENV);
    t.live.setMainnetSwitch(lease("on"));
    expect(t.config.executeAllowed(MAINNET_URL, { wallet: PILOT, direction: "buy" })).toBe(false);
    expect(t.config.executeAllowed(TESTNET_URL)).toBe(true);
  });

  it("the client never puts execute_quote on the wire unless the switch is on for a signed-in pilot", async () => {
    const { derive, live } = await build(MAINNET_ENV);
    const fake = fakeDerive({ handlers: { "public/login": [1], [derive.EXECUTE]: executed() } });
    const client = derive.createClient({ url: MAINNET_URL, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} });
    live.setMainnetSwitch(lease("on"));
    // Not signed in: no wallet to check, refused.
    await expect(client.call(derive.EXECUTE, { direction: "buy" }, { safe: false })).rejects.toMatchObject({ code: derive.MAINNET_GUARD });
    await client.login(OTHER, async () => "0xsig");
    await expect(client.call(derive.EXECUTE, { direction: "buy" }, { safe: false })).rejects.toMatchObject({ code: derive.MAINNET_GUARD });
    await client.login(PILOT, async () => "0xsig");
    live.setMainnetSwitch(lease("off"));
    await expect(client.call(derive.EXECUTE, { direction: "buy" }, { safe: false })).rejects.toMatchObject({ code: derive.MAINNET_GUARD });
    expect(fake.calls(derive.EXECUTE)).toHaveLength(0);
    live.setMainnetSwitch(lease("on"));
    await expect(client.call(derive.EXECUTE, { direction: "buy" }, { safe: false })).resolves.toMatchObject({ status: "filled" });
    expect(fake.calls(derive.EXECUTE)).toHaveLength(1);
    live.setMainnetSwitch({ ...lease("on"), trading_issued_at: Date.now() / 1000 - 901, trading_valid_until: Date.now() / 1000 - 1 });
    await expect(client.call(derive.EXECUTE, { direction: "buy" }, { safe: false })).rejects.toMatchObject({ code: derive.MAINNET_GUARD });
    expect(fake.calls(derive.EXECUTE)).toHaveLength(1);
    // A mainnet build's client refuses the testnet's endpoint, whatever the switch says.
    const t = derive.createClient({ url: TESTNET_URL, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} });
    await expect(t.call(derive.EXECUTE, { direction: "buy" }, { safe: false })).rejects.toMatchObject({ code: derive.MAINNET_GUARD });
    expect(fake.calls(derive.EXECUTE)).toHaveLength(1);
  });

  it("a testnet build's client refuses the mainnet endpoint", async () => {
    const { derive, live } = await build(TESTNET_ENV);
    live.setMainnetSwitch(lease("on"));
    const fake = fakeDerive({ handlers: { "public/login": [1], [derive.EXECUTE]: executed() } });
    const client = derive.createClient({ url: MAINNET_URL, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} });
    await client.login(PILOT, async () => "0xsig");
    await expect(client.call(derive.EXECUTE, { direction: "buy" }, { safe: false })).rejects.toMatchObject({ code: derive.MAINNET_GUARD });
    expect(fake.calls(derive.EXECUTE)).toHaveLength(0);
  });
});

describe("the mainnet ticket", () => {
  async function ticket(mods, { owner = PILOT, readSwitch = async () => lease("on"), trading = "on", handlers = {} } = {}) {
    const { derive, rfq, sign, config } = mods;
    const fake = fakeDerive({
      recorded: frames.frames,
      handlers: {
        "public/login": [1],
        "public/get_instrument": instrument,
        "private/send_rfq": { ...shapes["private/send_rfq"], rfq_id: RFQ, valid_until: 1790951400000 },
        "private/rfq_get_best_quote": (p) => (p.rfq_id ? bestQuote({ direction: p.direction }) : { ...bestQuote({ direction: p.direction }), best_quote: null }),
        "private/cancel_rfq": "ok",
        [derive.EXECUTE]: executed(),
        "private/get_trade_history": history([...rec.taker, ...rec.maker]),
        ...handlers,
      },
    });
    const client = derive.createClient({ url: config.NETWORK.wsUrl, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} });
    await client.login(owner, async () => "0xsig");
    const fills = [];
    const t = rfq.createTicket({
      client, getInstrument: derive.instrumentCache(client), subaccountId: SUB, owner,
      key: sign.keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key"))), legs: LEGS, direction: "buy",
      limit: 3, payout: 20, feeEstimate: 0.6, label: "BTC-20261005-A-90000-92000:yes", mode: "mainnet", network: config.NETWORK,
      trading: () => trading, readSwitch, onFill: (f) => fills.push(f), sleep: async () => {},
    });
    return { fake, t, fills, derive };
  }
  async function quoted(t) {
    await t.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.state.phase).toBe("quoted");
  }
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1790949740000); });

  it("fills for a pilot wallet once the fresh switch read says on, with the referral and no builder fee", async () => {
    const mods = await build({ ...MAINNET_ENV, VITE_DERIVE_REFERRAL: "COWBOY" });
    const { fake, t, fills, derive } = await ticket(mods);
    await quoted(t);
    expect(fake.calls("private/send_rfq")[0].params).toMatchObject({ extra_fee: "0", referral_code: "COWBOY" });
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(fake.calls(derive.EXECUTE)).toHaveLength(1);
    expect(fake.calls(derive.EXECUTE)[0].params).toMatchObject({ referral_code: "COWBOY", direction: "buy" });
    expect(t.state.phase).toBe("filled");
    expect(fills[0].network).toBe("mainnet");
  });

  it("sends nothing when the switch read right before the fill is off, sell-only for a buy, or unreadable", async () => {
    for (const readSwitch of [async () => lease("off"), async () => lease("sell_only"), async () => ({ ...lease("on"), trading_issued_at: 0, trading_valid_until: 900 }), async () => { throw new Error("offline"); }, async () => "loading"]) {
      const mods = await build(MAINNET_ENV);
      const { fake, t, fills, derive } = await ticket(mods, { readSwitch });
      await quoted(t);
      await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
      expect(t.state.phase).toBe("paused");
      expect(fake.calls(derive.EXECUTE)).toHaveLength(0);
      expect(fills).toHaveLength(0);
    }
  });

  it("never asks Derive for a price for a wallet outside the pilot", async () => {
    const mods = await build(MAINNET_ENV);
    const { fake, t, derive } = await ticket(mods, { owner: OTHER });
    await t.start();
    expect(t.state).toMatchObject({ phase: "paused", message: mods.rfq.PILOT_ONLY });
    expect(fake.calls("private/send_rfq")).toHaveLength(0);
    expect(fake.calls(derive.EXECUTE)).toHaveLength(0);
  });

  it("with an empty pilot list nobody gets one tap", async () => {
    const mods = await build({ ...MAINNET_ENV, VITE_SALOON_PILOT: "" });
    const { fake, t } = await ticket(mods);
    await t.start();
    expect(t.state.phase).toBe("paused");
    expect(fake.calls("private/send_rfq")).toHaveLength(0);
  });

  it("keeps the large-trade warning and the published switch before any request", async () => {
    const mods = await build(MAINNET_ENV);
    expect(mods.limits.capGate(300, PILOT)).toMatchObject({ ok: true, warn: "per_answer" });
    const { fake, t } = await ticket(mods, { trading: "off" });
    await t.start();
    expect(t.state.phase).toBe("paused");
    expect(fake.calls("private/send_rfq")).toHaveLength(0);
  });
});

describe("the published mainnet switch", () => {
  it("reads trading_mainnet only; missing or unknown means off, whatever the testnet's says", async () => {
    const { limits, live } = await build(MAINNET_ENV);
    expect(limits.tradingState(null)).toBe("loading");
    expect(limits.tradingState({ trading: "on" })).toBe("off");
    expect(limits.tradingState({ ...lease("on"), trading: "on" })).toBe("on");
    expect(limits.tradingState({ ...lease("sell_only"), trading: "off" })).toBe("sell_only");
    expect(limits.tradingState({ trading_mainnet: "yes" })).toBe("off");
    expect(live.mainnetSwitchState()).toBe("off"); // closed until the page reads it on
    const t = await build(TESTNET_ENV);
    expect(t.limits.tradingState({ trading_mainnet: "on" })).toBe("on"); // the testnet's own: unset means on
    expect(t.limits.tradingState({ trading: "off", trading_mainnet: "on" })).toBe("off");
  });
});

describe("the pilot list", () => {
  it("parses addresses, ignores the rest, and matches any case", async () => {
    const { pilot } = await build(MAINNET_ENV);
    expect([...pilot.parsePilot(" 0xAbC0000000000000000000000000000000000001,junk;0x0000000000000000000000000000000000000002 ")])
      .toEqual(["0xabc0000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"]);
    expect(pilot.parsePilot("").size).toBe(0);
    expect(pilot.parsePilot(undefined).size).toBe(0);
    expect(pilot.isPilot(PILOT)).toBe(true);
    expect(pilot.isPilot(OTHER)).toBe(false);
    expect(pilot.isPilot(null)).toBe(false);
  });

  it("offers one tap in a mainnet build only to a pilot browser; others get the note", async () => {
    const { pilot } = await build(MAINNET_ENV);
    expect(pilot.oneTapOffered()).toBe(false);
    expect(pilot.oneTapComing()).toBe(true);
    localStorage.setItem(pilot.LAST_MAINNET_WALLET, OTHER);
    expect(pilot.oneTapOffered()).toBe(false);
    localStorage.setItem(pilot.LAST_MAINNET_WALLET, PILOT);
    expect(pilot.oneTapOffered()).toBe(true);
    expect(pilot.oneTapComing()).toBe(false);
    localStorage.clear();
    pilot.notePilotInvite("?pilot");
    expect(pilot.oneTapOffered()).toBe(true);
    pilot.forgetPilotInvite();
    expect(pilot.oneTapOffered()).toBe(false);
    // An empty list: nobody, invitation or not.
    const empty = await build({ ...MAINNET_ENV, VITE_SALOON_PILOT: "" });
    empty.pilot.notePilotInvite("?pilot");
    expect(empty.pilot.oneTapOffered()).toBe(false);
    expect(empty.pilot.oneTapComing()).toBe(true);
  });

  it("other builds: testnet offers one tap to everyone and shows no note; no trading build offers none", async () => {
    const t = await build(TESTNET_ENV);
    expect(t.pilot.oneTapOffered()).toBe(true);
    expect(t.pilot.oneTapComing()).toBe(false);
    const off = await build({ VITE_QUESTIONS: "1", VITE_SALOON_TRADE: "" });
    expect(off.pilot.oneTapOffered()).toBe(false);
    expect(off.pilot.oneTapComing()).toBe(false);
  });
});
