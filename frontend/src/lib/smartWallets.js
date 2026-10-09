// The smart wallets at a Saloon level with their track records (owner, 9 October 2026: "shall we rank them? ...
// so many wins and so many losses ... these are the track records"). Every wallet still counts once in the
// level's long/short count and gold ring; rank only orders the list. Context, not a signal.
import { usd } from "./format.js";

export const SHORT_RECORD = 30; // settled options below which a record reads "Short record"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One wallet's record: won and lost settled options, return on premium traded, first month, short record. */
export function walletRecord(w) {
  const settled = Number.isFinite(w?.expired) ? w.expired : null;
  const won = settled != null && Number.isFinite(w.win_rate) ? Math.round(settled * w.win_rate) : null;
  const ret = Number.isFinite(w?.option_pnl) && w?.premium_traded > 0 ? w.option_pnl / w.premium_traded : null;
  const m = /^(\d{4})-(\d{2})/.exec(w?.first || "");
  return {
    settled, won, lost: won == null ? null : settled - won, ret,
    since: m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null,
    short: settled != null && settled < SHORT_RECORD,
  };
}

export const signedUsd = (v) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${usd(v)}` : null);
export const pct = (v) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : null);

/** "#1 long · #14, #40 short": the three best-ranked wallets here, by side. */
export function bestRanked(wallets, n = 3) {
  const top = (wallets || []).filter((w) => Number.isFinite(w.rank)).sort((a, b) => a.rank - b.rank).slice(0, n);
  return ["long", "short"].map((side) => {
    const ranks = top.filter((w) => w.side === side).map((w) => `#${w.rank}`);
    return ranks.length ? `${ranks.join(", ")} ${side}` : null;
  }).filter(Boolean).join(" · ");
}
