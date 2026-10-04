// Saloon stage 2, P3: the user's Saloon account on Derive. It is a subaccount of the user's own
// wallet under PRIME's Standard manager, created by the first deposit through Cowboy and labelled
// "Cowboy", so Saloon money stays apart from anything else the user holds on Derive.
import { CONFIRMED_STALE_MS, DEPOSIT_MIN, DEPOSIT_SUGGESTED, GAS_WARN_SHARE, NETWORK, PRIME_STANDARD, SALOON_LABEL } from "./config.js";
import { KEYS, read, write } from "./store.js";

const num = (v) => (v == null || v === "" ? null : Number(v));

/** One subaccount as the Saloon needs it: id, label, manager and its USDC. */
export function summarise(sub) {
  const usdc = (sub.collaterals || []).find((c) => c.asset_name === "USDC" || c.currency === "USDC");
  return {
    id: sub.subaccount_id, label: sub.label || "", manager: sub.manager_id,
    usdc: usdc ? num(usdc.amount) : 0, value: num(sub.subaccount_value), positions: (sub.positions || []).length,
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

/**
 * After the first deposit: the new, unlabelled PRIME Standard subaccount that was not there before.
 * When there are several (two deposits to the new-account address each open one), the lowest id that
 * holds USDC; subaccounts the wallet had before are never claimed.
 */
export function findNew(subs, knownIds) {
  const fresh = freshSubs(subs, knownIds);
  if (fresh.length === 1) return fresh[0];
  return fresh.filter((s) => s.usdc > 0).sort((a, b) => a.id - b.id)[0] || null;
}
const freshSubs = (subs, knownIds) => {
  const known = new Set(knownIds || []);
  return subs.filter((s) => s.manager === PRIME_STANDARD && !s.label && !known.has(s.id));
};

/** Other new, unlabelled PRIME Standard subaccounts holding USDC besides the Saloon account (no funds move). */
export function otherAccounts(subs, knownIds, saloonId) {
  const rest = freshSubs(subs, knownIds).filter((s) => s.id !== saloonId && s.usdc > 0);
  return rest.length ? { count: rest.length, usdc: rest.reduce((a, s) => a + s.usdc, 0), ids: rest.map((s) => s.id) } : null;
}

/** Remember the wallet's subaccounts before the first deposit, so the new one can be told apart. */
export const rememberKnown = (wallet, subs) => write(KEYS.known(wallet), subs.map((s) => s.id));
export const knownIds = (wallet) => read(KEYS.known(wallet)) || [];

/** Find the Saloon account, labelling a newly funded one "Cowboy" (an owner-login call). */
export async function findSaloon(client, wallet) {
  const subs = await listSubaccounts(client, wallet);
  const known = knownIds(wallet);
  const saloon = pickSaloon(subs);
  if (saloon) return { saloon, subs, others: otherAccounts(subs, known, saloon.id) };
  const fresh = findNew(subs, known);
  if (fresh) {
    await client.call("private/change_subaccount_label", { subaccount_id: fresh.id, label: SALOON_LABEL });
    return { saloon: { ...fresh, label: SALOON_LABEL }, subs, others: otherAccounts(subs, known, fresh.id) };
  }
  return { saloon: null, subs, others: null };
}

/**
 * Derive's deposit address for the Saloon account. Before the account exists it creates a new
 * subaccount under PRIME Standard (subaccount 0); afterwards it tops up the Saloon account.
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
    const asset = assets.get(String(d.asset || "").toLowerCase());
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
