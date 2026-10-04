// The seat with a wallet Derive has never seen: sign-in answers 14000 (account not found), and the
// first deposit, through a deposit address, opens the account. Derive is a fake socket; the replies
// for login are the ones V3 testnet gave a throwaway wallet (4 October 2026).
import { describe, it, expect, beforeEach, vi } from "vitest";
import shapes from "../../fixtures/trade/private_shapes.json";
import { createClient } from "./derive.js";
import { fakeDerive, deriveError } from "./fakeSocket.js";
import { fakeWallet } from "./fakeWallet.js";
import { TESTNET_WS } from "./config.js";
import { KEYS, read } from "./store.js";
import { _setSeatDeps, connect, refreshFunding, seatState } from "./seat.js";

const ADDR = "0x9a3c5be1b0e4d0f7c6d2a8e1f3b4c5d6e7f80912";
const NEW_SUB = 120001, FALLBACK_SUB = 120000;

function setup() {
  const derive = { account: false, pending: [], subs: {} };
  const fake = fakeDerive({
    handlers: {
      "public/login": () => (derive.account ? Object.keys(derive.subs).map(Number) : deriveError(14000, "Account not found")),
      "public/register_deposit_address": ({ wallet }) => ({ wallet, deposit_address: ADDR }),
      "public/get_pending_deposits": ({ wallet }) => ({ wallet, pending_deposits: derive.pending }),
      "private/get_subaccounts": ({ wallet }) => ({ wallet, subaccount_ids: Object.keys(derive.subs).map(Number) }),
      "private/get_subaccount": ({ subaccount_id }) => derive.subs[subaccount_id],
      "private/change_subaccount_label": ({ subaccount_id, label }) => { derive.subs[subaccount_id].label = label; return { subaccount_id, label }; },
    },
  });
  const wallet = fakeWallet();
  _setSeatDeps({ findProvider: () => wallet, createClient: () => createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) });
  return { fake, wallet, derive };
}

const sub = (id, manager, usdc, label = "") => {
  const s = structuredClone(shapes["private/get_subaccount"][90212]);
  return { ...s, subaccount_id: id, manager_id: manager, label, collaterals: usdc ? s.collaterals.map((c) => ({ ...c, amount: String(usdc) })) : [] };
};

beforeEach(() => { localStorage.clear(); localStorage.setItem(KEYS.terms(), JSON.stringify({ at: 1 })); });

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
    expect(read(KEYS.known(wallet.address))).toEqual([]);

    // The deposit is on its way: public pending deposits show it, without a wallet prompt.
    derive.pending = [{ ...shapes["public/get_pending_deposits"].pending_deposits[0], amount: "50", status: "pending" }];
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
    expect(s.saloon).toMatchObject({ id: NEW_SUB, label: "Cowboy", usdc: 50 });
    expect(fake.calls("private/change_subaccount_label").map((m) => m.params)).toEqual([{ subaccount_id: NEW_SUB, label: "Cowboy" }]);
  });

  it("moves to the Saloon account's own deposit address once it exists unfunded", async () => {
    const { fake, derive } = setup();
    await connect();
    derive.account = true;
    derive.subs = { [NEW_SUB]: sub(NEW_SUB, 1, 0) };
    await refreshFunding();
    expect(seatState()).toMatchObject({ stage: "fund", saloon: { id: NEW_SUB, label: "Cowboy" } });
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
