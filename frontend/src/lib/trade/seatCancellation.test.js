import { _resetTradeStorage } from "./store.js";
// Wallet and RPC answers can arrive after the user leaves the seat. These tests hold actual fake
// provider/socket requests at those boundaries; they never ask a real wallet or send a transaction.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import { _resetAssets } from "./account.js";
import { TESTNET_WS } from "./config.js";
import { createClient } from "./derive.js";
import { deriveError, fakeDerive } from "./fakeSocket.js";
import { fakeWallet } from "./fakeWallet.js";
import { _setSeatDeps, approve, connect, deposit, disconnect, holdSend, refreshFunding, resume, seatState, switchOff } from "./seat.js";
import { loadKey } from "./sessionKey.js";
import { keyFromSecret } from "./sign.js";
import { KEYS, read, write } from "./store.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const echo = (p) => ({ ...p });
const sub = (id) => ({ subaccount_id: id, manager_id: 1, label: "", collaterals: [{ asset_name: "USDC", amount: "75" }], positions: [] });

function setup(handlers = {}) {
  const a = fakeWallet({ phrase: "cancellation owner A" });
  const b = fakeWallet({ phrase: "cancellation owner B" });
  let provider = a, keys = 0;
  const idFor = (wallet) => wallet.toLowerCase() === a.address.toLowerCase() ? 101 : 202;
  const fake = fakeDerive({ handlers: {
    "public/login": ({ wallet }) => [idFor(wallet)],
    "private/get_subaccounts": ({ wallet }) => ({ subaccount_ids: [idFor(wallet)] }),
    "private/get_subaccount": ({ subaccount_id }) => sub(subaccount_id),
    "private/change_subaccount_label": echo,
    "private/set_session_key": echo,
    "public/register_deposit_address": ({ wallet }) => ({ deposit_address: wallet }),
    "public/get_pending_deposits": { pending_deposits: [] },
    "public/get_risk_universes": [],
    ...handlers,
  } });
  _setSeatDeps({ findProvider: () => provider,
    newKey: () => keyFromSecret(keccak256(toUtf8Bytes(`cancellation key ${++keys}`))),
    createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }),
  });
  return { a, b, fake, use: (p) => { provider = p; } };
}

/** The wallet request is already made; its response is withheld until release or refusal. */
function hold(wallet, method) {
  const started = deferred(), response = deferred();
  const original = wallet.request;
  wallet.request = (args) => {
    const result = original.call(wallet, args);
    if (args.method !== method) return result;
    started.resolve();
    return response.promise.then(() => result);
  };
  return { started: started.promise, release: () => response.resolve(), reject: (e) => response.reject(e),
    restore: () => { wallet.request = original; } };
}
const prompts = (wallet, method) => wallet.calls.filter((c) => c.method === method).length;

beforeEach(() => { localStorage.clear(); _resetTradeStorage(); _resetAssets(); write(KEYS.terms(), { at: 1 }); });
afterEach(() => { disconnect(); vi.restoreAllMocks(); });

describe("a cancelled connection owns no late results", () => {
  it("does not reopen the client or publish funding after a network change during deposit reads", async () => {
    const readStarted = deferred(), response = deferred();
    const { a, fake } = setup({
      "public/login": deriveError(14000, "Account not found"),
      "public/register_deposit_address": () => { readStarted.resolve(); return response.promise; },
    });
    const connecting = connect();
    await readStarted.promise;
    a.emit("chainChanged", "0x1");
    await connecting;
    response.resolve({ deposit_address: a.address });
    await Promise.resolve();
    expect(seatState()).toMatchObject({ stage: "disconnected", busy: false });
    expect(seatState().wallet).toBeUndefined();
    expect(seatState().depositAddress).toBeUndefined();
    expect(fake.calls("public/register_deposit_address")).toHaveLength(1);
    expect(fake.sockets).toHaveLength(1);
  });

  it("observes an account change before connectWallet has returned its address", async () => {
    const { a, b, fake } = setup();
    const code = hold(a, "eth_getCode");
    const connecting = connect();
    await code.started;
    expect(seatState().wallet).toBeUndefined();
    a.emit("accountsChanged", [b.address]);
    code.release();
    await connecting;
    expect(seatState().stage).toBe("disconnected");
    expect(read(KEYS.lastWallet())).toBeNull();
    expect(prompts(a, "personal_sign")).toBe(0);
    expect(fake.log).toHaveLength(0);
  });

  it("allows the normal accountsChanged event from granting initial wallet access", async () => {
    const { a } = setup();
    const access = hold(a, "eth_requestAccounts");
    const connecting = connect();
    await access.started;
    a.emit("accountsChanged", [a.address]);
    access.release();
    await connecting;
    expect(seatState()).toMatchObject({ stage: "approve", wallet: a.address });
  });

  it("cancels an older connection even if the replacement attempt finds no injected wallet", async () => {
    const { a, fake, use } = setup();
    const signature = hold(a, "personal_sign");
    const old = connect();
    await signature.started;
    use(null);
    await connect();
    signature.release(); await old;
    expect(seatState()).toMatchObject({ stage: "no_wallet", busy: false, resuming: false });
    expect(seatState().wallet).toBeUndefined();
    expect(fake.calls("public/login")).toHaveLength(0);
  });

  it("cancels a quiet resume while the remembered account request is still pending", async () => {
    const { a, fake } = setup();
    write(KEYS.lastWallet(), a.address);
    const accounts = hold(a, "eth_accounts");
    const reconnecting = resume();
    await accounts.started;
    a.emit("chainChanged", "0x1");
    accounts.release();
    expect(await reconnecting).toBe(false);
    expect(seatState()).toMatchObject({ stage: "disconnected", busy: false, resuming: false });
    expect(fake.log).toHaveLength(0);
    expect(prompts(a, "personal_sign")).toBe(0);
  });

  for (const refuse of [false, true]) it(`does not send or publish an old owner sign-in after ${refuse ? "refusal" : "success"} on a replacement connection`, async () => {
    const { a, b, fake, use } = setup();
    const signature = hold(a, "personal_sign");
    const old = connect();
    await signature.started;
    disconnect();
    use(b);
    await connect();
    const current = seatState();
    if (refuse) signature.reject(Object.assign(new Error("User rejected"), { code: 4001 }));
    else signature.release();
    await old;
    expect(seatState()).toBe(current);
    expect(seatState()).toMatchObject({ stage: "approve", wallet: b.address, message: null });
    expect(fake.calls("public/login").map((r) => r.params.wallet)).toEqual([b.address]);
    expect(prompts(a, "personal_sign")).toBe(1);
  });
});

describe("approval and retirement cannot replace a later seat", () => {
  it("ignores a repeated approval tap while its wallet request is pending", async () => {
    const { a, fake } = setup();
    await connect();
    const signature = hold(a, "eth_signTypedData_v4");
    const first = approve();
    await signature.started;
    await approve();
    expect(prompts(a, "eth_signTypedData_v4")).toBe(1);
    signature.release(); await first;
    expect(seatState().stage).toBe("ready");
    expect(fake.calls("private/set_session_key")).toHaveLength(1);
  });

  it("does not submit a cancelled approval signature or overwrite the replacement key", async () => {
    const { a, fake } = setup();
    await connect();
    const signature = hold(a, "eth_signTypedData_v4");
    const old = approve();
    await signature.started;
    disconnect();
    signature.restore();
    await connect();
    await approve();
    const current = seatState(), stored = loadKey(a.address);
    signature.release();
    await old;
    expect(seatState()).toBe(current);
    expect(loadKey(a.address)).toEqual(stored);
    expect(seatState().stage).toBe("ready");
    expect(fake.calls("private/set_session_key")).toHaveLength(1);
    expect(fake.calls("private/change_subaccount_label")).toHaveLength(1);
  });

  it("does not keep an obsolete grant accepted by Derive whose response arrives after disconnect", async () => {
    const accepted = deferred(), response = deferred();
    let grants = 0;
    const { a, fake } = setup({ "private/set_session_key": (p) => {
      if (++grants === 1) { accepted.resolve(p); return response.promise; }
      return echo(p);
    } });
    await connect();
    const old = approve();
    const oldGrant = await accepted.promise;
    disconnect();
    await old;
    expect(loadKey(a.address)).toBeNull();
    expect(read(KEYS.account(a.address))).toBeNull();
    await connect();
    await approve();
    const current = seatState(), stored = loadKey(a.address);
    expect(stored.address).not.toBe(oldGrant.public_session_key);
    response.resolve(echo(oldGrant));
    await Promise.resolve();
    expect(seatState()).toBe(current);
    expect(loadKey(a.address)).toEqual(stored);
    expect(fake.calls("private/change_subaccount_label")).toHaveLength(1);
  });

  it("does not send retirement or delete a new key when an old switch-off signature arrives", async () => {
    const { a, fake } = setup();
    await connect(); await approve();
    const signature = hold(a, "personal_sign");
    const old = switchOff();
    await signature.started;
    expect(loadKey(a.address)).toBeNull();
    disconnect();
    signature.restore();
    await connect(); await approve();
    const current = seatState(), stored = loadKey(a.address);
    signature.release();
    await old;
    expect(seatState()).toBe(current);
    expect(loadKey(a.address)).toEqual(stored);
    expect(fake.calls("private/set_session_key")).toHaveLength(2); // both approvals, no old retirement
  });
});

describe("funding cancellation", () => {
  it("starts the duplicate-deposit hold when the wallet returns its hash, even after a long prompt", async () => {
    const { a } = setup({ "public/login": deriveError(14000, "Account not found") });
    await connect();
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const receipt = hold(a, "eth_sendTransaction");
    const sending = deposit(10);
    await receipt.started;
    const sentAt = startedAt + 31 * 60_000;
    clock.mockReturnValue(sentAt);
    receipt.release(); await sending;
    expect(read(KEYS.sent(a.address))).toMatchObject({ at: sentAt, started_at: startedAt });
    expect(holdSend(seatState())).toBe(true);
  });

  it("does not ask for another owner signature after a cancelled funding refresh", async () => {
    const pending = deferred(), response = deferred();
    let reads = 0;
    const { a } = setup({ "public/login": deriveError(14000, "Account not found"),
      "public/get_pending_deposits": () => {
        if (++reads === 2) { pending.resolve(); return response.promise; }
        return { pending_deposits: [] };
      } });
    await connect();
    const refreshing = refreshFunding();
    await pending.promise;
    a.emit("accountsChanged", []);
    await refreshing;
    response.resolve({ pending_deposits: [] });
    expect(seatState().stage).toBe("disconnected");
    expect(prompts(a, "personal_sign")).toBe(1);
  });

  it("keeps a late accepted deposit hash under the original wallet without restoring its seat", async () => {
    const { a, b, use } = setup({ "public/login": deriveError(14000, "Account not found") });
    await connect();
    const receipt = hold(a, "eth_sendTransaction");
    const sending = deposit(10);
    await receipt.started;
    disconnect(); use(b);
    await connect();
    const current = seatState();
    receipt.release();
    await sending;
    expect(seatState()).toBe(current);
    expect(seatState()).toMatchObject({ stage: "fund", wallet: b.address });
    expect(seatState().sentTx).toBeUndefined();
    expect(read(KEYS.sent(a.address))).toMatchObject({ tx: `0x${"ab".repeat(32)}`, amount: 10, to: a.address });
    expect(read(KEYS.sent(b.address))).toBeNull();
    expect(prompts(a, "eth_sendTransaction")).toBe(1);
  });
});
