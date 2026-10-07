// Saloon stage 2: the user's seat at Derive for this page visit: the wallet, one Derive connection,
// the Saloon account and Cowboy's approval. One store per page, shared by every ticket.
import { useSyncExternalStore } from "react";
import { formatUnits, getAddress } from "ethers";
import { MODE, NETWORK, PRIME_STANDARD, SALOON_LABEL, SENT_HOLD_MS, TRADE_COINS } from "./config.js";
import { forgetPilotInvite, isPilot } from "../pilot.js";
import { NO_ACCOUNT, at, createClient, deriveKeyRejected, failure, plainError } from "./derive.js";
import { arriving, depositAddress, findSaloon, fundedAccounts, labelAccount, listSubaccounts, otherAccounts, rememberAccount, summarise } from "./account.js";
import { connectWallet, findProvider, gasEth, personalSign, sendTransaction, usdcTransfer } from "./wallet.js";
import { approveCowboy, clearKey, keySigner, switchOff as retireKey, usableKey } from "./sessionKey.js";
import { KEYS, read, remove, write } from "./store.js";
import { FUND_ANYCHAIN } from "../flags.js";
import { NATIVE_TOKEN, FUNDING_QUOTE_MS, bridgeRegistration, fundingError, fundingMinimum, fundingQuote, fundingRecovery, fundingStatus, validateFundingQuote } from "./anychain.js";
import { fundingAllowance, fundingApproval, fundingPreflight, fundingReceipt, fundingWalletIdentity, switchFundingChain } from "./wallet.js";

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
let generation = 0;
let fundingLease = null;
let bridgeAuth = null;
let ownerAuth = null;
let bridgeRefresh = null;
const cancelled = () => Object.assign(new Error("Seat operation cancelled"), { name: "AbortError" });
/** Each user operation owns its results. Ending or replacing the seat invalidates every older await. */
function operation({ advance = true } = {}) {
  const id = advance ? ++generation : generation;
  const active = () => id === generation;
  const assertActive = () => { if (!active()) throw cancelled(); };
  const run = async (step, action) => {
    assertActive();
    try { const result = await at(step, action()); assertActive(); return result; }
    catch (e) { assertActive(); throw e; }
  };
  const client = (c) => ({
    call: (method, params, opts = {}) => { assertActive(); return c.call(method, params, { ...opts, assertActive }); },
    login: (wallet, sign) => { assertActive(); return c.login(wallet, sign, { assertActive }); },
    logout: () => { assertActive(); c.logout(); },
  });
  return { active, assertActive, run, client, set: (patch) => { assertActive(); set(patch); },
    fail: (e, step) => { if (active()) fail(e, step); } };
}
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
export function _setSeatDeps(d) { generation += 1; state.client?.close(); deps = { ...deps, ...d }; unwatch(); resumed = false; ownerAuth = null; bridgeAuth = null; fundingLease = null; bridgeRefresh = null; state = initial(); pub?.close(); pub = null; listeners.forEach((l) => l()); }
export function _setSeatState(s) { generation += 1; state = { ...initial(), ...s }; listeners.forEach((l) => l()); }

/** A connection for public reads (the testnet's instrument list): the seat's own when it has one,
 * else one shared, never logged in. */
let pub = null;
export function publicClient() {
  if (state.client) return state.client;
  pub = pub || deps.createClient({ url: NETWORK.wsUrl });
  return pub;
}

/** Real money (mainnet builds): only the pilot's wallets take a seat. Other builds: every wallet. */
export const pilotAllows = (wallet) => MODE !== "mainnet" || isPilot(wallet);
export const NOT_PILOT = "One-tap trading is open to a few test wallets for now.";

export const canTrade = (und) => typeof und === "string" && /^[A-Z0-9]+$/.test(und) && (TRADE_COINS === "all" || TRADE_COINS.includes(und));
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
const pendingBridge = (bridge) => !!bridge && (!!bridge.txHash || bridge.phase === "sending_unknown");

/** A deposit this browser sent to the new-account address, kept for SENT_HOLD_MS (reloads too). */
function sentNew(wallet, now = Date.now()) {
  const s = read(KEYS.sent(wallet));
  return s && now - s.at < SENT_HOLD_MS ? s : null;
}
const sentPatch = (wallet) => {
  const s = sentNew(wallet);
  const saved = FUND_ANYCHAIN ? read(KEYS.bridge(wallet)) : null;
  const bridge = saved?.quote?.request?.wallet?.toLowerCase() === wallet.toLowerCase() && (saved.txHash || saved.phase === "sending_unknown") ? saved : null;
  return { ...(s ? { sentTx: s.tx, sentAmount: s.amount, sentAt: s.at } : {}), ...(bridge ? { bridge, sentTx: bridge.txHash, sentAmount: bridge.quote.arrivesUsd, sentAt: bridge.startedAt } : {}) };
};

/** True while another send to the new-account address would open a second account. */
export function holdSend(seat, now = Date.now()) {
  if (FUND_ANYCHAIN && seat.bridge?.phase === "sending_unknown") return true;
  if (FUND_ANYCHAIN && seat.bridge?.txHash && !["credited", "refunded_verified"].includes(seat.bridge.phase)) return true;
  if (seat.saloon) return false;
  return (seat.opening || 0) > 0 || (!!seat.sentTx && now - (seat.sentAt || 0) < SENT_HOLD_MS);
}

const ownerSign = (provider, wallet) => async (timestamp) => {
  const id = generation;
  const signature = await personalSign(provider, wallet, timestamp);
  if (id === generation && state.wallet?.toLowerCase() === wallet.toLowerCase()) ownerAuth = { wallet, timestamp, signature };
  return signature;
};
const keySign = (stored) => (ts) => keySigner(stored).signMessage(ts);

/**
 * The wallet's own events. Another account, or none, ends the seat; so does leaving Sepolia (the seat
 * never switches network by itself). Added once per connection, removed on disconnect.
 */
let watched = null;
function watch(provider, pending = null) {
  if ((watched?.provider === provider && !pending) || typeof provider?.on !== "function") return;
  unwatch();
  const accountsChanged = (accounts) => {
    const list = (accounts || []).map((a) => String(a).toLowerCase());
    const wallet = state.wallet || (pending?.active() ? pending.wallet : null);
    if (!wallet && pending?.active() && list.length) { pending.accounts = list; return; }
    if (!wallet && !pending?.active()) return;
    if (wallet && list.includes(wallet.toLowerCase())) return;
    if (list.length) remove(KEYS.lastWallet()); // another account: forget this one; none (locked): keep it
    end(null);
  };
  const chainChanged = (chainId) => {
    if (!state.wallet && !pending?.active()) return;
    if (fundingLease?.flow.active() && fundingLease.provider === provider) {
      if (Number(chainId) === fundingLease.chainId) return;
      return end("Your wallet switched away from the funding network. Connect again to check the transfer.");
    }
    if (Number(chainId) === NETWORK.chainId) return;
    end(`Your wallet switched network. Connect again on ${NETWORK.chainName}.`);
  };
  provider.on("accountsChanged", accountsChanged);
  provider.on("chainChanged", chainChanged);
  const disconnected = () => { if (state.wallet || pending?.active()) end("Your wallet disconnected. Connect again to continue."); };
  provider.on("disconnect", disconnected);
  watched = { provider, accountsChanged, chainChanged, disconnected };
}
function unwatch() {
  if (!watched) return;
  const { provider, accountsChanged, chainChanged, disconnected } = watched;
  watched = null;
  try {
    provider.removeListener?.("accountsChanged", accountsChanged);
    provider.removeListener?.("chainChanged", chainChanged);
    provider.removeListener?.("disconnect", disconnected);
  } catch { /* the wallet went away */ }
}
/** Back to "disconnected" (the remembered wallet stays unless the caller forgot it), with a message. */
function end(message) {
  generation += 1;
  fundingLease = null;
  bridgeAuth = null;
  ownerAuth = null;
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
  if (!provider || !remembered || state.wallet || !pilotAllows(remembered)) { set({ resuming: false, busy: false }); return false; }
  const flow = operation();
  flow.wallet = remembered;
  watch(provider, flow);
  const quiet = () => { flow.set({ resuming: false, busy: false }); unwatch(); return false; };
  flow.set({ resuming: true, busy: true, remembered });
  try {
    const accounts = (await flow.run("connect", () => provider.request({ method: "eth_accounts" }))) || [];
    if (!accounts.some((a) => String(a).toLowerCase() === remembered.toLowerCase())) return quiet();
    if (Number(await flow.run("connect", () => provider.request({ method: "eth_chainId" }))) !== NETWORK.chainId) return quiet();
    const wallet = getAddress(remembered);
    if (!usableKey(wallet) || !termsAccepted()) return quiet();
    const client = deps.createClient({ url: NETWORK.wsUrl });
    flow.set({ provider, wallet, client, newAccount: false, loggedAs: null });
    await flow.run("sign in", () => load(flow, { canPrompt: false }));
    flow.set({ resuming: false });
    return true;
  } catch (e) {
    if (!flow.active()) return false;
    // A key Derive no longer takes is already dropped: the header offers "Reconnect", and that click
    // signs in as the owner and asks for a fresh approval.
    if (!e?.keyDropped) try { console.warn("[Cowboy] resume failed; connect again", e); } catch { /* no console */ }
    unwatch();
    state.client?.close();
    state = { ...initial(), remembered };
    listeners.forEach((l) => l());
    return false;
  }
}

export async function connect() {
  if (state.resuming) return undefined;
  const provider = deps.findProvider();
  resumed = true;
  end(null);
  if (!provider) return set({ stage: "no_wallet", busy: false, resuming: false });
  const flow = operation();
  watch(provider, flow);
  // connectWallet has several requests before the seat knows its wallet. Stop between those requests,
  // and reconcile an initial accountsChanged event with the account the access request returned.
  const guardedProvider = { request: async (args) => {
    const result = await flow.run("connect", () => provider.request(args));
    if (args.method === "eth_requestAccounts" && result?.[0]) {
      flow.wallet = String(result[0]);
      if (flow.accounts && !flow.accounts.includes(flow.wallet.toLowerCase())) {
        end(null); flow.assertActive();
      }
    }
    return result;
  } };
  flow.set({ busy: true, message: null });
  try {
    const wallet = await flow.run("connect", () => connectWallet(guardedProvider));
    if (!pilotAllows(wallet)) {
      // Real money: one tap is open only to the pilot's wallets. Nothing is signed or remembered, and
      // this browser goes back to placing orders by hand.
      forgetPilotInvite();
      remove(KEYS.lastWallet());
      unwatch();
      return flow.set({ stage: "not_pilot", busy: false, wallet: null, message: NOT_PILOT });
    }
    const client = deps.createClient({ url: NETWORK.wsUrl });
    write(KEYS.lastWallet(), wallet);
    flow.set({ provider, wallet, client, newAccount: false, loggedAs: null, remembered: wallet });
    if (!termsAccepted()) return flow.set({ stage: "terms", busy: false });
    await flow.run("sign in", () => load(flow));
  } catch (e) {
    if (flow.active() && !state.wallet) unwatch();
    flow.fail(e, "connect");
  }
}

export async function acceptTerms() {
  if (!state.wallet || !state.client || state.busy) return;
  const flow = operation();
  write(KEYS.terms(), { at: Date.now() });
  flow.set({ busy: true });
  try { await flow.run("sign in", () => load(flow)); } catch (e) { flow.fail(e, "sign in"); }
}

/**
 * Owner sign-in. A wallet Derive has never seen answers 14000 (account not found): Derive opens the
 * account with its first deposit, so that is not a failure. Returns false then, and the connection
 * forgets the sign-in so later public calls do not repeat it.
 */
async function ownerLogin(flow) {
  flow.assertActive();
  const { wallet, provider } = state;
  const client = flow.client(state.client);
  try {
    await flow.run("sign in", () => client.login(wallet, ownerSign(provider, wallet)));
  } catch (e) {
    if (e?.code !== NO_ACCOUNT) throw e;
    client.logout();
    flow.set({ loggedAs: null, newAccount: true });
    return false;
  }
  flow.set({ loggedAs: "owner", newAccount: false });
  return true;
}

/** The accounts to choose from, and the note on the others, for the account Cowboy uses. */
const accountsPatch = (subs, saloon) => ({ subs, choices: fundedAccounts(subs), others: saloon ? otherAccounts(subs, saloon.id) : null });

/**
 * Log in (with the browser's key when there is one: no wallet prompt), then pick the account Cowboy
 * trades from: the key's own; else one labelled "Cowboy"; else the funded PRIME Standard subaccount
 * with the most USDC (approval labels it). The deposit step shows only when none holds USDC.
 */
async function load(flow, { canPrompt = true } = {}) {
  flow.assertActive();
  const { wallet } = state;
  const client = flow.client(state.client);
  if (FUND_ANYCHAIN) flow.set(sentPatch(wallet));
  let stored = usableKey(wallet);
  let sub = null;
  if (stored) {
    try {
      await flow.run("sign in", () => client.login(wallet, keySign(stored)));
      sub = summarise(await flow.run("find account", () => client.call("private/get_subaccount", { subaccount_id: stored.subaccount_id })));
    } catch (e) {
      if (!deriveKeyRejected(e, { login: true })) throw e;
      // Derive no longer takes this key (expired, revoked or unknown): drop it so it is never tried
      // again. On a click the owner signs in below and the approve step follows; on a reload, nothing
      // prompts and the seat stays disconnected.
      forgetKey(wallet, client, stored.address);
      stored = null;
      if (!canPrompt) throw Object.assign(new Error("Cowboy's key was rejected"), { keyDropped: true });
      flow.set({ message: plainError({ code: 14030 }) });
    }
  }
  if (stored) {
    flow.set({ key: stored, loggedAs: "key", newAccount: false });
    // The other accounts, for "Change account": a read the key may not be allowed, so never in the way.
    let subs = [sub];
    try { subs = await flow.run("find account", () => listSubaccounts(client, wallet)); }
    catch { flow.assertActive(); /* the key's own account is enough */ }
    if (!subs.some((x) => x.id === sub.id)) subs = [sub, ...subs];
    if (sub.usdc > 0) {
      if (FUND_ANYCHAIN && pendingBridge(state.bridge) && !bridgeCredited(state.bridge, sub)) return toFund(flow, sub);
      finishCreditedBridge(flow, wallet, sub);
      return flow.set({ saloon: sub, ...accountsPatch(subs, sub), stage: "ready", busy: false });
    }
    if (FUND_ANYCHAIN && pendingBridge(state.bridge)) {
      flow.set(accountsPatch(subs, sub));
      return toFund(flow, sub);
    }
    const funded = fundedAccounts(subs)[0];
    if (funded) return flow.set({ saloon: funded, ...accountsPatch(subs, funded), stage: "approve", busy: false });
    flow.set(accountsPatch(subs, sub));
    return toFund(flow, sub); // an emptied account still needs its deposit address
  }
  if (!(await flow.run("sign in", () => ownerLogin(flow)))) {
    // No Derive account yet: everything up to the first deposit uses public calls only.
    return toFund(flow, null);
  }
  const { saloon, subs } = await flow.run("find account", () => findSaloon(client, wallet));
  flow.set(accountsPatch(subs, saloon));
  if (!saloon || !(saloon.usdc > 0)) return toFund(flow, saloon);
  if (FUND_ANYCHAIN && pendingBridge(state.bridge) && !bridgeCredited(state.bridge, saloon)) return toFund(flow, saloon);
  finishCreditedBridge(flow, wallet, saloon);
  remove(KEYS.sent(wallet));
  flow.set({ saloon, key: null, stage: "approve", busy: false });
}

/**
 * "Use another account": Cowboy trades from the funded subaccount the user picks. No wallet prompt
 * and nothing on Derive changes; the approval that follows is for that account.
 */
export function pickAccount(id) {
  if (state.busy) return;
  const pick = (state.choices || []).find((c) => c.id === id);
  if (!pick) return;
  generation += 1;
  const ready = state.key?.subaccount_id === pick.id;
  set({ saloon: pick, others: otherAccounts(state.subs || state.choices, pick.id), stage: ready ? "ready" : "approve", message: null });
}

async function toFund(flow, saloon) {
  flow.assertActive();
  const { wallet } = state;
  const client = flow.client(state.client);
  const [address, arr] = await flow.run("deposit address", () => Promise.all([depositAddress(client, wallet, saloon?.id || null), arriving(client, wallet)]));
  flow.set({ saloon, depositAddress: address, ...funding(arr, saloon), ...sentPatch(wallet), stage: "fund", busy: false });
}

/**
 * Re-read pending deposits and the Saloon account; move on once USDC has landed. A wallet with no
 * Derive account yet is read from public pending deposits while a deposit is still in flight (no
 * wallet prompt); once none is (a "confirmed" one waits only for Derive's sequencer) it signs in, and
 * the account the deposit opened is found and labelled.
 */
export async function refreshFunding() {
  if (!state.client || !state.wallet || state.busy) return;
  const flow = operation();
  const { wallet } = state;
  const client = flow.client(state.client);
  flow.set({ busy: true, message: null });
  try {
    if (FUND_ANYCHAIN && state.bridge) {
      if (state.bridge.txHash) {
        try {
          const status = await flow.run("check bridge delivery", () => fundingStatus(state.bridge.quote, state.bridge.txHash));
          bridgePatch(flow, { status, phase: status.phase, statusError: null });
        } catch (e) { flow.assertActive(); bridgePatch(flow, { statusError: plainError(e) }); }
      }
      fundingLease = { flow, provider: state.provider, chainId: NETWORK.chainId };
      await flow.run("return to Ethereum", () => switchFundingChain(state.provider, wallet, { id: NETWORK.chainId }, flow.assertActive));
      fundingLease = null;
    }
    let arr = null;
    if (state.newAccount) {
      arr = await flow.run("find account", () => arriving(client, wallet));
      if (arr.count > 0) return flow.set({ ...funding(arr, null), ...sentPatch(wallet), busy: false });
    }
    if (state.loggedAs !== "owner" && !(await flow.run("sign in", () => ownerLogin(flow)))) {
      arr = arr || await flow.run("find account", () => arriving(client, wallet));
      return flow.set({ saloon: null, ...funding(arr, null), ...sentPatch(wallet), busy: false });
    }
    const had = state.saloon;
    const { saloon, subs } = await flow.run("find account", () => findSaloon(client, wallet, { prefer: had?.id ?? state.key?.subaccount_id ?? null }));
    const accounts = accountsPatch(subs, saloon);
    if (saloon && saloon.usdc > 0) {
      if (FUND_ANYCHAIN && pendingBridge(state.bridge) && !bridgeCredited(state.bridge, saloon)) {
        arr = await flow.run("find account", () => arriving(client, wallet));
        const address = saloon.id !== had?.id ? await flow.run("deposit address", () => depositAddress(client, wallet, saloon.id)) : state.depositAddress;
        return flow.set({ saloon, ...accounts, depositAddress: address, ...funding(arr, saloon), stage: "fund", busy: false });
      }
      remove(KEYS.sent(wallet));
      finishCreditedBridge(flow, wallet, saloon);
      const ready = state.key?.subaccount_id === saloon.id;
      return flow.set({ saloon, ...accounts, opening: 0, sentTx: null, sentAmount: null, sentAt: null, bridge: null, stage: ready ? "ready" : "approve", busy: false });
    }
    // An account that now exists takes its own deposit address (the new-account one would open another).
    const address = saloon && saloon.id !== had?.id ? await flow.run("deposit address", () => depositAddress(client, wallet, saloon.id)) : state.depositAddress;
    arr = await flow.run("find account", () => arriving(client, wallet));
    flow.set({ saloon, ...accounts, depositAddress: address, ...funding(arr, saloon), ...(saloon ? {} : sentPatch(wallet)), busy: false });
  } catch (e) { flow.fail(e, "find account"); }
}

/** The wallet's own gas estimate for the deposit, in dollars (ETH priced from the Saloon's ETH board). */
export async function depositGasUsd(dollars, ethUsd) {
  const id = generation;
  const { provider, wallet, depositAddress: to } = state;
  if (!provider || !to || !ethUsd) return null;
  try { const usd = (await gasEth(provider, usdcTransfer(wallet, to, dollars))) * ethUsd; return id === generation ? usd : null; } catch { return null; }
}

export async function deposit(dollars) {
  const { provider, wallet, depositAddress: to, saloon } = state;
  if (!provider || !wallet || !to || state.busy || holdSend(state)) return; // one deposit opens the account; a second would open another
  const flow = operation();
  flow.set({ busy: true, message: null });
  const startedAt = Date.now();
  try {
    flow.assertActive();
    const tx = await sendTransaction(provider, usdcTransfer(wallet, to, dollars));
    const sentAt = Date.now();
    // The wallet may have broadcast even after Disconnect. Keep its receipt under the original
    // wallet to prevent a second account-opening deposit, without restoring a cancelled seat.
    const previous = read(KEYS.sent(wallet));
    if (!saloon && (!previous || (previous.started_at ?? previous.at) <= startedAt)) {
      write(KEYS.sent(wallet), { tx, amount: dollars, to, at: sentAt, started_at: startedAt });
    }
    if (flow.active()) flow.set({ busy: false, sentTx: tx, sentAmount: dollars, sentAt });
  } catch (e) { flow.fail(e, "deposit"); }
}

function rememberBridgeHistory(wallet, bridge) {
  const previous = read(KEYS.bridgeHistory(wallet)) || [];
  write(KEYS.bridgeHistory(wallet), [bridge, ...previous.filter((b) => b.txHash !== bridge.txHash)].slice(0, 20));
}
function archiveBridge(wallet, bridge) {
  rememberBridgeHistory(wallet, bridge);
  remove(KEYS.bridge(wallet));
}
function bridgeCredited(bridge, saloon) {
  const baseline = bridge.baseline;
  const received = bridge.status?.receiving?.amount;
  return !!baseline && bridge.status?.phase === "delivered" && saloon?.manager === PRIME_STANDARD
    && (baseline.subaccountId == null || saloon.id === baseline.subaccountId)
    && /^\d+$/.test(received || "") && saloon.usdc + 0.000001 >= baseline.usdc + Number(received) / 1e6;
}
function finishCreditedBridge(flow, wallet, saloon) {
  if (!FUND_ANYCHAIN || !state.bridge?.txHash || !bridgeCredited(state.bridge, saloon)) return;
  archiveBridge(wallet, { ...state.bridge, phase: "credited" });
  remove(KEYS.sent(wallet));
  flow.set({ bridge: null, sentTx: null, sentAmount: null, sentAt: null });
}
const bridgePatch = (flow, patch) => {
  flow.assertActive();
  const bridge = { ...state.bridge, ...patch };
  if ((bridge.txHash || bridge.phase === "sending_unknown") && state.wallet) write(KEYS.bridge(state.wallet), bridge);
  flow.set({ bridge });
};
const bridgeIdentity = (quote, snapshot) => {
  if (quote?.request?.wallet?.toLowerCase() !== snapshot.wallet?.toLowerCase()
    || quote?.request?.destination?.address?.toLowerCase() !== snapshot.depositAddress?.toLowerCase()
    || snapshot.saloon?.id !== state.saloon?.id || snapshot.depositAddress !== state.depositAddress) throw fundingError("funding_account");
};
const currentRoute = async (quote, client, paidApprovalUsd = 0) => {
  if (Date.now() > quote.expiresAt) throw fundingError("funding_changed", "This route has expired. Review a new quote.");
  const request = quote.request;
  const next = { ...await (deps.fundingQuote || fundingQuote)({ client, wallet: request.wallet, depositAddress: request.destination.address,
    chain: request.chain, token: request.token, amount: formatUnits(request.fromAmount, request.token.decimals) }) };
  if (paidApprovalUsd > 0) {
    next.costUsd += paidApprovalUsd;
    next.approvalGasUsd = (next.approvalGasUsd || 0) + paidApprovalUsd;
  }
  if (next.minArrivesUsd < quote.minArrivesUsd || next.raw.tool !== quote.raw.tool
    || (quote.costUsd != null && (next.costUsd == null || next.costUsd > quote.costUsd + 0.000000001))
    || next.seconds > Math.max(quote.seconds + 5, quote.seconds * 1.25)) throw fundingError("funding_changed", "The route's minimum, cost or delivery estimate changed. Review a new quote.");
  return next;
};

/** One source transfer after any exact-amount approval; registration never credits or resends it. */
export async function bridgeDeposit(quote) {
  if (!FUND_ANYCHAIN) return;
  if (!NETWORK.real || MODE !== "mainnet") { fail(fundingError("funding_network"), "funding"); return; }
  const snapshot = { ...state };
  if (!snapshot.provider || !snapshot.wallet || !snapshot.depositAddress || !snapshot.client || state.busy || state.stage !== "fund" || holdSend(state)
    || (state.bridge?.txHash && !["refunded_verified", "credited"].includes(state.bridge.phase))) return;
  const flow = operation(), client = flow.client(snapshot.client);
  flow.set({ busy: true, message: null, bridge: { quote, txHash: null, startedAt: Date.now(), phase: "checking", registrationError: null, status: null } });
  try {
    bridgeIdentity(quote, snapshot);
    if (snapshot.client.url !== NETWORK.wsUrl) throw fundingError("funding_network");
    let next = await flow.run("check route", () => currentRoute(quote, client));
    validateFundingQuote(next.raw, next.request, next);
    bridgeIdentity(next, snapshot);
    // A first wallet has no WebSocket login yet. Derive also authenticates private requests from
    // wallet/timestamp/signature params; get this signature before any transfer leaves the wallet.
    bridgeAuth = null;
    fundingLease = { flow, provider: snapshot.provider, chainId: NETWORK.chainId };
    await flow.run("return to Ethereum", () => switchFundingChain(snapshot.provider, snapshot.wallet, { id: NETWORK.chainId }, flow.assertActive));
    if (snapshot.loggedAs !== "owner") {
      if (ownerAuth?.wallet?.toLowerCase() === snapshot.wallet.toLowerCase() && Date.now() - Number(ownerAuth.timestamp) <= FUNDING_QUOTE_MS) bridgeAuth = { ...ownerAuth };
      else {
        bridgePatch(flow, { phase: "sign_in" });
        const timestamp = String(Date.now());
        const signature = await flow.run("sign in for deposit", () => personalSign(snapshot.provider, snapshot.wallet, timestamp));
        bridgeAuth = { wallet: snapshot.wallet, timestamp, signature };
      }
    }
    fundingLease = { flow, provider: snapshot.provider, chainId: next.request.fromChain };
    bridgePatch(flow, { phase: "switching" });
    await flow.run("switch source chain", () => switchFundingChain(snapshot.provider, snapshot.wallet, next.request.chain, flow.assertActive));
    const native = getAddress(next.request.token.address) === getAddress(NATIVE_TOKEN), units = BigInt(next.request.fromAmount);
    let paidApprovalUsd = 0;
    if (!native && !next.raw.estimate.skipApproval) {
      const spender = next.raw.estimate.approvalAddress;
      if (!spender || getAddress(spender) === getAddress(NATIVE_TOKEN)) throw fundingError("funding_route", "The provider omitted its approval contract.");
      const allowance = await flow.run("check token approval", () => fundingAllowance(snapshot.provider, snapshot.wallet, next.request.token.address, spender));
      if (allowance < units) {
        const approval = { ...fundingApproval(snapshot.wallet, next.request.token.address, spender, units), chainId: `0x${next.request.fromChain.toString(16)}` };
        await flow.run("check source balance and gas", () => fundingPreflight(snapshot.provider, snapshot.wallet, next, { approval, assertActive: flow.assertActive }));
        bridgePatch(flow, { phase: "approving" });
        await fundingWalletIdentity(snapshot.provider, snapshot.wallet, next.request.fromChain, flow.assertActive);
        const approvalTx = await flow.run("approve source token", () => sendTransaction(snapshot.provider, approval));
        bridgePatch(flow, { phase: "approval_pending", approvalTx });
        await flow.run("confirm source approval", () => fundingReceipt(snapshot.provider, approvalTx, { assertActive: flow.assertActive }));
        paidApprovalUsd = next.approvalGasUsd || 0;
      }
    }
    next = await flow.run("recheck route", () => currentRoute(quote, client, paidApprovalUsd));
    bridgeIdentity(next, snapshot);
    // A new route can change spender. It must already be approved; never add another unnoticed grant.
    if (!native && !next.raw.estimate.skipApproval && await flow.run("recheck token approval", () => fundingAllowance(snapshot.provider, snapshot.wallet, next.request.token.address, next.raw.estimate.approvalAddress)) < units) throw fundingError("funding_changed", "The route's approval contract changed. Review a new quote.");
    const minimum = await flow.run("recheck deposit minimum", () => fundingMinimum(client));
    validateFundingQuote(next.raw, next.request, minimum);
    await flow.run("check source balance and gas", () => fundingPreflight(snapshot.provider, snapshot.wallet, next, { assertActive: flow.assertActive }));
    if (bridgeAuth && Date.now() - Number(bridgeAuth.timestamp) > FUNDING_QUOTE_MS) throw fundingError("funding_changed", "The deposit sign-in expired before sending. Try again.");
    await fundingWalletIdentity(snapshot.provider, snapshot.wallet, next.request.fromChain, flow.assertActive);
    flow.assertActive(); bridgePatch(flow, { quote: next, phase: "sending" });
    const startedAt = Date.now();
    const rawTx = next.raw.transactionRequest;
    const tx = { from: snapshot.wallet, to: rawTx.to, data: rawTx.data, chainId: `0x${next.request.fromChain.toString(16)}`, value: rawTx.value == null ? "0x0" : `0x${BigInt(rawTx.value).toString(16)}` };
    const baseline = { subaccountId: snapshot.saloon?.id ?? null, usdc: snapshot.saloon?.usdc ?? 0 };
    bridgePatch(flow, { quote: next, phase: "sending_unknown", started_at: startedAt, baseline });
    let txHash;
    try { txHash = await sendTransaction(snapshot.provider, tx); }
    catch (e) {
      // A known rejection proves this request did not broadcast. Other failures retain the intent,
      // since a lost provider response cannot prove that funds stayed in the wallet.
      if (e?.source === "wallet" && [4001, 4100, 4200, 4902].includes(e.code)) {
        const intent = read(KEYS.bridge(snapshot.wallet));
        if (intent?.phase === "sending_unknown" && intent.started_at === startedAt) remove(KEYS.bridge(snapshot.wallet));
        if (flow.active()) bridgePatch(flow, { phase: "error" });
      }
      throw e;
    }
    const registration = bridgeRegistration(next, txHash), sentAt = Date.now();
    // The wallet can finish broadcasting after Disconnect. Preserve the receipt under its original
    // owner, without reviving the old seat or asking that wallet to send again.
    const record = { quote: next, txHash, startedAt: sentAt, started_at: startedAt, baseline, phase: "on_way", registration, registrationError: null, status: null };
    rememberBridgeHistory(snapshot.wallet, record);
    const previousSent = read(KEYS.sent(snapshot.wallet)), previousBridge = read(KEYS.bridge(snapshot.wallet));
    const latestStarted = Math.max(previousSent?.started_at ?? previousSent?.at ?? 0, previousBridge?.started_at ?? previousBridge?.startedAt ?? 0);
    if (latestStarted <= startedAt) {
      if (!snapshot.saloon) write(KEYS.sent(snapshot.wallet), { tx: txHash, amount: next.arrivesUsd, to: snapshot.depositAddress, at: sentAt, started_at: startedAt, bridge: registration });
      write(KEYS.bridge(snapshot.wallet), record);
    }
    if (!flow.active()) return;
    bridgePatch(flow, { quote: next, txHash, startedAt: sentAt, started_at: startedAt, baseline, phase: "registering", registration });
    flow.set({ sentTx: txHash, sentAmount: next.arrivesUsd, sentAt });
    try {
      await flow.run("register bridge deposit", () => client.call("private/register_bridge_deposit", { ...registration, ...(bridgeAuth || {}) }, { skipLogin: true }));
      bridgePatch(flow, { phase: "on_way" });
    } catch (e) {
      if (!flow.active()) return;
      bridgePatch(flow, { phase: "on_way", registrationError: plainError(e) });
    }
    flow.set({ busy: false });
  } catch (e) {
    if (!flow.active()) return;
    bridgePatch(flow, { phase: state.bridge?.txHash ? "on_way" : state.bridge?.phase === "sending_unknown" ? "sending_unknown" : "error" });
    flow.fail(e, "funding");
  }
  // Remain in the fund step on the source chain. The user's Check again returns the wallet to
  // Ethereum before any approval or trading can resume; public polling never prompts the wallet.
}

export function refreshBridge() {
  if (!FUND_ANYCHAIN || !state.bridge?.txHash || !state.client || !state.wallet || state.busy) return;
  if (bridgeRefresh) return bridgeRefresh;
  const flow = operation({ advance: false }), before = state.bridge;
  const pending = (async () => {
    try {
      const client = flow.client(state.client);
      const reads = { call: (method, params, options) => client.call(method, params, { ...options, publicOnly: true }) };
      const [status, arr] = await flow.run("check bridge deposit", () => Promise.all([fundingStatus(before.quote, before.txHash), arriving(reads, state.wallet)]));
      let recovery = { safeToRetry: false };
      if (status.phase === "failed") {
        try { recovery = await flow.run("verify returned funds", () => fundingRecovery(before.quote, status, before.txHash)); }
        catch { flow.assertActive(); }
      }
      bridgePatch(flow, { status, phase: status.phase, statusError: null, ...recovery });
      flow.set(funding(arr, state.saloon));
    } catch (e) { if (flow.active()) bridgePatch(flow, { statusError: plainError(e) }); }
  })().finally(() => { if (bridgeRefresh === pending) bridgeRefresh = null; });
  bridgeRefresh = pending;
  return pending;
}

/** Explicit recovery only after a fresh proof and balance read; the original receipt stays archived. */
export async function dismissRefundedBridge() {
  if (!FUND_ANYCHAIN || !state.bridge?.safeToRetry || !state.client || state.busy) return;
  const flow = operation(), before = state.bridge, wallet = state.wallet;
  flow.set({ busy: true });
  try {
    const status = await flow.run("recheck refund", () => fundingStatus(before.quote, before.txHash));
    const recovery = await flow.run("verify returned funds", () => fundingRecovery(before.quote, status, before.txHash));
    if (!recovery.safeToRetry) throw fundingError("funding_route", "The source refund or failed transaction could not be verified. Nothing new was sent.");
    fundingLease = { flow, provider: state.provider, chainId: NETWORK.chainId };
    await flow.run("return to Ethereum", () => switchFundingChain(state.provider, wallet, { id: NETWORK.chainId }, flow.assertActive));
    archiveBridge(wallet, { ...before, status, ...recovery, phase: "refunded_verified" });
    remove(KEYS.sent(wallet));
    flow.set({ bridge: null, sentTx: null, sentAmount: null, sentAt: null, opening: 0, arriving: 0, busy: false, message: null });
    fundingLease = null;
  } catch (e) { flow.fail(e, "verify returned funds"); }
}

export async function retryBridgeRegistration() {
  if (!FUND_ANYCHAIN || !state.bridge?.registration || !state.client || state.busy) return;
  const flow = operation();
  flow.set({ busy: true });
  try {
    if (bridgeAuth && Date.now() - Number(bridgeAuth.timestamp) > FUNDING_QUOTE_MS) throw fundingError("funding_route", "The transfer was sent. Its display registration could not be retried without a fresh sign-in; Check again still reads the bridge safely.");
    await flow.run("register bridge deposit", () => flow.client(state.client).call("private/register_bridge_deposit", { ...state.bridge.registration, ...(bridgeAuth || {}) }, { skipLogin: true }));
    bridgePatch(flow, { registrationError: null });
  } catch (e) { if (flow.active()) bridgePatch(flow, { registrationError: plainError(e) }); }
  if (flow.active()) flow.set({ busy: false });
}

/**
 * Approve Cowboy for the account in view: one signature for the grant (plus a sign-in when the page
 * is not signed in as the owner). Only after Derive accepts it is the account labelled "Cowboy", so a
 * declined signature leaves the user's account as it was.
 */
export async function approve() {
  const { provider, wallet, saloon } = state;
  if (!saloon || !state.client || !wallet || state.busy) return;
  const flow = operation();
  const client = flow.client(state.client);
  flow.set({ busy: true, message: null });
  try {
    if (state.loggedAs !== "owner") {
      await flow.run("sign in", () => client.login(wallet, ownerSign(provider, wallet)));
      flow.set({ loggedAs: "owner" });
    }
    const stored = await flow.run("approve", () => approveCowboy({ client, provider, owner: wallet, subaccountId: saloon.id, assertActive: flow.assertActive, ...(deps.newKey ? { newKey: deps.newKey } : {}) }));
    rememberAccount(wallet, saloon.id);
    let labelled = saloon;
    let subs = state.subs || [saloon];
    try {
      labelled = await flow.run("approve", () => labelAccount(client, subs, saloon));
      subs = subs.map((x) => (x.id === labelled.id ? labelled : x.label === SALOON_LABEL ? { ...x, label: "" } : x));
    } catch (e) {
      flow.assertActive();
      try { console.warn("[Cowboy] the account label was not set; this browser remembers the account", e); } catch { /* no console */ }
    }
    await flow.run("sign in", () => client.login(wallet, keySign(stored))); // later calls sign in with the key, without wallet prompts
    flow.set({ key: stored, saloon: labelled, subs, choices: fundedAccounts(subs), loggedAs: "key", stage: "ready", busy: false });
  } catch (e) { flow.fail(e, "approve"); }
}

/** This browser's copy of the key goes, and the connection stops signing in with it. */
function forgetKey(wallet, client, address = null) {
  if (wallet) clearKey(wallet, address);
  client?.logout();
}

/**
 * Derive rejected Cowboy's key in use (a ticket got 14023/14026/14030, or an RFQ cancelled for
 * "session_key_deregistered"): drop it and go to the approve step. Nothing prompts here; Approve is
 * the user's click and signs in as the owner first.
 */
export function dropKey(message = plainError({ code: 14030 })) {
  if (!state.wallet) return;
  generation += 1;
  forgetKey(state.wallet, state.client, state.key?.address);
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
  if (state.busy) return;
  const flow = operation();
  const { provider, wallet, key } = state;
  const client = state.client && flow.client(state.client);
  remove(KEYS.lastWallet()); // nothing to resume without the key
  if (wallet) clearKey(wallet, key?.address);
  flow.set({ key: null, busy: true, message: null });
  if (!key || !client) return flow.set({ stage: state.saloon ? "approve" : state.stage, busy: false, message: SWITCHED_OFF.deleted });
  try {
    await flow.run("sign in", () => client.login(wallet, ownerSign(provider, wallet)));
    flow.set({ loggedAs: "owner" });
    await flow.run("switch off", () => retireKey({ client, provider, owner: wallet, stored: key, assertActive: flow.assertActive }));
    flow.set({ stage: "approve", busy: false, message: `Switched off. ${SWITCHED_OFF.deleted} ${SWITCHED_OFF.told}` });
  } catch (e) {
    if (!flow.active()) return;
    if (state.loggedAs !== "owner") { client.logout(); flow.set({ loggedAs: null }); }
    const f = failure(e, "switch off");
    flow.set({ stage: "approve", busy: false, message: `${SWITCHED_OFF.deleted} ${SWITCHED_OFF.untold} ${f.message}`, detail: f.detail });
  }
}

export function disconnect() {
  remove(KEYS.lastWallet());
  end(null);
}
