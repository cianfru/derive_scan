// One plain takeaway per research page, built from the published data, and the main thing that
// limits it. What the data shows now, never what comes next: no forecast words, and no claim that
// wallets or alignment lead price (the options-traders study has not reported).
import { REGIME, SIGNAL_LABEL, usd, clock } from "./format.js";
import { currentEngine } from "./research.js";
import { viewReading } from "./presentation.js";

const STUDY = "positioning is context until the options-traders study reports";
const of = (n, m) => `${n} of ${m}`;
const verb = (n, one, many) => (n === 1 ? one : many);
/** "are trending up" / "is cooling off" / "have no regime yet". */
function regimePhrase(code, n) {
  if (code === "FLAT") return `${verb(n, "has", "have")} no regime yet`;
  return `${verb(n, "is", "are")} ${(REGIME[code] || "unread").toLowerCase()}`;
}

/** Markets: the regime most options markets sit in on the daily close; the wallet coverage. */
export function marketsLead(data, now = Date.now() / 1000) {
  const all = (data?.coins || []).filter((c) => c.has_options);
  const read = all.filter((c) => c.regime_1d && currentEngine(c.engine_comparison?.["1d"], now));
  if (!all.length) return null;
  if (!read.length) return { text: "No options market has a current daily reading yet.", note: "Readings return after the next daily close." };
  const n = {};
  read.forEach((c) => { n[c.regime_1d] = (n[c.regime_1d] || 0) + 1; });
  const [top, second] = Object.keys(n).sort((a, b) => n[b] - n[a]);
  const scope = read.length === all.length ? `${read.length} options markets` : `the ${read.length} options markets with a current daily reading`;
  let text = `${n[top]} of ${scope} ${regimePhrase(top, n[top])} on the daily close`;
  if (second) text += `; ${n[second]} ${regimePhrase(second, n[second])}`;
  const noWallet = all.filter((c) => !viewReading(c.align, "30d", "wallets", now).state).length;
  const note = noWallet
    ? `${of(noWallet, all.length)} have no current wallet reading; ${STUDY}.`
    : `Wallet readings are context until the options-traders study reports.`;
  return { text: `${text}.`, note };
}

/** Radar: how Smart wallets' delta sits across the markets that have a reading. */
export function radarLead(coins, horizon = "30d", now = Date.now() / 1000) {
  if (!coins?.length) return null;
  const states = coins.map((c) => viewReading(c.align, horizon, "wallets", now).state);
  const read = states.filter(Boolean);
  const missing = coins.length - read.length;
  const note = missing
    ? `${of(missing, coins.length)} markets have no current wallet reading; ${STUDY}.`
    : `Positioning is context until the options-traders study reports.`;
  if (!read.length) return { text: "No market has a current Smart-wallet reading, so the map shows price stretch only.", note };
  const long = read.filter((s) => s === "up").length, short = read.filter((s) => s === "defensive").length;
  const parts = [`long delta on ${long}`, `short delta on ${short}`];
  const flat = read.length - long - short;
  if (flat) parts.push(`balanced on ${flat}`);
  return { text: `Smart wallets hold ${parts.join(", ")} of the ${read.length} ${verb(read.length, "market", "markets")} with a current reading.`, note };
}

/** Options: which side of the 30-day skew is richer across markets, and BTC's priced move. */
export function optionsLead(data) {
  const coins = (data?.coins || []).filter((c) => c.options);
  const skewed = coins.filter((c) => Number.isFinite(c.options.rr25_30d));
  if (!skewed.length) return null;
  const puts = skewed.filter((c) => c.options.rr25_30d < 0).length;
  const calls = skewed.length - puts;
  let text = calls >= puts
    ? `Calls cost more than puts at 30 days on ${of(calls, skewed.length)} markets`
    : `Puts cost more than calls at 30 days on ${of(puts, skewed.length)} markets`;
  const ref = coins.find((c) => c.und === "BTC") || coins[0];
  const iv = ref?.options?.atm_iv_30d;
  if (Number.isFinite(iv)) text += `; ${ref.und}'s 30-day options price a typical move of ±${(iv * Math.sqrt(30 / 365) * 100).toFixed(1)}%`;
  const thin = coins.filter((c) => !Number.isFinite(c.options.atm_iv_30d)).length;
  const stale = coins.some((c) => c.options.status !== "ready");
  const ts = Math.max(0, ...coins.map((c) => c.options.ts || 0));
  const limits = [];
  if (stale && ts) limits.push(`Readings are from the ${clock(ts)} snapshot`);
  if (thin) limits.push(`${thin} ${verb(thin, "market has", "markets have")} thin quotes`);
  limits.push("option prices show what the market pays now, not a view");
  const note = limits.join("; ");
  return { text: `${text}.`, note: `${note.charAt(0).toUpperCase()}${note.slice(1)}.` };
}

/** Traders: how many ranked wallets sit in the tiers, and the leader's result. */
export function tradersLead(data) {
  const list = data?.traders || [];
  if (!list.length) return null;
  const tiered = list.filter((t) => t.tier === "top" || t.tier === "smart").length;
  const lead = list[0];
  const total = data.ranked_total ?? list.length;
  let text = `${tiered.toLocaleString("en-US")} wallets of the ${list.length} shown are in the Top and Smart tiers, out of ${total.toLocaleString("en-US")} ranked`;
  if (Number.isFinite(lead?.option_pnl)) text += `; the leader is ${lead.option_pnl >= 0 ? "up" : "down"} ${usd(Math.abs(lead.option_pnl))} in gross options PnL`;
  return { text: `${text}.`, note: `Ranks count expired options before fees; ${STUDY}.` };
}

/** Cohorts: how the most profitable results cohort holds its open options, on complete quotes only. */
export function cohortsLead(data) {
  const rows = (data?.cohorts?.pnl || []).filter((c) => c.wallets > 0);
  const c = rows.find((r) => r.name === "Money Printer") || rows[0];
  if (!c) return null;
  const coins = Object.values(c.windows?.all?.coins || {}).filter((b) => b.positions > 0 && b.score != null && Number.isFinite(b.net_delta_usd));
  const n = c.wallets.toLocaleString("en-US");
  if (!coins.length) return { text: `${n} ${c.name} wallets hold no open options with complete quotes now.`, note: `Cohorts by results count expired options before fees; ${STUDY}.` };
  const net = coins.reduce((s, b) => s + b.net_delta_usd, 0);
  const side = net > 0 ? "long" : net < 0 ? "short" : "balanced";
  const text = side === "balanced"
    ? `${n} ${c.name} wallets hold balanced option delta across ${coins.length} ${coins.length === 1 ? "coin" : "coins"}`
    : `${n} ${c.name} wallets hold ${usd(Math.abs(net))} of net ${side} option delta across ${coins.length} ${coins.length === 1 ? "coin" : "coins"}`;
  return { text: `${text}.`, note: `Cohorts by results count expired options before fees; ${STUDY}.` };
}

/** Flow: option premium bought and sold by takers, and the busiest market. */
export function flowLead(data) {
  const by = data?.by_coin || {};
  let bought = 0, sold = 0, best = null, bestN = 0;
  for (const [und, c] of Object.entries(by)) {
    const b = (c.call?.buy_premium_usd || 0) + (c.put?.buy_premium_usd || 0);
    const s = (c.call?.sell_premium_usd || 0) + (c.put?.sell_premium_usd || 0);
    bought += b; sold += s;
    const n = (c.call?.buy_notional_usd || 0) + (c.call?.sell_notional_usd || 0) + (c.put?.buy_notional_usd || 0) + (c.put?.sell_notional_usd || 0);
    if (n > bestN) { bestN = n; best = und; }
  }
  if (!bought && !sold) return null;
  let text = `Over the last 24 hours, takers bought ${usd(bought)} of option premium and sold ${usd(sold)}`;
  if (best) text += `; ${best} saw the most options notional`;
  const cov = data.coverage;
  const gap = cov && cov.ready === false && Number.isFinite(cov.fraction) ? `The recorder covered ${Math.round(cov.fraction * 100)}% of that window; a` : "A";
  return { text: `${text}.`, note: `${gap} taker trade shows who crossed the spread, not the wallet's whole position.` };
}

const WALLET_WORDS = { up: "Smart wallets hold long delta", defensive: "Smart wallets hold short delta", neutral: "Smart wallets' delta is balanced" };
const OPTION_WORDS = { up: "option prices lean up", defensive: "option prices lean defensive", neutral: "option prices are balanced" };

/** A coin page: the daily regime and signal, then the wallets and options layers that have a reading. */
export function coinLead(und, data, now = Date.now() / 1000) {
  const row = data?.latest?.["1d"];
  const current = currentEngine(data?.engine_comparison?.["1d"], now);
  if (!row || !current || !row.regime) {
    return { text: `${und} has no current daily reading yet.`, note: "The regime returns after the next daily close." };
  }
  let text = `${und} ${regimePhrase(row.regime, 1)} on the daily close`;
  if (row.signal && SIGNAL_LABEL[row.signal]) text += `, and the daily signal reads ${SIGNAL_LABEL[row.signal]}`;
  if (!data.options) return { text: `${text}.`, note: `${und} has no options on Derive, so only the regime and wallets apply.` };
  const w = viewReading(data.alignment, "30d", "wallets", now).state;
  const o = viewReading(data.alignment, "30d", "options", now).state;
  const parts = [w && WALLET_WORDS[w], o && OPTION_WORDS[o]].filter(Boolean);
  const out = parts.length ? `${text}. Over 30 days, ${parts.join(" and ")}.` : `${text}.`;
  const missing = [!w && "wallet", !o && "options"].filter(Boolean);
  const note = missing.length
    ? `No current ${missing.join(" or ")} reading for this close yet; ${STUDY}.`
    : `The three layers sit side by side; ${STUDY}.`;
  return { text: out, note };
}
