// Rysk trades placed from this browser, with how long each step took, per network. A convenience for
// the owner's trials (the authoritative record is Rysk's own positions, read over its socket); kept
// apart from the Derive journal, since locked collateral is not a Saloon position.
const KEY = (network) => `cowboy-rysk:${network}`;
const MAX = 200;

export function loadRyskTrades(network) {
  try { const v = JSON.parse(globalThis.localStorage?.getItem(KEY(network)) || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/** Adds one trade (or one attempt whose outcome is unknown); the same hash is never added twice. */
export function saveRyskTrade(network, record) {
  const list = loadRyskTrades(network);
  if (record.hash && list.some((r) => r.hash === record.hash)) return list;
  const next = [record, ...list].slice(0, MAX);
  try { globalThis.localStorage?.setItem(KEY(network), JSON.stringify(next)); } catch { /* not saving */ }
  return next;
}
