import { describe, it, expect, beforeEach, vi } from "vitest";
import shapes from "../../fixtures/trade/private_shapes.json";
import frames from "../../fixtures/trade/public_frames.json";
import { createClient } from "./derive.js";
import { fakeDerive } from "./fakeSocket.js";
import { fakeWallet } from "./fakeWallet.js";
import { _resetAssets, arriving, chooseAccount, depositAddress, depositCheck, depositParams, findSaloon, labelAccount, pickSaloon, rememberAccount, summarise } from "./account.js";
import { connectWallet, usdcTransfer, usdcUnits } from "./wallet.js";
import { plainError } from "./derive.js";

const client = (handlers, recorded = []) => {
  const fake = fakeDerive({ handlers, recorded });
  return { fake, c: createClient({ url: "wss://fake", WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) };
};
const subHandlers = (subs) => ({
  "private/get_subaccounts": { subaccount_ids: Object.keys(subs).map(Number) },
  "private/get_subaccount": ({ subaccount_id }) => subs[subaccount_id],
  "private/change_subaccount_label": ({ subaccount_id, label }) => ({ subaccount_id, label }),
});

beforeEach(() => { localStorage.clear(); _resetAssets(); });

describe("the Saloon account", () => {
  it("registers the deposit address under PRIME Standard and subaccount 0 for a new account", async () => {
    expect(depositParams("0xw")).toEqual({ wallet: "0xw", subaccount_id: 0, manager_id: 1 });
    const { fake, c } = client({ "public/register_deposit_address": shapes["public/register_deposit_address"] });
    expect(await depositAddress(c, "0xw")).toBe(shapes["public/register_deposit_address"].deposit_address);
    expect(fake.calls("public/register_deposit_address")[0].params).toEqual({ wallet: "0xw", subaccount_id: 0, manager_id: 1 });
    expect(depositParams("0xw", 90212)).toEqual({ wallet: "0xw", subaccount_id: 90212 });
  });

  it("reuses an existing Cowboy subaccount", async () => {
    const { fake, c } = client(subHandlers(shapes["private/get_subaccount"]));
    const { saloon } = await findSaloon(c, "0xw");
    expect(saloon).toMatchObject({ id: 90212, label: "Cowboy", manager: 1, usdc: 240.5 });
    expect(fake.calls("private/change_subaccount_label")).toHaveLength(0);
  });

  it("proposes a funded account it did not open, and labels nothing while finding it", async () => {
    const subs = structuredClone(shapes["private/get_subaccount"]);
    subs[90212].label = "";
    const { fake, c } = client(subHandlers(subs));
    const { saloon, choices, others } = await findSaloon(c, "0xw");
    expect(saloon).toMatchObject({ id: 90212, label: "", usdc: 240.5 });
    expect(choices.map((x) => x.id)).toEqual([90212]);
    expect(others).toBeNull();
    expect(fake.calls("private/change_subaccount_label")).toHaveLength(0);
    // a subaccount under another manager is never used
    expect(pickSaloon([{ id: 5, label: "Cowboy", manager: 5 }])).toBeNull();
    expect(chooseAccount([{ id: 5, label: "", manager: 5, usdc: 100 }])).toBeNull();
  });

  it("adds up USDC still arriving", async () => {
    const { c } = client({ "public/get_pending_deposits": shapes["public/get_pending_deposits"] });
    expect((await arriving(c, "0xw")).amount).toBe(100);
  });

  // The owner's first testnet run (4 October 2026): Derive names the asset by its address and gives the
  // amount in the token's own units.
  const OWNER_ROW = { action_id: 563, action_type: "DepositToNewSubaccount", asset: "0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b", amount: "10000000",
    subaccount_id: 0, manager_id: 1, tx_hash: `0x${"b7".repeat(32)}`, log_index: 38, status: "confirmed", deposit_type: "standard", timestamp: 1791141510294, updated_at_ms: 1791141550490 };
  const pending = (rows) => ({ "public/get_pending_deposits": { wallet: "0xw", pending_deposits: rows } });

  it("reads a USDC deposit by its asset address, in 6 decimals: $10, not $10,000,000", async () => {
    const { fake, c } = client(pending([{ ...OWNER_ROW, status: "pending" }]), frames.frames);
    const arr = await arriving(c, "0xw", { now: OWNER_ROW.updated_at_ms + 60_000 });
    expect(arr).toMatchObject({ amount: 10, count: 1, landing: 0, opening: 10, openingCount: 1 });
    // the wallet-side token is USDC too; other assets and reverted rows are not
    const rows = [{ ...OWNER_ROW, status: "detected", asset: "0x73efab09362052d26fb93a730be4f8a5edc833af" },
      { ...OWNER_ROW, status: "pending", asset: "0x5E72430EC945CCc183c34e2860FFC2b5bac712c2" }, { ...OWNER_ROW, status: "reverted" }];
    const again = client(pending(rows), frames.frames);
    expect((await arriving(again.c, "0xw", { now: OWNER_ROW.updated_at_ms })).amount).toBe(10);
    // the collateral list is read once per page
    await arriving(c, "0xw");
    expect(fake.calls("public/get_risk_universes").length + again.fake.calls("public/get_risk_universes").length).toBe(1);
  });

  it("knows testnet USDC from config when the collateral list cannot be read", async () => {
    const { c } = client(pending([{ ...OWNER_ROW, status: "pending" }]));
    expect((await arriving(c, "0xw")).amount).toBe(10);
  });

  it("counts a confirmed deposit as landing, not in flight, and lets an old one go", async () => {
    const { c } = client(pending([OWNER_ROW, { ...OWNER_ROW, action_id: 562 }]), frames.frames);
    const arr = await arriving(c, "0xw", { now: OWNER_ROW.updated_at_ms + 60_000 });
    expect(arr).toMatchObject({ amount: 0, count: 0, landing: 20, landingCount: 2, openingCount: 2 });
    const later = await arriving(c, "0xw", { now: OWNER_ROW.updated_at_ms + 3_600_000 });
    expect(later).toMatchObject({ amount: 0, landing: 0, openingCount: 0 });
  });

  const acct = (id, usdc, label = "", manager = 1) => ({ id, usdc, label, manager });

  it("proposes the account with the most USDC, ties to the lowest id, and notes the others", async () => {
    const base = shapes["private/get_subaccount"][90212];
    const mk = (id, usdc, manager = 1) => ({ ...structuredClone(base), subaccount_id: id, manager_id: manager, label: "",
      collaterals: usdc ? base.collaterals.map((x) => ({ ...x, amount: String(usdc) })) : [] });
    const subs = { 7: mk(7, 500, 0), 8: mk(8, 0), 9: mk(9, 10), 10: mk(10, 25), 11: mk(11, 25) };
    const { fake, c } = client(subHandlers(subs));
    const { saloon, choices, others } = await findSaloon(c, "0xw");
    expect(saloon).toMatchObject({ id: 10, usdc: 25 });
    expect(choices.map((x) => x.id)).toEqual([10, 11, 9]); // manager 0 and empty accounts are no choice
    expect(others).toEqual({ count: 2, usdc: 35, ids: [11, 9] });
    expect(fake.calls("private/change_subaccount_label")).toHaveLength(0);
  });

  it("chooses the account asked for, then Cowboy's label, then this browser's last, while each holds USDC", () => {
    const subs = [acct(1, 50), acct(2, 5, "Cowboy"), acct(3, 20), acct(4, 0, "Cowboy")];
    expect(chooseAccount(subs).id).toBe(2);
    expect(chooseAccount(subs, { prefer: 3 }).id).toBe(3);
    expect(chooseAccount(subs, { prefer: 4 }).id).toBe(2); // an empty account gives way to a funded one
    expect(chooseAccount([acct(1, 50), acct(3, 20)], { remembered: 3 }).id).toBe(3);
    expect(chooseAccount([acct(1, 50), acct(4, 0, "Cowboy")]).id).toBe(1); // deposit only when nothing is funded
    rememberAccount("0xw", 3);
    expect(localStorage.getItem("cowboy-saloon-account:testnet:0xw")).toMatch(/"id":3/);
  });

  it("targets an existing empty account for a deposit, and none when the wallet has no PRIME Standard account", () => {
    expect(chooseAccount([acct(6, 0), acct(5, 0), acct(4, 0, "", 0)]).id).toBe(5);
    expect(chooseAccount([acct(6, 0), acct(5, 0, "Cowboy")]).id).toBe(5);
    expect(chooseAccount([acct(6, 0), acct(5, 0)], { prefer: 6 }).id).toBe(6);
    expect(chooseAccount([acct(4, 0, "", 0)])).toBeNull();
    expect(chooseAccount([])).toBeNull();
  });

  it("labels the approved account Cowboy, keeps a label the user gave, and moves Cowboy's label off the old one", async () => {
    const { fake, c } = client({ "private/change_subaccount_label": ({ subaccount_id, label }) => ({ subaccount_id, label }) });
    expect(await labelAccount(c, [acct(1, 50), acct(2, 5, "Cowboy")], acct(1, 50))).toMatchObject({ id: 1, label: "Cowboy" });
    expect(fake.calls("private/change_subaccount_label").map((m) => m.params)).toEqual([{ subaccount_id: 2, label: "" }, { subaccount_id: 1, label: "Cowboy" }]);
    const again = client({ "private/change_subaccount_label": ({ subaccount_id, label }) => ({ subaccount_id, label }) });
    expect(await labelAccount(again.c, [acct(1, 50, "Main")], acct(1, 50, "Main"))).toMatchObject({ label: "Main" });
    expect(again.fake.calls("private/change_subaccount_label")).toHaveLength(0);
  });

  it("refuses under $10, suggests $50 or more, and warns when gas is over 5%", () => {
    expect(depositCheck(5)).toMatchObject({ ok: false, reason: "min" });
    expect(depositCheck(25)).toMatchObject({ ok: true, small: true, gasWarn: false });
    expect(depositCheck(50, 3.1)).toMatchObject({ ok: true, small: false, gasWarn: true });
    expect(depositCheck(100, 3.1).gasWarn).toBe(false);
  });
});

describe("the wallet", () => {
  it("connects, moves to Sepolia, and refuses contract wallets", async () => {
    const w = fakeWallet({ chainId: 1 });
    expect(await connectWallet(w)).toBe(w.address);
    expect(w.calls.find((x) => x.method === "wallet_switchEthereumChain").params[0].chainId).toBe("0xaa36a7");
    await expect(connectWallet(fakeWallet({ code: "0x6080" }))).rejects.toMatchObject({ code: "contract_wallet" });
  });
  /** A wallet without Sepolia: switching answers `noChain` until wallet_addEthereumChain succeeds. */
  const noSepolia = (noChain, { addFails = null } = {}) => {
    const w = fakeWallet({ chainId: 1 });
    let added = false;
    return { ...w, async request(a) {
      if (a.method === "wallet_addEthereumChain") { w.calls.push(a); if (addFails) throw addFails; added = true; return null; }
      if (a.method === "wallet_switchEthereumChain" && !added) { w.calls.push(a); throw noChain; }
      return w.request(a);
    } };
  };
  it("adds Sepolia once when the wallet lacks it, then switches again", async () => {
    for (const err of [Object.assign(new Error("Unrecognized chain ID"), { code: 4902 }),
      Object.assign(new Error("Internal"), { code: -32603, data: { originalError: { code: 4902 } } })]) {
      const w = noSepolia(err);
      expect(await connectWallet(w)).toBe(w.address);
      const add = w.calls.filter((c) => c.method === "wallet_addEthereumChain");
      expect(add).toHaveLength(1);
      expect(add[0].params[0]).toMatchObject({ chainId: "0xaa36a7", chainName: "Sepolia", nativeCurrency: { decimals: 18 }, blockExplorerUrls: ["https://sepolia.etherscan.io"] });
      expect(add[0].params[0].rpcUrls[0]).toMatch(/^https:\/\/.*sepolia/);
      expect(w.calls.filter((c) => c.method === "wallet_switchEthereumChain")).toHaveLength(2);
    }
  });
  it("says what to do when the wallet still lacks Sepolia, as the wallet's error", async () => {
    const e = await connectWallet(noSepolia(Object.assign(new Error("x"), { code: 4902 }), { addFails: Object.assign(new Error("y"), { code: 4902 }) })).catch((x) => x);
    expect(e).toMatchObject({ source: "wallet", code: 4902, step: "add network" });
    expect(plainError(e)).toMatch(/doesn't have the Sepolia test network yet\. Turn on test networks in your wallet \(MetaMask: Settings, then Advanced, then Show test networks\)/);
  });
  it("takes a wallet whose code cannot be read as an ordinary wallet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = fakeWallet();
    const p = { ...w, request: (a) => (a.method === "eth_getCode" ? Promise.reject(Object.assign(new Error("nope"), { code: -32603 })) : w.request(a)) };
    expect(await connectWallet(p)).toBe(w.address);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("builds a USDC transfer to the deposit address in 6 decimals", () => {
    expect(usdcUnits(100.5)).toBe(100500000n);
    const tx = usdcTransfer("0x4201C60C3c85e641c9837588429F59CA57e22bE2", "0x9a3c5be1b0e4d0f7c6d2a8e1f3b4c5d6e7f80912", 50);
    expect(tx.to).toBe("0x73Efab09362052D26FB93A730Be4F8a5EdC833af");
    expect(tx.data.slice(0, 10)).toBe("0xa9059cbb");
    expect(tx.data.endsWith((50_000_000).toString(16).padStart(64, "0"))).toBe(true);
  });
});
