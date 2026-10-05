// The seat with a wallet Derive has never seen: sign-in answers 14000 (account not found), and the
// first deposit, through a deposit address, opens the account. Derive is a fake socket; the replies
// for login are the ones V3 testnet gave a throwaway wallet (4 October 2026).
import { describe, it, expect, beforeEach, vi } from "vitest";
import shapes from "../../fixtures/trade/private_shapes.json";
import { createClient } from "./derive.js";
import { fakeDerive, deriveError } from "./fakeSocket.js";
import { fakeWallet } from "./fakeWallet.js";
import { TESTNET_WS } from "./config.js";
import { KEYS, read, write } from "./store.js";
import { _setSeatDeps, approve, connect, deposit, disconnect, holdSend, pickAccount, refreshFunding, resume, seatState, switchOff } from "./seat.js";
import { keyFromSecret } from "./sign.js";
import { keccak256, toUtf8Bytes } from "ethers";
import { _resetAssets } from "./account.js";

const ADDR = "0x9a3c5be1b0e4d0f7c6d2a8e1f3b4c5d6e7f80912";
const NEW_SUB = 120001, FALLBACK_SUB = 120000;

const newKey = () => keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));

function setup({ reject = new Set() } = {}) {
  const derive = { account: false, pending: [], subs: {} };
  const fake = fakeDerive({
    handlers: {
      "public/login": () => (derive.account ? Object.keys(derive.subs).map(Number) : deriveError(14000, "Account not found")),
      "public/register_deposit_address": ({ wallet }) => ({ wallet, deposit_address: ADDR }),
      "public/get_pending_deposits": ({ wallet }) => ({ wallet, pending_deposits: derive.pending }),
      "private/get_subaccounts": ({ wallet }) => ({ wallet, subaccount_ids: Object.keys(derive.subs).map(Number) }),
      "private/get_subaccount": ({ subaccount_id }) => derive.subs[subaccount_id],
      "private/change_subaccount_label": ({ subaccount_id, label }) => { derive.subs[subaccount_id].label = label; return { subaccount_id, label }; },
      "private/set_session_key": (p) => ({ public_session_key: p.public_session_key, protocol_scopes: p.protocol_scopes, offchain_scopes: p.offchain_scopes,
        subaccount_ids: p.subaccount_ids, expiry_sec: p.expiry_sec, label: p.label, ip_whitelist: [] }),
    },
  });
  const wallet = fakeWallet({ reject });
  _setSeatDeps({ findProvider: () => wallet, newKey, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) });
  return { fake, wallet, derive };
}

const sub = (id, manager, usdc, label = "") => {
  const s = structuredClone(shapes["private/get_subaccount"][90212]);
  return { ...s, subaccount_id: id, manager_id: manager, label, collaterals: usdc ? s.collaterals.map((c) => ({ ...c, amount: String(usdc) })) : [] };
};

beforeEach(() => { localStorage.clear(); _resetAssets(); localStorage.setItem(KEYS.terms(), JSON.stringify({ at: 1 })); });

const USDC_ASSET = "0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b";
const row = (status, extra = {}) => ({ action_id: 563, action_type: "DepositToNewSubaccount", asset: USDC_ASSET, amount: "10000000", subaccount_id: 0,
  manager_id: 1, tx_hash: `0x${"b7".repeat(32)}`, status, deposit_type: "standard", timestamp: Date.now() - 60_000, updated_at_ms: Date.now() - 30_000, ...extra });
const sends = (wallet) => wallet.calls.filter((c) => c.method === "eth_sendTransaction").length;

describe("a wallet with no Derive account", () => {
  it("goes to funding with a deposit address from public calls, then finds the account the deposit opened", async () => {
    const { fake, wallet, derive } = setup();
    await connect();
    let s = seatState();
    expect(s.message).toBeNull();
    expect(s).toMatchObject({ stage: "fund", saloon: null, depositAddress: ADDR, arriving: 0, newAccount: true, busy: false });
    // A new subaccount under PRIME Standard, and nothing private was asked.
    expect(fake.calls("public/register_deposit_address")[0].params).toEqual({ wallet: wallet.address, subaccount_id: 0, manager_id: 1 });
    expect(fake.log.filter((m) => m.method.startsWith("private/"))).toHaveLength(0);

    // The deposit is on its way: public pending deposits show it, without a wallet prompt.
    derive.pending = [{ ...shapes["public/get_pending_deposits"].pending_deposits[0], amount: "50000000", status: "pending" }];
    const signs = () => wallet.calls.filter((c) => c.method === "personal_sign").length;
    const before = signs();
    await refreshFunding();
    s = seatState();
    expect(s).toMatchObject({ stage: "fund", arriving: 50, saloon: null, message: null });
    expect(signs()).toBe(before);

    // Nothing pending, still no account: a sign-in that answers 14000 is not an error.
    derive.pending = [];
    await refreshFunding();
    expect(seatState()).toMatchObject({ stage: "fund", message: null, newAccount: true });

    // Applied: Derive opened the funded subaccount and a fallback one (manager 0).
    derive.account = true;
    derive.subs = { [FALLBACK_SUB]: sub(FALLBACK_SUB, 0, 0), [NEW_SUB]: sub(NEW_SUB, 1, 50) };
    await refreshFunding();
    s = seatState();
    expect(s).toMatchObject({ stage: "approve", newAccount: false, loggedAs: "owner", message: null });
    expect(s.saloon).toMatchObject({ id: NEW_SUB, label: "", usdc: 50 });
    expect(fake.calls("private/change_subaccount_label")).toHaveLength(0); // labelled only after approval
    await approve();
    expect(seatState()).toMatchObject({ stage: "ready", saloon: { id: NEW_SUB, label: "Cowboy" } });
    expect(fake.calls("private/change_subaccount_label").map((m) => m.params)).toEqual([{ subaccount_id: NEW_SUB, label: "Cowboy" }]);
  });

  it("moves to the Saloon account's own deposit address once it exists unfunded", async () => {
    const { fake, derive } = setup();
    await connect();
    derive.account = true;
    derive.subs = { [NEW_SUB]: sub(NEW_SUB, 1, 0) };
    await refreshFunding();
    expect(seatState()).toMatchObject({ stage: "fund", saloon: { id: NEW_SUB } });
    expect(fake.calls("public/register_deposit_address").at(-1).params).toEqual({ wallet: seatState().wallet, subaccount_id: NEW_SUB });
  });

  it("keeps other sign-in failures as errors, with the step in the details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeDerive({ handlers: { "public/login": deriveError(14014, "invalid_signature") } });
    _setSeatDeps({ findProvider: () => fakeWallet(), createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) });
    await connect();
    const s = seatState();
    expect(s.stage).not.toBe("fund");
    expect(s.message).toMatch(/sign-in signature didn't check out/);
    expect(s.detail).toMatchObject({ step: "sign in", source: "Derive", code: 14014, message: "invalid_signature" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("one deposit opens one account", () => {
  it("does not offer a second send to the new-account address while one is on its way", async () => {
    const { wallet, derive } = setup();
    derive.pending = [row("pending")];
    await connect();
    expect(seatState()).toMatchObject({ stage: "fund", arriving: 10, opening: 1 });
    expect(holdSend(seatState())).toBe(true);
    await deposit(10);
    expect(sends(wallet)).toBe(0);
  });

  it("holds back a second send right after one from this browser, before Derive lists it", async () => {
    const { wallet } = setup();
    await connect();
    expect(holdSend(seatState())).toBe(false);
    await deposit(10);
    expect(sends(wallet)).toBe(1);
    expect(holdSend(seatState())).toBe(true);
    await deposit(10);
    expect(sends(wallet)).toBe(1);
    // a reload remembers it
    await connect();
    expect(seatState()).toMatchObject({ stage: "fund", sentAmount: 10 });
    expect(holdSend(seatState())).toBe(true);
  });

  it("moves a confirmed deposit on to sign-in, and finds the account it opened", async () => {
    const { fake, derive } = setup();
    await connect();
    // Confirmed but not yet applied: Derive still answers 14000, and it still counts as arriving.
    derive.pending = [row("confirmed")];
    await refreshFunding();
    expect(fake.calls("public/login").length).toBeGreaterThan(1);
    expect(seatState()).toMatchObject({ stage: "fund", arriving: 10, opening: 1, message: null });
    // Applied (the row stays listed as confirmed): sign-in finds and labels the account.
    derive.account = true;
    derive.subs = { [FALLBACK_SUB]: sub(FALLBACK_SUB, 0, 0), [NEW_SUB]: sub(NEW_SUB, 1, 10) };
    await refreshFunding();
    const s = seatState();
    expect(s).toMatchObject({ stage: "approve", saloon: { id: NEW_SUB, usdc: 10 } });
    expect(holdSend(s)).toBe(false);
  });

  it("after two deposits opened two accounts, proposes the lowest funded one and notes the other", async () => {
    const { fake, derive } = setup();
    await connect();
    derive.pending = [row("confirmed"), row("confirmed", { action_id: 562 })];
    derive.account = true;
    derive.subs = { [FALLBACK_SUB]: sub(FALLBACK_SUB, 0, 0), [NEW_SUB]: sub(NEW_SUB, 1, 10), [NEW_SUB + 2]: sub(NEW_SUB + 2, 1, 10) };
    await refreshFunding();
    const s = seatState();
    expect(s).toMatchObject({ stage: "approve", saloon: { id: NEW_SUB }, others: { count: 1, usdc: 10 } });
    expect(s.choices.map((c) => c.id)).toEqual([NEW_SUB, NEW_SUB + 2]);
    expect(fake.calls("private/change_subaccount_label")).toHaveLength(0);
  });
});

describe("a wallet already funded on Derive (from Derive's faucet)", () => {
  const prompts = (wallet, method) => wallet.calls.filter((c) => c.method === method).length;
  const FAUCET = 130001, OTHER = 130002;
  const labels = (fake) => fake.calls("private/change_subaccount_label").map((m) => m.params);

  it("proposes the one funded account, asks for no deposit, and labels it only after the approval", async () => {
    const { fake, wallet, derive } = setup();
    derive.account = true;
    derive.subs = { [FALLBACK_SUB]: sub(FALLBACK_SUB, 0, 0), [FAUCET]: sub(FAUCET, 1, 1000) };
    await connect();
    let s = seatState();
    expect(s).toMatchObject({ stage: "approve", saloon: { id: FAUCET, usdc: 1000, label: "" }, others: null, message: null });
    expect(fake.calls("public/register_deposit_address")).toHaveLength(0);
    expect(labels(fake)).toHaveLength(0);
    expect(prompts(wallet, "personal_sign")).toBe(1);
    await approve();
    s = seatState();
    expect(s).toMatchObject({ stage: "ready", saloon: { id: FAUCET, label: "Cowboy" }, loggedAs: "key", message: null });
    // One signature for the grant, no second sign-in; the label follows Derive's acceptance.
    expect(prompts(wallet, "eth_signTypedData_v4")).toBe(1);
    expect(prompts(wallet, "personal_sign")).toBe(1);
    const order = fake.log.map((m) => m.method);
    expect(order.indexOf("private/set_session_key")).toBeLessThan(order.indexOf("private/change_subaccount_label"));
    expect(fake.calls("private/set_session_key")[0].params.subaccount_ids).toEqual([FAUCET]);
    expect(labels(fake)).toEqual([{ subaccount_id: FAUCET, label: "Cowboy" }]);
    expect(read(KEYS.key(wallet.address))).toMatchObject({ subaccount_id: FAUCET });
  });

  it("proposes the larger of two funded accounts, and the user can pick the other without a wallet prompt", async () => {
    const { fake, wallet, derive } = setup();
    derive.account = true;
    derive.subs = { [FAUCET]: sub(FAUCET, 1, 40), [OTHER]: sub(OTHER, 1, 900) };
    await connect();
    expect(seatState()).toMatchObject({ stage: "approve", saloon: { id: OTHER, usdc: 900 }, others: { count: 1, usdc: 40, ids: [FAUCET] } });
    expect(seatState().choices.map((c) => [c.id, c.usdc])).toEqual([[OTHER, 900], [FAUCET, 40]]);
    const before = wallet.calls.length;
    pickAccount(FAUCET);
    expect(wallet.calls.length).toBe(before);
    expect(seatState()).toMatchObject({ stage: "approve", saloon: { id: FAUCET, usdc: 40 }, others: { count: 1, usdc: 900, ids: [OTHER] } });
    await approve();
    expect(fake.calls("private/set_session_key")[0].params.subaccount_ids).toEqual([FAUCET]);
    expect(labels(fake)).toEqual([{ subaccount_id: FAUCET, label: "Cowboy" }]);
    expect(derive.subs[OTHER].label).toBe("");
    // Switch off retires the key for the chosen account.
    await switchOff();
    expect(fake.calls("private/set_session_key")[1].params.subaccount_ids).toEqual([FAUCET]);
    expect(seatState()).toMatchObject({ stage: "approve", key: null });
  });

  it("uses an account already labelled Cowboy, even beside a larger one, and labels nothing", async () => {
    const { fake, derive } = setup();
    derive.account = true;
    derive.subs = { [FAUCET]: sub(FAUCET, 1, 900), [OTHER]: sub(OTHER, 1, 25, "Cowboy") };
    await connect();
    expect(seatState()).toMatchObject({ stage: "approve", saloon: { id: OTHER, label: "Cowboy" }, others: { count: 1, usdc: 900 } });
    await approve();
    expect(seatState()).toMatchObject({ stage: "ready", saloon: { id: OTHER } });
    expect(labels(fake)).toHaveLength(0);
  });

  it("leaves the account unlabelled when the wallet declines the approval", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, wallet, derive } = setup({ reject: new Set(["eth_signTypedData_v4"]) });
    derive.account = true;
    derive.subs = { [FAUCET]: sub(FAUCET, 1, 1000) };
    await connect();
    await approve();
    warn.mockRestore();
    expect(seatState()).toMatchObject({ stage: "approve", saloon: { id: FAUCET, label: "" }, busy: false });
    expect(seatState().message).toBeTruthy();
    expect(seatState().key).toBeFalsy();
    expect(fake.calls("private/set_session_key")).toHaveLength(0);
    expect(labels(fake)).toHaveLength(0);
    expect(derive.subs[FAUCET].label).toBe("");
    expect(read(KEYS.key(wallet.address))).toBeNull();
    expect(read(KEYS.account(wallet.address))).toBeNull();
  });

  it("with nothing funded, sends the deposit to the existing empty account", async () => {
    const { fake, wallet, derive } = setup();
    derive.account = true;
    derive.subs = { [FALLBACK_SUB]: sub(FALLBACK_SUB, 0, 0), [OTHER]: sub(OTHER, 1, 0), [FAUCET]: sub(FAUCET, 1, 0) };
    await connect();
    expect(seatState()).toMatchObject({ stage: "fund", saloon: { id: FAUCET }, depositAddress: ADDR });
    expect(fake.calls("public/register_deposit_address").at(-1).params).toEqual({ wallet: wallet.address, subaccount_id: FAUCET });
    expect(holdSend(seatState())).toBe(false);
    // Funded on Derive meanwhile: Check again moves on to the approval for it.
    derive.subs[FAUCET] = sub(FAUCET, 1, 75);
    await refreshFunding();
    expect(seatState()).toMatchObject({ stage: "approve", saloon: { id: FAUCET, usdc: 75 } });
    expect(labels(fake)).toHaveLength(0);
  });

  it("with no PRIME Standard account at all, the deposit opens a new one", async () => {
    const { fake, wallet, derive } = setup();
    derive.account = true;
    derive.subs = { [FALLBACK_SUB]: sub(FALLBACK_SUB, 0, 0) };
    await connect();
    expect(seatState()).toMatchObject({ stage: "fund", saloon: null, depositAddress: ADDR });
    expect(fake.calls("public/register_deposit_address").at(-1).params).toEqual({ wallet: wallet.address, subaccount_id: 0, manager_id: 1 });
  });

  it("on reload, resumes on the approved account and still offers the other", async () => {
    const { fake, wallet, derive } = setup();
    derive.account = true;
    derive.subs = { [FAUCET]: sub(FAUCET, 1, 40), [OTHER]: sub(OTHER, 1, 900) };
    await connect();
    pickAccount(FAUCET);
    await approve();
    _setSeatDeps({ findProvider: () => wallet, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) });
    wallet.calls.length = 0;
    expect(await resume()).toBe(true);
    expect(wallet.calls.map((c) => c.method)).toEqual(["eth_accounts", "eth_chainId"]);
    expect(seatState()).toMatchObject({ stage: "ready", saloon: { id: FAUCET }, loggedAs: "key" });
    expect(seatState().choices.map((c) => c.id)).toEqual([OTHER, FAUCET]);
  });
});

describe("wallet errors are the wallet's", () => {
  const provider = (fail) => {
    const w = fakeWallet({ chainId: 1 });
    return { ...w, async request(a) { const out = fail(a); if (out) throw out; return w.request(a); } };
  };
  const run = async (p) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    _setSeatDeps({ findProvider: () => p, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fakeDerive().WebSocketImpl }) });
    await connect();
    warn.mockRestore();
    return seatState();
  };

  it("names the step and never blames Derive", async () => {
    let s = await run(provider((a) => a.method === "eth_requestAccounts" && Object.assign(new Error("Unauthorized"), { code: 4100 })));
    expect(s.message).toBe("Your wallet hasn't given this site access yet. Unlock it and try again.");
    expect(s.detail).toMatchObject({ step: "request account", source: "wallet", code: 4100 });
    s = await run(provider((a) => a.method === "eth_requestAccounts" && Object.assign(new Error("pending"), { code: -32002 })));
    expect(s.message).toBe("Your wallet already has a request waiting. Open your wallet to finish or close it.");
    s = await run(provider((a) => a.method === "wallet_switchEthereumChain" && Object.assign(new Error("Internal"), { code: -32603 })));
    expect(s.message).toBe("Your wallet stopped the request. Try again.");
    expect(s.detail).toMatchObject({ step: "switch network", source: "wallet", code: -32603 });
    expect(s.message).not.toMatch(/Derive/);
  });
});

describe("a reload keeps the wallet", () => {
  const prompts = (wallet) => wallet.calls.filter((c) => ["personal_sign", "eth_requestAccounts", "eth_signTypedData_v4", "wallet_switchEthereumChain"].includes(c.method));
  const withKey = (wallet) => {
    const k = keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));
    write(KEYS.key(wallet.address), { address: k.address, secret: k.privateKey, wallet: wallet.address, subaccount_id: NEW_SUB,
      expiry_sec: Math.floor(Date.now() / 1000) + 86400, network: "testnet" });
  };
  /** A fresh page: the same browser storage, a new seat. */
  const reload = (wallet, fake) => _setSeatDeps({ findProvider: () => wallet, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) });
  const funded = (derive) => { derive.account = true; derive.subs = { [NEW_SUB]: sub(NEW_SUB, 1, 50, "Cowboy") }; };

  it("uses the stored key name", () => {
    expect(KEYS.lastWallet()).toBe("cowboy-saloon-wallet:testnet"); // Shell.jsx reads it without the trade chunk
  });

  it("remembers the wallet on connect and resumes it on reload with no wallet prompt", async () => {
    const { fake, wallet, derive } = setup();
    funded(derive);
    await connect();
    expect(read(KEYS.lastWallet())).toBe(wallet.address);
    withKey(wallet);
    reload(wallet, fake);
    expect(seatState()).toMatchObject({ resuming: true, stage: "disconnected" });
    wallet.calls.length = 0;
    expect(await resume()).toBe(true);
    expect(prompts(wallet)).toHaveLength(0);
    expect(wallet.calls.map((c) => c.method)).toEqual(["eth_accounts", "eth_chainId"]);
    expect(seatState()).toMatchObject({ stage: "ready", wallet: wallet.address, loggedAs: "key", resuming: false, busy: false });
    expect(seatState().saloon).toMatchObject({ id: NEW_SUB, usdc: 50 });
    expect(await resume()).toBe(false); // once per page
  });

  it("does not resume without a key, and asks the wallet for nothing", async () => {
    const { fake, wallet, derive } = setup();
    funded(derive);
    write(KEYS.lastWallet(), wallet.address);
    reload(wallet, fake);
    expect(await resume()).toBe(false);
    expect(prompts(wallet)).toHaveLength(0);
    expect(fake.log).toHaveLength(0);
    expect(seatState()).toMatchObject({ stage: "disconnected", resuming: false, busy: false, remembered: wallet.address });
    expect(seatState().wallet).toBeUndefined();
  });

  it("does not resume on the wrong chain, nor when the wallet does not expose the account", async () => {
    const { fake, derive } = setup();
    funded(derive);
    for (const wallet of [fakeWallet({ chainId: 1 }), fakeWallet({ exposed: false })]) {
      write(KEYS.lastWallet(), wallet.address);
      withKey(wallet);
      reload(wallet, fake);
      expect(await resume()).toBe(false);
      expect(prompts(wallet)).toHaveLength(0);
      expect(seatState()).toMatchObject({ stage: "disconnected", remembered: wallet.address });
    }
    expect(fake.log).toHaveLength(0);
  });

  it("disconnects when the wallet moves to another account or off Sepolia", async () => {
    const { wallet, derive } = setup();
    funded(derive);
    await connect();
    expect(wallet.listeners("accountsChanged")).toBe(1);
    wallet.emit("accountsChanged", [wallet.address.toLowerCase()]);
    expect(seatState().wallet).toBe(wallet.address);
    wallet.emit("accountsChanged", ["0x000000000000000000000000000000000000dEaD"]);
    expect(seatState()).toMatchObject({ stage: "disconnected", remembered: null });
    expect(seatState().wallet).toBeUndefined();
    expect(read(KEYS.lastWallet())).toBeNull();
    expect(wallet.listeners("accountsChanged")).toBe(0);

    await connect();
    wallet.emit("chainChanged", "0x1");
    expect(seatState()).toMatchObject({ stage: "disconnected", message: "Your wallet switched network. Connect again on Sepolia." });
    expect(wallet.listeners("chainChanged")).toBe(0);
  });

  it("forgets the wallet on Disconnect and on Switch off", async () => {
    const { wallet, derive } = setup();
    funded(derive);
    await connect();
    disconnect();
    expect(read(KEYS.lastWallet())).toBeNull();
    expect(seatState()).toMatchObject({ stage: "disconnected", remembered: null, resuming: false });
    expect(wallet.listeners("accountsChanged")).toBe(0);
    await connect();
    expect(read(KEYS.lastWallet())).toBe(wallet.address);
    await switchOff().catch(() => {});
    expect(read(KEYS.lastWallet())).toBeNull();
  });
});
