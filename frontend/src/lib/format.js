export const SIGNAL_LABEL = {
  STRONG_LONG: "Strong long", LIGHT_LONG: "Light long", ACCUMULATE: "Accumulate", REVIVAL_SEED: "Revival seed",
  REVIVAL_SEED_CONFIRMED: "Revival confirmed", WAIT: "Wait", TRIM: "Trim", TRIM_HARD: "Trim hard", RISK_OFF: "Risk off",
  NO_LONG: "No long", LIGHT_SHORT: "Light short",
};
export function signalTone(s) {
  if (!s) return "na";
  if (s === "STRONG_LONG") return "strong";
  if (s === "LIGHT_LONG") return "long";
  if (s === "ACCUMULATE" || s.startsWith("REVIVAL")) return "acc";
  if (s === "WAIT") return "wait";
  return "exit";
}
export const SIGNAL_RANK = { STRONG_LONG: 6, LIGHT_LONG: 5, ACCUMULATE: 4, REVIVAL_SEED_CONFIRMED: 3, REVIVAL_SEED: 3,
  WAIT: 2, LIGHT_SHORT: 1, NO_LONG: 1, TRIM: 0, TRIM_HARD: 0, RISK_OFF: 0 };
export const DASH = "—";
const ok = (v) => v != null && Number.isFinite(v);
const fmt = (v, min, max) => v.toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
export const title = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : DASH);
export const REGIME = { MARKUP: "Markup", BLOWOFF: "Blow-off", REACC: "Re-accumulation", MARKDOWN: "Markdown",
  CAP: "Capitulation", ACCUM: "Accumulation", FLAT: "Flat" };

/** Price: decimals by magnitude, grouped. 84,567 · 2,681.2 · 88.02 · 0.2446 */
export function price(v) {
  if (!ok(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 10000) return fmt(v, 0, 0);
  if (a >= 1000) return fmt(v, 0, 1);
  if (a >= 1) return fmt(v, 2, 2);
  return fmt(v, 2, 4);
}
/** Strike: whole numbers from 100, trailing zeros trimmed. $2,000 · $85 · $0.25 */
export function strike(v, sign = "$") {
  if (!ok(v)) return DASH;
  const a = Math.abs(v);
  return `${v < 0 ? "-" : ""}${sign}${fmt(a, 0, a >= 100 ? 0 : a >= 1 ? 2 : 4)}`;
}
/** Percent of a ratio (0.123 -> 12.3%), no trailing .0. */
export const pct = (v, d = 1) => (ok(v) ? `${(v * 100).toFixed(d).replace(/\.0+$/, "")}%` : DASH);
/** Change already in percent (1.23 -> +1.23%). */
export const chg = (v, d = 2) => (ok(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : DASH);
/** A z-score to two decimals. */
export const z = (v) => (ok(v) ? `${v.toFixed(2)}σ` : DASH);
/** Compact dollars: $512 · $12.5K · $3.45M · $1.2B */
export function usd(v) {
  if (!ok(v)) return DASH;
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  const trim = (x, d) => x.toFixed(d).replace(/\.?0+$/, "");
  if (a >= 1e9) return `${s}$${trim(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${s}$${trim(a / 1e6, 2)}M`;
  if (a >= 1e3) return `${s}$${trim(a / 1e3, 1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A Derive option name (BTC-20261009-82000-C) as parts and "BTC 82,000 call · Oct 09". */
export function optionLabel(instrument) {
  const m = /^([A-Z0-9]+)-(\d{4})(\d{2})(\d{2})-([\d_.]+)-([CP])$/.exec(instrument || "");
  if (!m) return { und: null, strike: null, type: null, expiry: null, display: instrument || DASH };
  const [, und, y, mo, d, k, t] = m;
  const value = Number(k.replace("_", "."));
  const type = t === "C" ? "call" : "put";
  const expiryLabel = `${MONTHS[Number(mo) - 1]} ${d}`;
  return { und, strike: value, type, expiry: `${y}-${mo}-${d}`, expiryLabel,
    display: `${und} ${strike(value, "")} ${type} · ${expiryLabel}` };
}
export const utc = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
export function ago(t) {
  const s = Date.now() / 1000 - t;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || DASH);
export const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const DATA_LABEL = { history_updated: "History recovered", ready: "Ready", "warming up": "Warming up", "not enough data": "Not enough data" };
/** "3 Oct 00:00 UTC" and "10:20 UTC" for page meta lines. */
export function dayTime(t) {
  if (!ok(t)) return DASH;
  const d = new Date(t * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)} UTC`;
}
export const clock = (t) => (ok(t) ? `${new Date(t * 1000).toISOString().slice(11, 16)} UTC` : DASH);
