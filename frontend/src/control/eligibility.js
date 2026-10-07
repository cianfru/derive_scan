import { readingState } from "../lib/analytics.js";
import { live, priceAge } from "../lib/questions.js";

export const CARD_MAX_AGE = 35 * 60;
export const freshAt = (ts, now = Date.now() / 1000) => Number.isFinite(ts) && ts > 0 && ts <= now + 5 && now - ts <= CARD_MAX_AGE;
export const cardReading = (reading, kind, now = Date.now() / 1000) => readingState(reading, kind, now);
export const freshQuotes = (q, now = Date.now() / 1000) => freshAt(q?.prices_ts, now) && priceAge(q.prices_ts, now, q.paused).state === "fresh";

/** Export only currently offered debit answers; historical settlements keep their actual record time. */
export function eligibleQuotes(q, now = Date.now() / 1000) {
  if (!freshQuotes(q, now)) return null;
  return { ...q, dates: (q.dates || []).filter((d) => d.settle_ts > now).map((d) => ({ ...d,
    levels: (d.levels || []).map((l) => ({ ...l, ...Object.fromEntries(["yes", "no"].map((side) =>
      [side, d.board && l.ladder && live(l, side, false, now) ? l[side] : { ...l[side], buy: null }])) })),
  })) };
}

/** Shared input eligibility for the catalogue, independent of its presentation and post angles. */
export function eligibleDocument(path, data, card, now = Date.now() / 1000) {
  if (!data || typeof data !== "object") return null;
  if (path.startsWith("questions/history/")) return data;
  if (/^questions\/[^/]+\.json$/.test(path)) {
    if (card.id === "settled") return Array.isArray(data.settled) ? data : null;
    return eligibleQuotes(data, now);
  }
  if (!freshAt(data.generated_at, now)) return null;
  if (card.group === "Options" && path.startsWith("coins/")) {
    if (data.options?.status !== "ready" || !freshAt(data.options.ts, now)) return null;
  }
  if ((path === "traders.json" || path.startsWith("wallets/")) && !(data.ready === true && data.status === "ready")) return null;
  return data;
}
