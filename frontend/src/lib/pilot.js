// Real-money one tap (builds with VITE_SALOON_TRADE=mainnet): the pilot. Only wallets on the build's
// list (VITE_SALOON_PILOT, comma-separated addresses; empty or unset means nobody) get the one-tap
// ticket; everyone else sees the ticket placed by hand. "all" opens it to every wallet (owner,
// 7 October 2026: "If the flow works with one, then it works for everybody"). Small and free of trading code, so the entry
// and the stage 1 ticket can read it.
import { MAINNET_FILLS, TRADE_ON } from "./flags.js";

const ADDRESS = /^0x[0-9a-f]{40}$/;

/** The pilot list from its build variable: lower-case addresses; anything that is not one is dropped. */
export const EVERYONE = "*";
export function parsePilot(raw) {
  if (String(raw ?? "").trim().toLowerCase() === "all") return new Set([EVERYONE]);
  return new Set(String(raw ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => ADDRESS.test(s)));
}

// Marked pure so builds that never ask (no one-tap trading) drop it entirely.
export const PILOT = /* @__PURE__ */ parsePilot(import.meta.env.VITE_SALOON_PILOT);

/** Is this wallet on the pilot list? */
export const isPilot = (wallet, list = PILOT) => typeof wallet === "string" && (list.has(EVERYONE) || list.has(wallet.toLowerCase()));

/** The wallet this browser last connected on mainnet (lib/trade/store.js KEYS.lastWallet), and the
 * pilot invitation (`?pilot` on any Saloon page, kept in this browser). */
export const LAST_MAINNET_WALLET = "cowboy-saloon-wallet:mainnet";
export const PILOT_INVITE = "cowboy-saloon-pilot:mainnet";

const get = (k) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } };
const put = (k, v) => { try { if (v == null) globalThis.localStorage?.removeItem(k); else globalThis.localStorage?.setItem(k, v); } catch { /* blocked */ } };

/** Keeps the pilot invitation when the address has `?pilot` (the owner opens it once per browser). */
export function notePilotInvite(search = globalThis.location?.search) {
  try { if (new URLSearchParams(search || "").has("pilot")) put(PILOT_INVITE, "1"); } catch { /* no URL */ }
}
export const forgetPilotInvite = () => put(PILOT_INVITE, null);

/**
 * Does this browser get the one-tap ticket? Every trading build but mainnet: yes. A mainnet build: only
 * when the pilot list is not empty and this browser either connected a listed wallet before or holds
 * the pilot invitation; connecting a wallet that is not listed ends it (lib/trade/seat.js).
 */
export function oneTapOffered(list = PILOT) {
  if (!TRADE_ON) return false;
  if (!MAINNET_FILLS) return true;
  if (!list.size) return false;
  if (list.has(EVERYONE)) return true;
  return isPilot(get(LAST_MAINNET_WALLET), list) || get(PILOT_INVITE) === "1";
}

/** True where the stage 1 ticket carries the note "One-tap trading is coming to Cowboy…": a mainnet
 * build, for a browser outside the pilot. */
export const oneTapComing = (list = PILOT) => MAINNET_FILLS && !oneTapOffered(list);
