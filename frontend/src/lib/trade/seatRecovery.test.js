import { _resetTradeStorage } from "./store.js";
// The seat when Derive no longer accepts Cowboy's key (expired, revoked or unknown), and Switch off
// when the wallet declines: the browser drops the key, says only what is true, and never loops.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import shapes from "../../fixtures/trade/private_shapes.json";
import { createClient, deriveKeyRejected } from "./derive.js";
import { fakeDerive, deriveError } from "./fakeSocket.js";
import { fakeWallet } from "./fakeWallet.js";
import { TESTNET_WS } from "./config.js";
import { KEYS, read, write } from "./store.js";
import { _setSeatDeps, approve, connect, dropKey, resume, seatState, switchOff } from "./seat.js";
import { keyFromSecret, recoverLogin } from "./sign.js";

const SUB = 140001;
const oldKey = keyFromSecret(keccak256(toUtf8Bytes("cowboy revoked session key")));
const newKey = () => keyFromSecret(keccak256(toUtf8Bytes("cowboy fresh session key")));
const sub = (id, usdc) => {
  const s = structuredClone(shapes["private/get_subaccount"][90212]);
  return { ...s, subaccount_id: id, manager_id: 1, label: "Cowboy", collaterals: s.collaterals.map((c) => ({ ...c, amount: String(usdc) })) };
};

/** Derive with one funded account; `keys` holds the session keys it accepts (lower-case addresses). */
function setup({ rejectCode = 14026, reject = new Set() } = {}) {
  const wallet = fakeWallet({ reject });
  const derive = { keys: new Set(), subs: { [SUB]: sub(SUB, 75) } };
  const fake = fakeDerive({
    handlers: {
      "public/login": ({ wallet: w, timestamp, signature }) => {
        const signer = recoverLogin(timestamp, signature).toLowerCase();
        if (signer === w.toLowerCase()) return [SUB];
        return derive.keys.has(signer) ? [SUB] : deriveError(rejectCode, "Session key not found");
      },
      "private/get_subaccounts": ({ wallet: w }) => ({ wallet: w, subaccount_ids: [SUB] }),
      "private/get_subaccount": ({ subaccount_id }) => derive.subs[subaccount_id],
      "private/change_subaccount_label": ({ subaccount_id, label }) => ({ subaccount_id, label }),
      "private/set_session_key": (p) => {
        derive.keys.add(p.public_session_key.toLowerCase());
        return { public_session_key: p.public_session_key, protocol_scopes: p.protocol_scopes, offchain_scopes: p.offchain_scopes,
          subaccount_ids: p.subaccount_ids, expiry_sec: p.expiry_sec, label: p.label, ip_whitelist: [] };
      },
    },
  });
  const reload = () => _setSeatDeps({ findProvider: () => wallet, newKey, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) });
  reload();
  return { fake, wallet, derive, reload };
}
/** A key this browser kept that Derive no longer knows. */
const storeOldKey = (wallet) => write(KEYS.key(wallet.address), { address: oldKey.address, secret: oldKey.privateKey, wallet: wallet.address,
  subaccount_id: SUB, expiry_sec: Math.floor(Date.now() / 1000) + 86400, network: "testnet" });
const prompts = (wallet, m) => wallet.calls.filter((c) => c.method === m).length;
const keyLogins = (fake) => fake.calls("public/login").filter((m) => recoverLogin(m.params.timestamp, m.params.signature) === oldKey.address).length;

let warn;
beforeEach(() => {
  localStorage.clear(); _resetTradeStorage();
  localStorage.setItem(KEYS.terms(), JSON.stringify({ at: 1 }));
  warn?.mockRestore();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("approval recovery", () => {
  it("names Derive's key rejections (expired, unknown, signer not a key) and nothing else", () => {
    for (const code of [14023, 14026, 14030]) expect(deriveKeyRejected({ code })).toBe(true);
    expect(deriveKeyRejected({ code: 14014 }, { login: true })).toBe(true);
    expect(deriveKeyRejected({ code: 14014 })).toBe(false);
    expect(deriveKeyRejected("session_key_deregistered")).toBe(true);
    for (const code of [11000, 14000, 9002, 14031]) expect(deriveKeyRejected({ code })).toBe(false);
  });

  for (const code of [14026, 14030, 14023]) {
    it(`on Connect, drops a key Derive rejects (${code}), signs in as the owner once and goes to approval`, async () => {
      const { fake, wallet } = setup({ rejectCode: code });
      storeOldKey(wallet);
      await connect();
      expect(read(KEYS.key(wallet.address))).toBeNull();
      expect(seatState()).toMatchObject({ stage: "approve", loggedAs: "owner", key: null, saloon: { id: SUB } });
      expect(keyLogins(fake)).toBe(1);
      expect(prompts(wallet, "personal_sign")).toBe(1);
      // Approving makes a fresh key, and the seat is ready with it.
      await approve();
      expect(seatState()).toMatchObject({ stage: "ready", loggedAs: "key" });
      expect(read(KEYS.key(wallet.address)).address).toBe(newKey().address);
      // Connecting again never tries the old key.
      await connect();
      expect(keyLogins(fake)).toBe(1);
      expect(seatState().stage).toBe("ready");
    });
  }

  it("on reload, gives up quietly when the key is rejected: no wallet prompt, the key dropped, Reconnect offered", async () => {
    const { fake, wallet } = setup();
    storeOldKey(wallet);
    write(KEYS.lastWallet(), wallet.address);
    expect(await resume()).toBe(false);
    expect(prompts(wallet, "personal_sign")).toBe(0);
    expect(read(KEYS.key(wallet.address))).toBeNull();
    expect(seatState()).toMatchObject({ stage: "disconnected", resuming: false, busy: false, message: null, remembered: wallet.address });
    expect(keyLogins(fake)).toBe(1);
  });

  it("drops the key when Derive rejects it in use, and the next click approves afresh", async () => {
    const { derive, wallet } = setup();
    storeOldKey(wallet);
    derive.keys.add(oldKey.address.toLowerCase());
    await connect();
    expect(seatState()).toMatchObject({ stage: "ready", loggedAs: "key" });
    derive.keys.clear(); // revoked on Derive
    dropKey();
    expect(read(KEYS.key(wallet.address))).toBeNull();
    expect(seatState()).toMatchObject({ stage: "approve", key: null, loggedAs: null, message: "Cowboy's approval has ended. Approve again to continue." });
    expect(prompts(wallet, "personal_sign")).toBe(0); // no prompt without a click
    await approve();
    expect(seatState()).toMatchObject({ stage: "ready", loggedAs: "key" });
    expect(prompts(wallet, "personal_sign")).toBe(1);
  });
});

describe("Switch off says only what is true", () => {
  it("when the wallet declines the sign-in, deletes the key anyway, says Derive was not told, and reconnecting cannot restore it", async () => {
    const { derive, wallet, reload } = setup();
    storeOldKey(wallet);
    derive.keys.add(oldKey.address.toLowerCase());
    await connect();
    expect(seatState().stage).toBe("ready");
    const decline = { ...wallet, async request(a) { if (a.method === "personal_sign") throw Object.assign(new Error("User rejected"), { code: 4001 }); return wallet.request(a); } };
    // The seat in view keeps its provider: that wallet now declines.
    seatState().provider = decline;
    await switchOff();
    const s = seatState();
    expect(read(KEYS.key(wallet.address))).toBeNull();
    expect(read(KEYS.lastWallet())).toBeNull();
    expect(s.key).toBeNull();
    expect(s.message).toMatch(/deleted from this browser/);
    expect(s.message).toMatch(/Derive was not told/);
    expect(s.message).not.toMatch(/Derive retires/);
    // A reload and a reconnect: no key to resume with, so approval is asked again.
    reload();
    expect(await resume()).toBe(false);
    await connect();
    expect(seatState().stage).toBe("approve");
  });

  it("when Derive is told, says both", async () => {
    const { derive, wallet } = setup();
    storeOldKey(wallet);
    derive.keys.add(oldKey.address.toLowerCase());
    await connect();
    await switchOff();
    const s = seatState();
    expect(read(KEYS.key(wallet.address))).toBeNull();
    expect(s.message).toMatch(/deleted from this browser/);
    expect(s.message).toMatch(/Derive retires it within 15 minutes/);
  });
});
