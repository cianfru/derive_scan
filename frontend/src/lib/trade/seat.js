// Saloon stage 2: the user's seat at Derive for this page visit: the wallet, one Derive connection,
// the Saloon account and Cowboy's approval. One store per page, shared by every ticket.
import { useSyncExternalStore } from "react";
import { getAddress } from "ethers";
import { NETWORK, SALOON_LABEL, SENT_HOLD_MS, TRADE_COINS } from "./config.js";
import { NO_ACCOUNT, at, createClient, deriveKeyRejected, failure, plainError } from "./derive.js";
import { arriving, depositAddress, findSaloon, fundedAccounts, labelAccount, listSubaccounts, otherAccounts, rememberAccount, summarise } from "./account.js";
import { connectWallet, findProvider, gasEth, personalSign, sendTransaction, usdcTransfer } from "./wallet.js";
import { approveCowboy, clearKey, keySigner, switchOff as retireKey, usableKey } from "./sessionKey.js";
import { KEYS, read, remove, write } from "./store.js";

let deps = { findProvider, createClient, newKey: undefined };
/** Set once this page has tried to resume (or connected): later resets never show "Reconnecting…". */
let resumed = false;
const initial = () => {
  const provider = deps.findProvider();
  const remembered = read(KEYS.lastWallet());
  const resuming = !resumed && !!provider && !!remembered;
  return { stage: provider ? "disconnected" : "no_wallet", busy: resuming, resuming, remembered: provider ? remembered : null, message: null };
};
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
export function _setSeatDeps(d) { deps = { ...deps, ...d }; unwatch(); resumed = false; state = initial(); pub?.close(); pub = null; listeners.forEach((l) => l()); }
export function _setSeatState(s) { state = { ...initial(), ...s }; listeners.forEach((l) => l()); }

/** A connection for public reads (the testnet's instrument list): the seat's own when it has one,
 * else one shared, never logged in. */
let pub = null;
export function publicClient() {
  if (state.client) return state.client;
  pub = pub || deps.createClient({ url: NETWORK.wsUrl });
  return pub;
}

export const canTrade = (und) => TRADE_COINS.includes(und);
export const termsAccepted = () => !!read(KEYS.terms());

/**
 * What the fund step shows from Derive's deposit list. Before the Saloon account exists, freshly
 * confirmed deposits still count as arriving, and a deposit to the new-account address holds back
 * another send there (each one opens an account of its own).
 */
const funding = (arr, saloon) => ({
  arriving: saloon ? arr.amount : arr.amount + arr.landing,
  opening: saloon ? 0 : arr.openingCount,
});

/** A deposit this browser sent to the new-account address, kept for SENT_HOLD_MS (reloads too). */
function sentNew(wallet, now = Date.now()) {
  const s = read(KEYS.sent(wallet));
  return s && now - s.at < SENT_HOLD_MS ? s : null;
}
const sentPatch = (wallet) => {
  const s = sentNew(wallet);
  return s ? { sentTx: s.tx, sentAmount: s.amount, sentAt: s.at } : {};
};

/** True while another send to the new-account address would open a second account. */
export function holdSend(seat, now = Date.now()) {
  if (seat.saloon) return false;
  return (seat.opening || 0) > 0 || (!!seat.sentTx && now - (seat.sentAt || 0) < SENT_HOLD_MS);
}

const ownerSign = (provider, wallet) => (ts) => personalSign(provider, wallet, ts);
const keySign = (stored) => (ts) => keySigner(stored).signMessage(ts);

/**
 * The wallet's own events. Another account, or none, ends the seat; so does leaving Sepolia (the seat
 * never switches network by itself). Added once per connection, removed on disconnect.
 */
let watched = null;
function watch(provider) {
  if (watched?.provider === provider || typeof provider?.on !== "function") return;
  unwatch();
  const accountsChanged = (accounts) => {
    if (!state.wallet) return;
    const list = (accounts || []).map((a) => String(a).toLowerCase());
    if (list.includes(state.wallet.toLowerCase())) return;
    if (list.length) remove(KEYS.lastWallet()); // another account: forget this one; none (locked): keep it
    end(null);
  };
  const chainChanged = (chainId) => {
    if (!state.wallet || Number(chainId) === NETWORK.chainId) return;
    end("Your wallet switched network. Connect again on Sepolia.");
  };
  provider.on("accountsChanged", accountsChanged);
  provider.on("chainChanged", chainChanged);
  watched = { provider, accountsChanged, chainChanged };
}
function unwatch() {
  if (!watched) return;
  const { provider, accountsChanged, chainChanged } = watched;
  watched = null;
  try {
    provider.removeListener?.("accountsChanged", accountsChanged);
    provider.removeListener?.("chainChanged", chainChanged);
  } catch { /* the wallet went away */ }
}
/** Back to "disconnected" (the remembered wallet stays unless the caller forgot it), with a message. */
function end(message) {
  unwatch();
  state.client?.close();
  state = { ...initial(), message };
  listeners.forEach((l) => l());
}

/**
 * On page load, once: pick the remembered wallet back up without any wallet prompt. It resumes only if
 * the wallet already exposes that account (eth_accounts never prompts), is on Sepolia, and this browser
 * holds a usable Cowboy key for it; then the key signs in. Otherwise the seat stays disconnected and
 * the header offers "Reconnect" (any signature comes from a click). Returns true when resumed.
 */
export async function resume() {
  if (resumed) return false;
  resumed = true;
  const provider = deps.findProvider();
  const remembered = read(KEYS.lastWallet());
  const quiet = () => { set({ resuming: false, busy: false }); return false; };
  if (!provider || !remembered || state.wallet) return quiet();
  set({ resuming: true, busy: true, remembered });
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) || [];
    if (!accounts.some((a) => String(a).toLowerCase() === remembered.toLowerCase())) return quiet();
    if (Number(await provider.request({ method: "eth_chainId" })) !== NETWORK.chainId) return quiet();
    const wallet = getAddress(remembered);
    if (!usableKey(wallet) || !termsAccepted()) return quiet();
    const client = deps.createClient({ url: NETWORK.wsUrl });
    set({ provider, wallet, client, newAccount: false, loggedAs: null });
    await load({ canPrompt: false });
    watch(provider);
    set({ resuming: false });
    return true;
  } catch (e) {
    // A key Derive no longer takes is already dropped: the header offers "Reconnect", and that click
    // signs in as the owner and asks for a fresh approval.
    if (!e?.keyDropped) try { console.warn("[Cowboy] resume failed; connect again", e); } catch { /* no console */ }
    state.client?.close();
    state = { ...initial(), remembered };
    listeners.forEach((l) => l());
    return false;
  }
}

export async function connect() {
  const provider = deps.findProvider();
  if (!provider) return set({ stage: "no_wallet" });
  if (state.resuming) return undefined;
  resumed = true;
  set({ busy: true, message: null });
  try {
    const wallet = await at("connect", connectWallet(provider));
    state.client?.close();
    const client = deps.createClient({ url: NETWORK.wsUrl });
    write(KEYS.lastWallet(), wallet);
    set({ provider, wallet, client, newAccount: false, loggedAs: null, remembered: wallet });
    watch(provider);
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

/** The accounts to choose from, and the note on the others, for the account Cowboy uses. */
const accountsPatch = (subs, saloon) => ({ subs, choices: fundedAccounts(subs), others: saloon ? otherAccounts(subs, saloon.id) : null });

/**
 * Log in (with the browser's key when there is one: no wallet prompt), then pick the account Cowboy
 * trades from: the key's own; else one labelled "Cowboy"; else the funded PRIME Standard subaccount
 * with the most USDC (approval labels it). The deposit step shows only when none holds USDC.
 */
async function load({ canPrompt = true } = {}) {
  const { client, wallet } = state;
  let stored = usableKey(wallet);
  let sub = null;
  if (stored) {
    try {
      await at("sign in", client.login(wallet, keySign(stored)));
      sub = summarise(await at("find account", client.call("private/get_subaccount", { subaccount_id: stored.subaccount_id })));
    } catch (e) {
      if (!deriveKeyRejected(e, { login: true })) throw e;
      // Derive no longer takes this key (expired, revoked or unknown): drop it so it is never tried
      // again. On a click the owner signs in below and the approve step follows; on a reload, nothing
      // prompts and the seat stays disconnected.
      forgetKey(wallet, client);
      stored = null;
      if (!canPrompt) throw Object.assign(new Error("Cowboy's key was rejected"), { keyDropped: true });
      set({ message: plainError({ code: 14030 }) });
    }
  }
  if (stored) {
    set({ key: stored, loggedAs: "key", newAccount: false });
    // The other accounts, for "Change account": a read the key may not be allowed, so never in the way.
    let subs = [sub];
    try { subs = await listSubaccounts(client, wallet); } catch { /* the key's own account is enough */ }
    if (!subs.some((x) => x.id === sub.id)) subs = [sub, ...subs];
    if (sub.usdc > 0) return set({ saloon: sub, ...accountsPatch(subs, sub), stage: "ready", busy: false });
    const funded = fundedAccounts(subs)[0];
    if (funded) return set({ saloon: funded, ...accountsPatch(subs, funded), stage: "approve", busy: false });
    set(accountsPatch(subs, sub));
    return toFund(sub); // an emptied account still needs its deposit address
  }
  if (!(await ownerLogin())) {
    // No Derive account yet: everything up to the first deposit uses public calls only.
    return toFund(null);
  }
  const { saloon, subs } = await at("find account", findSaloon(client, wallet));
  set(accountsPatch(subs, saloon));
  if (!saloon || !(saloon.usdc > 0)) return toFund(saloon);
  remove(KEYS.sent(wallet));
  set({ saloon, key: null, stage: "approve", busy: false });
}

/**
 * "Use another account": Cowboy trades from the funded subaccount the user picks. No wallet prompt
 * and nothing on Derive changes; the approval that follows is for that account.
 */
export function pickAccount(id) {
  if (state.busy) return;
  const pick = (state.choices || []).find((c) => c.id === id);
  if (!pick) return;
  const ready = state.key?.subaccount_id === pick.id;
  set({ saloon: pick, others: otherAccounts(state.subs || state.choices, pick.id), stage: ready ? "ready" : "approve", message: null });
}

async function toFund(saloon) {
  const { client, wallet } = state;
  const [address, arr] = await at("deposit address", Promise.all([depositAddress(client, wallet, saloon?.id || null), arriving(client, wallet)]));
  set({ saloon, depositAddress: address, ...funding(arr, saloon), ...(saloon ? {} : sentPatch(wallet)), stage: "fund", busy: false });
}

/**
 * Re-read pending deposits and the Saloon account; move on once USDC has landed. A wallet with no
 * Derive account yet is read from public pending deposits while a deposit is still in flight (no
 * wallet prompt); once none is (a "confirmed" one waits only for Derive's sequencer) it signs in, and
 * the account the deposit opened is found and labelled.
 */
export async function refreshFunding() {
  const { client, wallet } = state;
  set({ busy: true, message: null });
  try {
    let arr = null;
    if (state.newAccount) {
      arr = await at("find account", arriving(client, wallet));
      if (arr.count > 0) return set({ ...funding(arr, null), ...sentPatch(wallet), busy: false });
    }
    if (state.loggedAs !== "owner" && !(await ownerLogin())) {
      arr = arr || await at("find account", arriving(client, wallet));
      return set({ saloon: null, ...funding(arr, null), ...sentPatch(wallet), busy: false });
    }
    const had = state.saloon;
    const { saloon, subs } = await at("find account", findSaloon(client, wallet, { prefer: had?.id ?? state.key?.subaccount_id ?? null }));
    const accounts = accountsPatch(subs, saloon);
    if (saloon && saloon.usdc > 0) {
      remove(KEYS.sent(wallet));
      const ready = state.key?.subaccount_id === saloon.id;
      return set({ saloon, ...accounts, opening: 0, sentTx: null, sentAmount: null, sentAt: null, stage: ready ? "ready" : "approve", busy: false });
    }
    // An account that now exists takes its own deposit address (the new-account one would open another).
    const address = saloon && saloon.id !== had?.id ? await at("deposit address", depositAddress(client, wallet, saloon.id)) : state.depositAddress;
    arr = await at("find account", arriving(client, wallet));
    set({ saloon, ...accounts, depositAddress: address, ...funding(arr, saloon), ...(saloon ? {} : sentPatch(wallet)), busy: false });
  } catch (e) { fail(e, "find account"); }
}

/** The wallet's own gas estimate for the deposit, in dollars (ETH priced from the Saloon's ETH board). */
export async function depositGasUsd(dollars, ethUsd) {
  const { provider, wallet, depositAddress: to } = state;
  if (!provider || !to || !ethUsd) return null;
  try { return (await gasEth(provider, usdcTransfer(wallet, to, dollars))) * ethUsd; } catch { return null; }
}

export async function deposit(dollars) {
  const { provider, wallet, depositAddress: to, saloon } = state;
  if (holdSend(state)) return; // one deposit opens the account; a second would open another
  set({ busy: true, message: null });
  try {
    const tx = await sendTransaction(provider, usdcTransfer(wallet, to, dollars));
    const sentAt = Date.now();
    if (!saloon) write(KEYS.sent(wallet), { tx, amount: dollars, to, at: sentAt });
    set({ busy: false, sentTx: tx, sentAmount: dollars, sentAt });
  } catch (e) { fail(e, "deposit"); }
}

/**
 * Approve Cowboy for the account in view: one signature for the grant (plus a sign-in when the page
 * is not signed in as the owner). Only after Derive accepts it is the account labelled "Cowboy", so a
 * declined signature leaves the user's account as it was.
 */
export async function approve() {
  const { client, provider, wallet, saloon } = state;
  if (!saloon) return;
  set({ busy: true, message: null });
  try {
    if (state.loggedAs !== "owner") {
      await at("sign in", client.login(wallet, ownerSign(provider, wallet)));
      set({ loggedAs: "owner" });
    }
    const stored = await at("approve", approveCowboy({ client, provider, owner: wallet, subaccountId: saloon.id, ...(deps.newKey ? { newKey: deps.newKey } : {}) }));
    rememberAccount(wallet, saloon.id);
    let labelled = saloon;
    let subs = state.subs || [saloon];
    try {
      labelled = await labelAccount(client, subs, saloon);
      subs = subs.map((x) => (x.id === labelled.id ? labelled : x.label === SALOON_LABEL ? { ...x, label: "" } : x));
    } catch (e) {
      try { console.warn("[Cowboy] the account label was not set; this browser remembers the account", e); } catch { /* no console */ }
    }
    await at("sign in", client.login(wallet, keySign(stored))); // later calls sign in with the key, without wallet prompts
    set({ key: stored, saloon: labelled, subs, choices: fundedAccounts(subs), loggedAs: "key", stage: "ready", busy: false });
  } catch (e) { fail(e, "approve"); }
}

/** This browser's copy of the key goes, and the connection stops signing in with it. */
function forgetKey(wallet, client) {
  if (wallet) clearKey(wallet);
  client?.logout();
}

/**
 * Derive rejected Cowboy's key in use (a ticket got 14023/14026/14030, or an RFQ cancelled for
 * "session_key_deregistered"): drop it and go to the approve step. Nothing prompts here; Approve is
 * the user's click and signs in as the owner first.
 */
export function dropKey(message = plainError({ code: 14030 })) {
  if (!state.wallet) return;
  forgetKey(state.wallet, state.client);
  set({ key: null, loggedAs: null, busy: false, stage: state.stage === "ready" ? "approve" : state.stage, message });
}

export const SWITCHED_OFF = {
  deleted: "Cowboy's key is deleted from this browser, so nothing can trade with it here.",
  told: "Derive retires it within 15 minutes.",
  untold: "Derive was not told to retire it; it ends by itself within 7 days.",
};

/**
 * Switch off: the browser's key goes first, whatever the wallet or Derive answer next, so the message
 * that says so is always true and neither a reload nor a reconnect can bring it back. Then, with the
 * owner's signature, Derive is told to retire it; the message says separately whether it was.
 */
export async function switchOff() {
  const { client, provider, wallet, key } = state;
  remove(KEYS.lastWallet()); // nothing to resume without the key
  if (wallet) clearKey(wallet);
  set({ key: null, busy: true, message: null });
  if (!key || !client) return set({ stage: state.saloon ? "approve" : state.stage, busy: false, message: SWITCHED_OFF.deleted });
  try {
    await at("sign in", client.login(wallet, ownerSign(provider, wallet)));
    set({ loggedAs: "owner" });
    await at("switch off", retireKey({ client, provider, owner: wallet, stored: key }));
    set({ stage: "approve", busy: false, message: `Switched off. ${SWITCHED_OFF.deleted} ${SWITCHED_OFF.told}` });
  } catch (e) {
    if (state.loggedAs !== "owner") { client.logout(); set({ loggedAs: null }); }
    const f = failure(e, "switch off");
    set({ stage: "approve", busy: false, message: `${SWITCHED_OFF.deleted} ${SWITCHED_OFF.untold} ${f.message}`, detail: f.detail });
  }
}

export function disconnect() {
  remove(KEYS.lastWallet());
  end(null);
}
