// Saloon stage 2, P3: the user's Saloon account on Derive. It is a subaccount of the user's own
// wallet under PRIME's Standard manager, created by the first deposit through Cowboy and labelled
// "Cowboy", so Saloon money stays apart from anything else the user holds on Derive.
import { DEPOSIT_MIN, DEPOSIT_SUGGESTED, GAS_WARN_SHARE, PRIME_STANDARD, SALOON_LABEL } from "./config.js";
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

/** After the first deposit: the one new, unlabelled PRIME Standard subaccount that was not there before. */
export function findNew(subs, knownIds) {
  const known = new Set(knownIds || []);
  const fresh = subs.filter((s) => s.manager === PRIME_STANDARD && !s.label && !known.has(s.id));
  return fresh.length === 1 ? fresh[0] : null;
}

/** Remember the wallet's subaccounts before the first deposit, so the new one can be told apart. */
export const rememberKnown = (wallet, subs) => write(KEYS.known(wallet), subs.map((s) => s.id));
export const knownIds = (wallet) => read(KEYS.known(wallet)) || [];

/** Find the Saloon account, labelling a newly funded one "Cowboy" (an owner-login call). */
export async function findSaloon(client, wallet) {
  const subs = await listSubaccounts(client, wallet);
  const saloon = pickSaloon(subs);
  if (saloon) return { saloon, subs };
  const fresh = findNew(subs, knownIds(wallet));
  if (fresh) {
    await client.call("private/change_subaccount_label", { subaccount_id: fresh.id, label: SALOON_LABEL });
    return { saloon: { ...fresh, label: SALOON_LABEL }, subs };
  }
  return { saloon: null, subs };
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

/** USDC on its way into Derive for this wallet (not yet confirmed or reverted), in dollars. */
export async function arriving(client, wallet) {
  const { pending_deposits: list = [] } = await client.call("public/get_pending_deposits", { wallet });
  const open = list.filter((d) => !["confirmed", "reverted"].includes(d.status) && (d.asset || "").toUpperCase().includes("USDC"));
  return { amount: open.reduce((a, d) => a + (num(d.amount) || num(d.bridge_to_l1?.expected_amount) || 0), 0), count: open.length, list };
}

/** The deposit checks: refuse under $10, suggest $50 or more, and say when gas is over 5% of it. */
export function depositCheck(dollars, gasUsd = null) {
  if (!(dollars > 0)) return { ok: false, reason: "empty" };
  if (dollars < DEPOSIT_MIN) return { ok: false, reason: "min", min: DEPOSIT_MIN };
  const share = gasUsd != null && Number.isFinite(gasUsd) ? gasUsd / dollars : null;
  return { ok: true, small: dollars < DEPOSIT_SUGGESTED, gasWarn: share != null && share > GAS_WARN_SHARE, share, gasUsd };
}
