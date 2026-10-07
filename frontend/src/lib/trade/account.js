// Saloon stage 2, P3: the Derive account Cowboy trades from. It is a subaccount of the user's own
// wallet under PRIME's Standard manager: one already funded (for example from Derive's faucet), chosen
// by the user, or the one the first deposit through Cowboy opens. It is labelled "Cowboy" once the user
// approves Cowboy for it.
import { CONFIRMED_STALE_MS, DEPOSIT_MIN, DEPOSIT_SUGGESTED, GAS_WARN_SHARE, NETWORK, PRIME_STANDARD, SALOON_LABEL } from "./config.js";
import { KEYS, read, write } from "./store.js";

const num = (v) => (v == null || v === "" ? null : Number(v));

/** One subaccount as the Saloon needs it: id, label, manager and its USDC. */
export function summarise(sub) {
  const usdc = (sub.collaterals || []).find((c) => c.asset_name === "USDC" || c.currency === "USDC");
  return {
    id: sub.subaccount_id, label: sub.label || "", manager: sub.manager_id,
    usdc: usdc ? num(usdc.amount) : 0, usdcSince: usdc ? num(usdc.creation_timestamp) : null, value: num(sub.subaccount_value), positions: (sub.positions || []).length,
  };
}

/** Every subaccount of the logged-in wallet, summarised. */
export async function listSubaccounts(client, wallet) {
  const { subaccount_ids: ids = [] } = await client.call("private/get_subaccounts", { wallet });
  const subs = await Promise.all(ids.map((id) => client.call("private/get_subaccount", { subaccount_id: id })));
  return subs.map(summarise);
}

/** The Saloon account: labelled "Cowboy" under PRIME Standard (the lowest id if there are several). */
export function pickSaloon(subs) {
  return subs.filter((s) => s.label === SALOON_LABEL && s.manager === PRIME_STANDARD).sort((a, b) => a.id - b.id)[0] || null;
}

/** PRIME Standard subaccounts holding USDC, most USDC first (ties: the lowest id). */
export function fundedAccounts(subs) {
  return subs.filter((s) => s.manager === PRIME_STANDARD && s.usdc > 0).sort((a, b) => b.usdc - a.usdc || a.id - b.id);
}

/**
 * The account Cowboy trades from, in this order: the one asked for (`prefer`: the account in view or
 * the browser key's), the one labelled "Cowboy", the one this browser approved last (`remembered`),
 * then the PRIME Standard subaccount with the most USDC, each while it holds USDC. With none funded,
 * the same order picks the account a deposit goes to, else the lowest-id PRIME Standard subaccount;
 * null when the wallet has none (a deposit then opens one).
 */
export function chooseAccount(subs, { prefer = null, remembered = null } = {}) {
  const prime = subs.filter((s) => s.manager === PRIME_STANDARD);
  const byId = (id) => (id == null ? null : prime.find((s) => s.id === id) || null);
  const order = [byId(prefer), pickSaloon(prime), byId(remembered)].filter(Boolean);
  const funded = fundedAccounts(prime);
  return order.find((s) => s.usdc > 0) || funded[0] || order[0] || [...prime].sort((a, b) => a.id - b.id)[0] || null;
}

/** Other PRIME Standard subaccounts holding USDC besides the one Cowboy uses (no funds move). */
export function otherAccounts(subs, saloonId) {
  const rest = fundedAccounts(subs).filter((s) => s.id !== saloonId);
  return rest.length ? { count: rest.length, usdc: rest.reduce((a, s) => a + s.usdc, 0), ids: rest.map((s) => s.id) } : null;
}

/** The subaccount this browser approved Cowboy for last (a fallback when its label could not be set). */
export const rememberAccount = (wallet, id) => write(KEYS.account(wallet), { id, at: Date.now() });
export const rememberedAccount = (wallet) => read(KEYS.account(wallet))?.id ?? null;

/**
 * Read the wallet's subaccounts and pick the one Cowboy uses (an owner-login call). Nothing is
 * labelled here: the label is set only once the user has approved Cowboy for that account.
 * `choices` are the funded PRIME Standard subaccounts the user can pick from.
 */
export async function findSaloon(client, wallet, { prefer = null } = {}) {
  const subs = await listSubaccounts(client, wallet);
  const saloon = chooseAccount(subs, { prefer, remembered: rememberedAccount(wallet) });
  return { saloon, subs, choices: fundedAccounts(subs), others: saloon ? otherAccounts(subs, saloon.id) : null };
}

/**
 * After the approval: label the chosen subaccount "Cowboy" when it has no label of its own, and take
 * the label off any other subaccount Cowboy used before. A label the user gave stays. Needs an owner
 * login. Returns the chosen account as labelled.
 */
export async function labelAccount(client, subs, chosen) {
  for (const s of subs) {
    if (s.id !== chosen.id && s.label === SALOON_LABEL) await client.call("private/change_subaccount_label", { subaccount_id: s.id, label: "" });
  }
  if (chosen.label) return chosen;
  await client.call("private/change_subaccount_label", { subaccount_id: chosen.id, label: SALOON_LABEL });
  return { ...chosen, label: SALOON_LABEL };
}

/**
 * Derive's deposit address. With no PRIME Standard subaccount it creates a new one (subaccount 0);
 * otherwise it tops up the account Cowboy uses.
 */
export function depositParams(wallet, saloonId = null) {
  return saloonId ? { wallet, subaccount_id: saloonId } : { wallet, subaccount_id: 0, manager_id: PRIME_STANDARD };
}
export async function depositAddress(client, wallet, saloonId = null) {
  const r = await client.call("public/register_deposit_address", depositParams(wallet, saloonId));
  return r.deposit_address;
}

/**
 * Derive's deposit assets by address (lower case): each collateral's own address and the ERC-20 behind
 * it, with its name and decimals, from public/get_risk_universes. Read once per page; if the read fails
 * the testnet's USDC from config stands in, and the next call tries again.
 */
let assetsOnce = null;
const FALLBACK_ASSETS = () => new Map([NETWORK.usdcAsset, NETWORK.usdc].filter(Boolean)
  .map((a) => [a.toLowerCase(), { name: "USDC", decimals: NETWORK.usdcDecimals ?? 6 }]));
export function assetMap(universes) {
  const map = FALLBACK_ASSETS();
  for (const u of universes || []) for (const m of u.managers || []) for (const c of m.collaterals || []) {
    const decimals = c.erc20?.decimals;
    if (!Number.isInteger(decimals)) continue;
    for (const a of [c.address, c.erc20?.underlying_erc20]) if (a) map.set(a.toLowerCase(), { name: c.name, decimals });
  }
  return map;
}
export function depositAssets(client) {
  if (!assetsOnce) {
    assetsOnce = client.call("public/get_risk_universes", {}).then(assetMap, () => { assetsOnce = null; return FALLBACK_ASSETS(); });
  }
  return assetsOnce;
}
export const _resetAssets = () => { assetsOnce = null; };

/** Still travelling: not yet past Derive's L1 confirmations (`confirmed`) and not `reverted`. */
const IN_FLIGHT = (status) => status !== "confirmed" && status !== "reverted";

/**
 * USDC deposits Derive lists for this wallet, in dollars. `asset` is an address and `amount` is in the
 * token's own units (6 decimals for USDC). Derive lists a deposit until its sequencer applies it, but a
 * `confirmed` row (past L1 confirmations, waiting only for the sequencer) can stay listed after that,
 * so it is counted apart (`landing`, fresh rows only) and never as still in flight: the account it
 * opens is looked for by signing in. `opening` counts deposits to the new-account address (in flight
 * or freshly confirmed), which open an account each.
 */
export async function arriving(client, wallet, { now = Date.now() } = {}) {
  const [{ pending_deposits: list = [] }, assets] = await Promise.all([client.call("public/get_pending_deposits", { wallet }), depositAssets(client)]);
  const out = { amount: 0, count: 0, landing: 0, landingCount: 0, opening: 0, openingCount: 0, list };
  for (const d of list) {
    const asset = assets.get(String(d.asset || d.bridge_to_l1?.token || "").toLowerCase());
    if (["failed", "expired"].includes(d.bridge_to_l1?.bridge_status)) continue;
    if (!asset || asset.name !== "USDC" || d.status === "reverted") continue;
    const raw = num(d.amount) ?? num(d.bridge_to_l1?.expected_amount);
    const dollars = raw != null && Number.isFinite(raw) ? raw / 10 ** asset.decimals : 0;
    const fresh = IN_FLIGHT(d.status) || now - (d.updated_at_ms ?? d.timestamp ?? 0) < CONFIRMED_STALE_MS;
    if (IN_FLIGHT(d.status)) { out.amount += dollars; out.count += 1; } else if (fresh) { out.landing += dollars; out.landingCount += 1; }
    if (fresh && d.action_type === "DepositToNewSubaccount") { out.opening += dollars; out.openingCount += 1; }
  }
  return out;
}

/** The deposit checks: refuse under $10, suggest $50 or more, and say when gas is over 5% of it. */
export function depositCheck(dollars, gasUsd = null) {
  if (!(dollars > 0)) return { ok: false, reason: "empty" };
  if (dollars < DEPOSIT_MIN) return { ok: false, reason: "min", min: DEPOSIT_MIN };
  const share = gasUsd != null && Number.isFinite(gasUsd) ? gasUsd / dollars : null;
  return { ok: true, small: dollars < DEPOSIT_SUGGESTED, gasWarn: share != null && share > GAS_WARN_SHARE, share, gasUsd };
}
