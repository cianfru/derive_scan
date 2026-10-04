// Saloon stage 2, P4: approving Cowboy. The browser makes a new key; the user's wallet signs one grant:
// RFQ option trading only, in the Saloon account only, for 7 days. The key stays in this browser.
import { KEY_DAYS, KEY_LABEL, NETWORK, RFQ_OPTION_SCOPE, SWITCH_OFF_SEC } from "./config.js";
import { buildSetSessionKey, keyFromSecret, makeKey, randomNonce } from "./sign.js";
import { signTypedData } from "./wallet.js";
import { KEYS, read, remove, write } from "./store.js";

const nowSec = () => Math.floor(Date.now() / 1000);

/** The one grant Cowboy ever asks for. */
export function grantFor(subaccountId, now = nowSec()) {
  return {
    protocol_scopes: [RFQ_OPTION_SCOPE], offchain_scopes: [], subaccount_ids: [subaccountId],
    expiry_sec: Math.floor(now) + KEY_DAYS * 86400, label: KEY_LABEL,
  };
}

/** Refuse anything wider: exactly one subaccount, exactly the RFQ option scope, at most 7 days. */
export function assertGrant(g, now = nowSec()) {
  const fail = (why) => { throw Object.assign(new Error(`grant refused: ${why}`), { code: "grant_refused" }); };
  if (!Array.isArray(g.subaccount_ids) || g.subaccount_ids.length !== 1) fail("exactly one subaccount");
  if (!Number.isSafeInteger(g.subaccount_ids[0]) || g.subaccount_ids[0] <= 0) fail("a real subaccount");
  if (!Array.isArray(g.protocol_scopes) || g.protocol_scopes.length !== 1 || g.protocol_scopes[0] !== RFQ_OPTION_SCOPE) fail("RFQ option trading only");
  if ((g.offchain_scopes || []).length) fail("no off-chain scopes");
  if (!(g.expiry_sec >= now + 300) || g.expiry_sec > now + KEY_DAYS * 86400 + 60) fail("at most 7 days");
  return true;
}

/** Derive's answer must echo exactly what was granted. */
export function echoMatches(res, grant) {
  return JSON.stringify(res?.protocol_scopes) === JSON.stringify(grant.protocol_scopes)
    && JSON.stringify((res?.subaccount_ids || []).map(Number)) === JSON.stringify(grant.subaccount_ids);
}

export const loadKey = (wallet) => read(KEYS.key(wallet));
export const clearKey = (wallet) => remove(KEYS.key(wallet));
/** The browser's key, usable while it has more than a minute left. */
export function usableKey(wallet, now = nowSec()) {
  const k = loadKey(wallet);
  return k && k.expiry_sec > now + 60 && k.secret ? k : null;
}
export const keySigner = (stored) => keyFromSecret(stored.secret);

/**
 * Approve Cowboy: make a key, have the wallet sign the grant (after the plain-English panel), send it
 * to Derive and keep the key only if Derive echoes exactly that grant.
 */
export async function approveCowboy({ client, provider, owner, subaccountId, now = nowSec(), newKey = makeKey, chainId = NETWORK.chainId }) {
  const grant = grantFor(subaccountId, now);
  assertGrant(grant, now);
  const key = newKey();
  const built = buildSetSessionKey({ owner, sessionKey: key.address, grant, nonce: randomNonce(now * 1000), signatureExpirySec: now + 600, chainId });
  const signature = await signTypedData(provider, owner, built.typedData);
  const res = await client.call("private/set_session_key", built.params(signature), { safe: false });
  if (!echoMatches(res, grant)) {
    await retire({ client, provider, owner, address: key.address, grant, now }).catch(() => {});
    throw Object.assign(new Error("Derive registered a different grant"), { code: "grant_mismatch" });
  }
  const stored = { address: key.address, secret: key.privateKey, wallet: owner, subaccount_id: subaccountId, expiry_sec: res.expiry_sec || grant.expiry_sec, network: NETWORK.name };
  write(KEYS.key(owner), stored);
  return stored;
}

async function retire({ client, provider, owner, address, grant, now }) {
  const near = { ...grant, expiry_sec: now + SWITCH_OFF_SEC };
  const built = buildSetSessionKey({ owner, sessionKey: address, grant: near, nonce: randomNonce(now * 1000 + 1), signatureExpirySec: now + 600, chainId: NETWORK.chainId });
  const signature = await signTypedData(provider, owner, built.typedData);
  return client.call("private/set_session_key", built.params(signature), { safe: false });
}

/** Derive's list of this wallet's keys; Cowboy's own is the one labelled "Cowboy Saloon" at the stored address. */
export async function listKeys(client, owner) {
  const r = await client.call("private/session_keys", { wallet: owner });
  return r.public_session_keys || [];
}
export function findOnDerive(keys, stored) {
  return keys.find((k) => k.public_session_key?.toLowerCase() === stored?.address?.toLowerCase()) || null;
}

/**
 * Switch off: set the same key again with an expiry just past Derive's 5-minute minimum, and delete
 * the browser's copy whatever Derive answers. Needs an owner login on `client`.
 */
export async function switchOff({ client, provider, owner, stored, now = nowSec() }) {
  try {
    const grant = { ...grantFor(stored.subaccount_id, now), subaccount_ids: [stored.subaccount_id] };
    return await retire({ client, provider, owner, address: stored.address, grant, now });
  } finally {
    clearKey(owner);
  }
}
