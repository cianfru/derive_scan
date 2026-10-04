// Saloon stage 2: the user's seat at Derive for this page visit: the wallet, one Derive connection,
// the Saloon account and Cowboy's approval. One store per page, shared by every ticket.
import { useSyncExternalStore } from "react";
import { NETWORK, TRADE_COINS } from "./config.js";
import { createClient, plainError } from "./derive.js";
import { arriving, depositAddress, findSaloon, knownIds, rememberKnown, summarise } from "./account.js";
import { connectWallet, findProvider, gasEth, personalSign, sendTransaction, usdcTransfer } from "./wallet.js";
import { approveCowboy, keySigner, switchOff as retireKey, usableKey } from "./sessionKey.js";
import { KEYS, read, write } from "./store.js";

let deps = { findProvider, createClient, newKey: undefined };
const initial = () => ({ stage: deps.findProvider() ? "disconnected" : "no_wallet", busy: false, message: null });
let state = initial();
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const fail = (e) => set({ busy: false, message: e?.code === "contract_wallet" ? "Use an ordinary wallet for the Saloon for now." : plainError(e) });

export const seatState = () => state;
export function useSeat() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}
/** Tests and local previews swap the wallet and the socket here. */
export function _setSeatDeps(d) { deps = { ...deps, ...d }; state = initial(); listeners.forEach((l) => l()); }
export function _setSeatState(s) { state = { ...initial(), ...s }; listeners.forEach((l) => l()); }

export const canTrade = (und) => TRADE_COINS.includes(und);
export const termsAccepted = () => !!read(KEYS.terms());

const ownerSign = (provider, wallet) => (ts) => personalSign(provider, wallet, ts);
const keySign = (stored) => (ts) => keySigner(stored).signMessage(ts);

export async function connect() {
  const provider = deps.findProvider();
  if (!provider) return set({ stage: "no_wallet" });
  set({ busy: true, message: null });
  try {
    const wallet = await connectWallet(provider);
    state.client?.close();
    const client = deps.createClient({ url: NETWORK.wsUrl });
    set({ provider, wallet, client });
    if (!termsAccepted()) return set({ stage: "terms", busy: false });
    await load();
  } catch (e) { fail(e); }
}

export async function acceptTerms() {
  write(KEYS.terms(), { at: Date.now() });
  set({ busy: true });
  try { await load(); } catch (e) { fail(e); }
}

/** Log in (with the browser's key when there is one: no wallet prompt), then find the Saloon account. */
async function load() {
  const { client, wallet, provider } = state;
  const stored = usableKey(wallet);
  if (stored) {
    await client.login(wallet, keySign(stored));
    const sub = summarise(await client.call("private/get_subaccount", { subaccount_id: stored.subaccount_id }));
    return set({ key: stored, saloon: sub, stage: sub.usdc > 0 ? "ready" : "fund", busy: false, loggedAs: "key" });
  }
  await client.login(wallet, ownerSign(provider, wallet));
  set({ loggedAs: "owner" });
  const { saloon, subs } = await findSaloon(client, wallet);
  if (!saloon && !knownIds(wallet).length) rememberKnown(wallet, subs);
  if (!saloon || !(saloon.usdc > 0)) return toFund(saloon);
  set({ saloon, key: null, stage: "approve", busy: false });
}

async function toFund(saloon) {
  const { client, wallet } = state;
  const [address, arr] = await Promise.all([depositAddress(client, wallet, saloon?.id || null), arriving(client, wallet)]);
  set({ saloon, depositAddress: address, arriving: arr.amount, stage: "fund", busy: false });
}

/** Re-read pending deposits and the Saloon account; move on once USDC has landed. */
export async function refreshFunding() {
  const { client, wallet } = state;
  set({ busy: true, message: null });
  try {
    if (state.loggedAs !== "owner") { await client.login(wallet, ownerSign(state.provider, wallet)); set({ loggedAs: "owner" }); }
    const { saloon } = await findSaloon(client, wallet);
    if (saloon && saloon.usdc > 0) return set({ saloon, stage: state.key ? "ready" : "approve", busy: false });
    const arr = await arriving(client, wallet);
    set({ saloon, arriving: arr.amount, busy: false });
  } catch (e) { fail(e); }
}

/** The wallet's own gas estimate for the deposit, in dollars (ETH priced from the Saloon's ETH board). */
export async function depositGasUsd(dollars, ethUsd) {
  const { provider, wallet, depositAddress: to } = state;
  if (!provider || !to || !ethUsd) return null;
  try { return (await gasEth(provider, usdcTransfer(wallet, to, dollars))) * ethUsd; } catch { return null; }
}

export async function deposit(dollars) {
  const { provider, wallet, depositAddress: to } = state;
  set({ busy: true, message: null });
  try {
    const tx = await sendTransaction(provider, usdcTransfer(wallet, to, dollars));
    set({ busy: false, sentTx: tx, sentAmount: dollars });
  } catch (e) { fail(e); }
}

export async function approve() {
  const { client, provider, wallet, saloon } = state;
  set({ busy: true, message: null });
  try {
    if (state.loggedAs !== "owner") { await client.login(wallet, ownerSign(provider, wallet)); }
    const stored = await approveCowboy({ client, provider, owner: wallet, subaccountId: saloon.id, ...(deps.newKey ? { newKey: deps.newKey } : {}) });
    await client.login(wallet, keySign(stored)); // later calls sign in with the key, without wallet prompts
    set({ key: stored, loggedAs: "key", stage: "ready", busy: false });
  } catch (e) { fail(e); }
}

export async function switchOff() {
  const { client, provider, wallet, key } = state;
  set({ busy: true, message: null });
  try {
    await client.login(wallet, ownerSign(provider, wallet));
    set({ loggedAs: "owner" });
    await retireKey({ client, provider, owner: wallet, stored: key });
    set({ key: null, stage: "approve", busy: false, message: "Switched off. Derive retires the key within 15 minutes." });
  } catch (e) {
    set({ key: null, stage: "approve", busy: false, message: `${plainError(e)} The key is deleted from this browser.` });
  }
}

export function disconnect() {
  state.client?.close();
  state = initial();
  listeners.forEach((l) => l());
}
