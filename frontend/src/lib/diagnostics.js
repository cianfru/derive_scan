import { track } from "@vercel/analytics";

const allowed = new Set(["view_failed", "view_update_required", "data_unavailable", "data_recovered",
  "outcome_opened", "payout_reviewed", "quote_unavailable", "quote_expired", "trade_completed"]);
const recent = [];
const last = new Map();
const SEND = import.meta.env.VITE_PRODUCT_EVENTS === "1";

export function screenName(pathname = globalThis.location?.pathname || "/") {
  if (pathname === "/") return "landing";
  if (pathname === "/saloon/mine" || pathname === "/saloon/following") return "my_space";
  const head = pathname.split("/")[1];
  return ["saloon", "markets", "coin", "radar", "options", "flow", "traders", "trader", "q"].includes(head) ? head : "other";
}

/** Fixed event names and screen categories only; no error text, URL, wallet, amounts or payloads. */
export function recordProductEvent(kind) {
  if (!allowed.has(kind)) return;
  const screen = screenName(), at = Date.now(), key = `${screen}:${kind}`;
  if (last.has(key) && at - last.get(key) < 5000) return;
  last.set(key, at);
  recent.push({ kind, screen, at });
  if (recent.length > 30) recent.shift();
  if (SEND) {
    try { track("product_event", { kind, screen }); } catch { /* Diagnostics never interrupt a view. */ }
  }
}

export const diagnosticSnapshot = () => recent.map((entry) => ({ ...entry }));
