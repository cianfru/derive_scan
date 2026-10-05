import { _resetTradeStorage } from "./store.js";
import { describe, it, expect, beforeEach } from "vitest";
import { AbiCoder, getAddress } from "ethers";
import { createClient } from "./derive.js";
import { fakeDerive, deriveError } from "./fakeSocket.js";
import { fakeWallet } from "./fakeWallet.js";
import { approveCowboy, assertGrant, grantFor, loadKey, switchOff, usableKey } from "./sessionKey.js";
import { actionDigest, buildSetSessionKey, keyFromSecret, typedDataDigest } from "./sign.js";
import { keccak256, toUtf8Bytes } from "ethers";

// jsdom's random bytes are not the browser's; tests use a fixed key from a public test phrase.
const newKey = () => keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));

const NOW = 1791089400;
const decodeSetSessionKey = (data) => {
  const [key, expiry, scopes, subaccounts] = AbiCoder.defaultAbiCoder().decode(["address", "uint256", "uint256[]", "uint256[]"], data);
  return { key, expiry: Number(expiry), scopes: scopes.map(Number), subaccounts: subaccounts.map(Number) };
};
const setup = (handlers = {}) => {
  const echo = (p) => ({ public_session_key: p.public_session_key, protocol_scopes: p.protocol_scopes, offchain_scopes: p.offchain_scopes, subaccount_ids: p.subaccount_ids, expiry_sec: p.expiry_sec, label: p.label, ip_whitelist: [] });
  const fake = fakeDerive({ handlers: { "private/set_session_key": echo, ...handlers } });
  const c = createClient({ url: "wss://fake", WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} });
  return { fake, c, wallet: fakeWallet() };
};

beforeEach(() => { localStorage.clear(); _resetTradeStorage(); });

describe("the grant", () => {
  it("is exactly trade:rfq:option, one subaccount and 7 days", () => {
    expect(grantFor(90212, NOW)).toEqual({ protocol_scopes: ["trade:rfq:option"], offchain_scopes: [], subaccount_ids: [90212], expiry_sec: NOW + 7 * 86400, label: "Cowboy Saloon" });
  });
  it("is refused with an empty subaccount list (Derive reads it as all subaccounts) or any other scope", () => {
    const g = grantFor(90212, NOW);
    expect(assertGrant(g, NOW)).toBe(true);
    for (const bad of [
      { ...g, subaccount_ids: [] }, { ...g, subaccount_ids: null }, { ...g, subaccount_ids: [1, 2] }, { ...g, subaccount_ids: [0] },
      ...["admin", "withdraw", "transfer:all", "trade:all", "trade:rfq:all", "set_session_key"].map((s) => ({ ...g, protocol_scopes: [s] })),
      { ...g, protocol_scopes: ["trade:rfq:option", "withdraw"] }, { ...g, offchain_scopes: ["account_info"] },
      { ...g, expiry_sec: NOW + 30 * 86400 }, { ...g, expiry_sec: NOW + 60 },
    ]) expect(() => assertGrant(bad, NOW)).toThrow(/grant refused/);
    expect(() => buildSetSessionKey({ owner: getAddress("0x4201c60c3c85e641c9837588429f59ca57e22be2"), sessionKey: getAddress("0x2b5ad5c4795c026514f8317c7a215e218dccd6cf"), grant: { ...g, protocol_scopes: ["withdraw"] }, nonce: "1", signatureExpirySec: NOW, chainId: 11155111 })).toThrow(/scope not allowed/);
  });
  it("is what the wallet signs: the typed data hashes to Derive's action digest, and the data holds one scope code and one subaccount", () => {
    const built = buildSetSessionKey({ owner: "0x4201C60C3c85e641c9837588429F59CA57e22bE2", sessionKey: getAddress("0x2b5ad5c4795c026514f8317c7a215e218dccd6cf"), grant: grantFor(90212, NOW), nonce: "1791089400000123456", signatureExpirySec: NOW + 600, chainId: 11155111 });
    expect(typedDataDigest(built.typedData)).toBe(actionDigest(built.fields, 11155111));
    expect(built.fields.module).toBe("0xe330CF64ff6EbF41699aad344Cb21d78db1D2bb6");
    expect(built.fields.subaccountId).toBe(0);
    expect(decodeSetSessionKey(built.fields.data)).toEqual({ key: getAddress("0x2b5ad5c4795c026514f8317c7a215e218dccd6cf"), expiry: NOW + 7 * 86400, scopes: [10], subaccounts: [90212] });
  });
});

describe("approving Cowboy", () => {
  it("registers the key, checks Derive's echo and keeps it in this browser", async () => {
    const { fake, c, wallet } = setup();
    const stored = await approveCowboy({ client: c, provider: wallet, owner: wallet.address, subaccountId: 90212, now: NOW, newKey });
    const sent = fake.calls("private/set_session_key")[0].params;
    expect(sent).toMatchObject({ wallet: wallet.address, protocol_scopes: ["trade:rfq:option"], subaccount_ids: [90212], offchain_scopes: [], expiry_sec: NOW + 604800, label: "Cowboy Saloon", signer: wallet.address });
    expect(wallet.calls.map((x) => x.method)).toEqual(["eth_signTypedData_v4"]);
    expect(loadKey(wallet.address)).toEqual(stored);
    expect(stored.address).toBe(sent.public_session_key);
    expect(usableKey(wallet.address, NOW)).toEqual(stored);
    expect(usableKey(wallet.address, NOW + 7 * 86400)).toBeNull();
  });
  it("retires a key whose grant Derive echoes differently, and keeps nothing", async () => {
    let n = 0;
    const { c, wallet } = setup({ "private/set_session_key": (p) => (++n === 1 ? { ...p, subaccount_ids: [90211, 90212] } : p) });
    await expect(approveCowboy({ client: c, provider: wallet, owner: wallet.address, subaccountId: 90212, now: NOW, newKey })).rejects.toMatchObject({ code: "grant_mismatch" });
    expect(n).toBe(2);
    expect(loadKey(wallet.address)).toBeNull();
  });
  it("stops if the wallet declines", async () => {
    const { fake, c } = setup();
    const wallet = fakeWallet({ reject: new Set(["eth_signTypedData_v4"]) });
    await expect(approveCowboy({ client: c, provider: wallet, owner: wallet.address, subaccountId: 90212, now: NOW, newKey })).rejects.toMatchObject({ code: 4001 });
    expect(fake.calls("private/set_session_key")).toHaveLength(0);
  });
});

describe("switching off", () => {
  it("sets a near expiry on Derive and clears the browser copy", async () => {
    const { fake, c, wallet } = setup();
    const stored = await approveCowboy({ client: c, provider: wallet, owner: wallet.address, subaccountId: 90212, now: NOW, newKey });
    await switchOff({ client: c, provider: wallet, owner: wallet.address, stored, now: NOW + 100 });
    const off = fake.calls("private/set_session_key")[1].params;
    expect(off).toMatchObject({ public_session_key: stored.address, expiry_sec: NOW + 100 + 330, subaccount_ids: [90212], protocol_scopes: ["trade:rfq:option"] });
    expect(loadKey(wallet.address)).toBeNull();
  });
  it("clears the browser copy even when Derive does not answer", async () => {
    const { c, wallet } = setup();
    const stored = await approveCowboy({ client: c, provider: wallet, owner: wallet.address, subaccountId: 90212, now: NOW, newKey });
    const { c: c2 } = setup({ "private/set_session_key": deriveError(9002) });
    await expect(switchOff({ client: c2, provider: wallet, owner: wallet.address, stored, now: NOW })).rejects.toBeTruthy();
    expect(loadKey(wallet.address)).toBeNull();
  });
});
