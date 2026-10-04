// Saloon stage 2: the user's seat at Derive for this page visit: the wallet, one Derive connection,
// the Saloon account and Cowboy's approval. One store per page, shared by every ticket.
import { useSyncExternalStore } from "react";
import { NETWORK, TRADE_COINS } from "./config.js";
import { NO_ACCOUNT, at, createClient, failure } from "./derive.js";
import { arriving, depositAddress, findSaloon, knownIds, rememberKnown, summarise } from "./account.js";
import { connectWallet, findProvider, gasEth, personalSign, sendTransaction, usdcTransfer } from "./wallet.js";
import { approveCowboy, keySigner, switchOff as retireKey, usableKey } from "./sessionKey.js";
import { KEYS, read, write } from "./store.js";

let deps = { findProvider, createClient, newKey: undefined };
const initial = () => ({ stage: deps.findProvider() ? "disconnected" : "no_wallet", busy: false, message: null });
let state = initial();
const listeners = new Set();
/** A new message replaces the old one's testing details. */
const set = (patch) => {
  const p = "message" in patch && !("detail" in patch) ? { ...patch, detail: null } : patch;
  state = { ...state, ...p }; listeners.forEach((l) => l());
};
/** A plain message for the screen, its `detail` for the testnet build's (i), the raw error to the console. */
const fail = (e, step) => { const f = failure(e, step); set({ busy: false, message: f.message, detail: f.detail }); };

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
    const wallet = await at("connect", connectWallet(provider));
    state.client?.close();
    const client = deps.createClient({ url: NETWORK.wsUrl });
    set({ provider, wallet, client, newAccount: false, loggedAs: null });
    if (!termsAccepted()) return set({ stage: "terms", busy: false });
    await load();
  } catch (e) { fail(e, "connect"); }
}

export async function acceptTerms() {
  write(KEYS.terms(), { at: Date.now() });
  set({ busy: true });
  try { await load(); } catch (e) { fail(e, "sign in"); }
}

/**
 * Owner sign-in. A wallet Derive has never seen answers 14000 (account not found): Derive opens the
 * account with its first deposit, so that is not a failure. Returns false then, and the connection
 * forgets the sign-in so later public calls do not repeat it.
 */
async function ownerLogin() {
  const { client, wallet, provider } = state;
  try {
    await at("sign in", client.login(wallet, ownerSign(provider, wallet)));
  } catch (e) {
    if (e?.code !== NO_ACCOUNT) throw e;
    client.logout();
    set({ loggedAs: null, newAccount: true });
    return false;
  }
  set({ loggedAs: "owner", newAccount: false });
  return true;
}

/** Log in (with the browser's key when there is one: no wallet prompt), then find the Saloon account. */
async function load() {
  const { client, wallet } = state;
  const stored = usableKey(wallet);
  if (stored) {
    await at("sign in", client.login(wallet, keySign(stored)));
    const sub = summarise(await at("find account", client.call("private/get_subaccount", { subaccount_id: stored.subaccount_id })));
    set({ key: stored, loggedAs: "key", newAccount: false });
    if (!(sub.usdc > 0)) return toFund(sub); // an emptied account still needs its deposit address
    return set({ saloon: sub, stage: "ready", busy: false });
  }
  if (!(await ownerLogin())) {
    // No Derive account yet: everything up to the first deposit uses public calls only.
    rememberKnown(wallet, []);
    return toFund(null);
  }
  const { saloon, subs } = await at("find account", findSaloon(client, wallet));
  if (!saloon && !knownIds(wallet).length) rememberKnown(wallet, subs);
  if (!saloon || !(saloon.usdc > 0)) return toFund(saloon);
  set({ saloon, key: null, stage: "approve", busy: false });
}

async function toFund(saloon) {
  const { client, wallet } = state;
  const [address, arr] = await at("deposit address", Promise.all([depositAddress(client, wallet, saloon?.id || null), arriving(client, wallet)]));
  set({ saloon, depositAddress: address, arriving: arr.amount, stage: "fund", busy: false });
}

/**
 * Re-read pending deposits and the Saloon account; move on once USDC has landed. A wallet with no
 * Derive account yet is read from public pending deposits while a deposit is on its way (no wallet
 * prompt); once none is pending it signs in, and the account the deposit opened is found and labelled.
 */
export async function refreshFunding() {
  const { client, wallet } = state;
  set({ busy: true, message: null });
  try {
    if (state.newAccount) {
      const arr = await at("find account", arriving(client, wallet));
      if (arr.count > 0) return set({ arriving: arr.amount, busy: false });
    }
    if (state.loggedAs !== "owner" && !(await ownerLogin())) return set({ saloon: null, arriving: 0, busy: false });
    const had = state.saloon;
    const { saloon } = await at("find account", findSaloon(client, wallet));
    if (saloon && saloon.usdc > 0) return set({ saloon, stage: state.key ? "ready" : "approve", busy: false });
    // A new Saloon account takes its own deposit address from now on (the old one opens another account).
    const address = saloon && !had ? await at("deposit address", depositAddress(client, wallet, saloon.id)) : state.depositAddress;
    const arr = await at("find account", arriving(client, wallet));
    set({ saloon, depositAddress: address, arriving: arr.amount, busy: false });
  } catch (e) { fail(e, "find account"); }
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
  } catch (e) { fail(e, "deposit"); }
}

export async function approve() {
  const { client, provider, wallet, saloon } = state;
  set({ busy: true, message: null });
  try {
    if (state.loggedAs !== "owner") { await at("sign in", client.login(wallet, ownerSign(provider, wallet))); }
    const stored = await at("approve", approveCowboy({ client, provider, owner: wallet, subaccountId: saloon.id, ...(deps.newKey ? { newKey: deps.newKey } : {}) }));
    await at("sign in", client.login(wallet, keySign(stored))); // later calls sign in with the key, without wallet prompts
    set({ key: stored, loggedAs: "key", stage: "ready", busy: false });
  } catch (e) { fail(e, "approve"); }
}

export async function switchOff() {
  const { client, provider, wallet, key } = state;
  set({ busy: true, message: null });
  try {
    await at("sign in", client.login(wallet, ownerSign(provider, wallet)));
    set({ loggedAs: "owner" });
    await at("switch off", retireKey({ client, provider, owner: wallet, stored: key }));
    set({ key: null, stage: "approve", busy: false, message: "Switched off. Derive retires the key within 15 minutes." });
  } catch (e) {
    const f = failure(e, "switch off");
    set({ key: null, stage: "approve", busy: false, message: `${f.message} The key is deleted from this browser.`, detail: f.detail });
  }
}

export function disconnect() {
  state.client?.close();
  state = initial();
  listeners.forEach((l) => l());
}
