export const SIGNAL_LABEL = {
  STRONG_LONG: "Strong long", LIGHT_LONG: "Long", ACCUMULATE: "Accumulate", REVIVAL_SEED: "Revival seed",
  REVIVAL_SEED_CONFIRMED: "Revival confirmed", WAIT: "Wait", TRIM: "Trim", TRIM_HARD: "Trim hard", RISK_OFF: "Risk off",
  NO_LONG: "No long", LIGHT_SHORT: "Short",
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
export const title = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "-");
export const REGIME = { MARKUP: "Markup", BLOWOFF: "Blow-off", REACC: "Re-accumulation", MARKDOWN: "Markdown",
  CAP: "Capitulation", ACCUM: "Accumulation", FLAT: "Flat" };

export function price(v) {
  if (v == null || !isFinite(v)) return "-";
  const a = Math.abs(v);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 6;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const pct = (v, d = 1) => (v == null || !isFinite(v) ? "-" : `${(v * 100).toFixed(d)}%`);
export const chg = (v, d = 2) => (v == null || !isFinite(v) ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
export function usd(v) {
  if (v == null || !isFinite(v)) return "-";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
export const utc = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
export function ago(t) {
  const s = Date.now() / 1000 - t;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "-");
export const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const DATA_LABEL = { history_updated: "History recovered", ready: "Ready", "warming up": "Warming up", "not enough data": "Not enough data" };
