import { describe, it, expect, beforeEach, vi } from "vitest";
import shapes from "../../fixtures/trade/private_shapes.json";
import { createClient } from "./derive.js";
import { fakeDerive } from "./fakeSocket.js";
import { fakeWallet } from "./fakeWallet.js";
import { arriving, depositAddress, depositCheck, depositParams, findNew, findSaloon, pickSaloon, rememberKnown, summarise } from "./account.js";
import { connectWallet, usdcTransfer, usdcUnits } from "./wallet.js";
import { plainError } from "./derive.js";

const client = (handlers) => {
  const fake = fakeDerive({ handlers });
  return { fake, c: createClient({ url: "wss://fake", WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} }) };
};
const subHandlers = (subs) => ({
  "private/get_subaccounts": { subaccount_ids: Object.keys(subs).map(Number) },
  "private/get_subaccount": ({ subaccount_id }) => subs[subaccount_id],
  "private/change_subaccount_label": ({ subaccount_id, label }) => ({ subaccount_id, label }),
});

beforeEach(() => localStorage.clear());

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

  it("labels the one new PRIME Standard subaccount after the first deposit, and only that", async () => {
    const subs = structuredClone(shapes["private/get_subaccount"]);
    subs[90212].label = "";
    rememberKnown("0xw", [{ id: 90211 }]);
    const { fake, c } = client(subHandlers(subs));
    const { saloon } = await findSaloon(c, "0xw");
    expect(saloon.id).toBe(90212);
    expect(fake.calls("private/change_subaccount_label")[0].params).toEqual({ subaccount_id: 90212, label: "Cowboy" });
    // a subaccount that was there before the deposit is never claimed
    expect(findNew([summarise(subs[90212])], [90212])).toBeNull();
    // nor a subaccount under another manager
    expect(pickSaloon([{ id: 5, label: "Cowboy", manager: 5 }])).toBeNull();
  });

  it("adds up USDC still arriving", async () => {
    const { c } = client({ "public/get_pending_deposits": shapes["public/get_pending_deposits"] });
    expect((await arriving(c, "0xw")).amount).toBe(100);
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
