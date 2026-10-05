// Saloon stage 2: what this browser keeps (Cowboy runs no server). Storage can be blocked, so every
// read and write falls back to memory for the visit.
import { NETWORK } from "./config.js";

const memory = new Map();
function storage() {
  try {
    const s = globalThis.localStorage;
    const probe = "__cowboy_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
export function read(key) {
  const s = storage();
  try {
    const raw = s ? s.getItem(key) : memory.get(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}
export function write(key, value) {
  const raw = JSON.stringify(value);
  const s = storage();
  try { if (s) s.setItem(key, raw); else memory.set(key, raw); } catch { memory.set(key, raw); }
}
export function remove(key) {
  const s = storage();
  try { s?.removeItem(key); } catch { /* blocked */ }
  memory.delete(key);
}

const scope = (what, wallet) => `cowboy-saloon-${what}:${NETWORK.name}${wallet ? `:${wallet.toLowerCase()}` : ""}`;
export const KEYS = {
  terms: () => scope("terms"),
  key: (wallet) => scope("key", wallet),
  known: (wallet) => scope("known", wallet),
  day: (wallet) => scope("day", wallet),
  sent: (wallet) => scope("sent", wallet),
  /** The wallet last connected on this network, so a reload can resume without a prompt. */
  lastWallet: () => scope("wallet"),
};
