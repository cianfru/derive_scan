import { SIGNAL_LABEL } from "./format.js";
import { readingState } from "./analytics.js";

export const ASSET_NAMES = { CC: "Canton", LIT: "Lighter", PUMP: "Pump.fun", VVV: "Venice", XAUT: "Tether Gold", ZEC: "Zcash", BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", HYPE: "Hyperliquid", ADA: "Cardano", XRP: "XRP", DOGE: "Dogecoin", AVAX: "Avalanche", LINK: "Chainlink", BNB: "BNB", SUI: "Sui", TRUMP: "Official Trump", AAVE: "Aave", TON: "Toncoin", BCH: "Bitcoin Cash" };
export const STATE_NAMES = { up: "Upward tone", defensive: "Defensive tone", neutral: "Balanced tone" };
export const WINDOWS = { "7d": { name: "7-day options", engine: "1D close", options: "7d tenor / 24h flow", wallets: "Expiry within 7d" }, "30d": { name: "30-day options", engine: "1D close", options: "30d tenor / 7d flow", wallets: "Expiry within 30d" } };
// Pipeline states read as plain words (owner, 4 October 2026): "Updating" for a reading past its
// window, "Not available yet" for one the data cannot give now; the technical reason sits in STATUS_WHY.
export const STATUS_NAMES = { history_updated: "History recovered", partial_flow: "Collecting flow", skew_only: "From skew", insufficient_data: "Not available yet", unknown: "Unavailable", missing: "Unavailable", unavailable: "Unavailable", stale: "Updating", future: "Updating", thin_volume: "Thin volume", "warming up": "Warming up", "not enough data": "Short history", missing_quotes: "Not available yet", modelled_delta: "Estimated delta", insufficient_exposure: "Low exposure" };
export const STATUS_WHY = {
  stale: "The latest reading is older than its update window, so it is held back until the next recorder run replaces it.",
  future: "The reading's time stamp is ahead of the clock, so it is held back until the two line up.",
  missing_quotes: "Option quotes this reading needs were missing from the latest snapshot.",
  insufficient_data: "There is not enough recorded data for this reading yet.",
  unknown: "No reading was published for this layer.", missing: "No reading was published for this layer.", unavailable: "No reading was published for this layer.",
  insufficient_exposure: "Smart wallets hold too little on this coin's expiries in the window to read a balance.",
  partial_flow: "Taker flow does not cover the whole window yet, so the reading uses what was recorded.",
  building: "Wallet readings start once the trade history has caught up and the wallets are valued on recorded quotes.",
};
export function viewReading(alignment, horizon, kind, now) {
  if (!alignment || alignment.version !== 2) return { label: "Unavailable", state: null, why: STATUS_WHY.unavailable };
  if (kind === "wallets" && !(alignment.wallet_coverage?.ready === true && alignment.wallet_coverage?.status === "ready")) return { label: "Building history", state: null, why: STATUS_WHY.building };
  const row = (alignment.readings || alignment.horizons)?.[horizon]?.[kind];
  const state = readingState(row, kind, now);
  const status = kind === "engine" && row?.data_status && row.data_status !== "ready" ? row.data_status : row?.status;
  const key = status === "ready" ? "stale" : status;
  return { label: (state && kind === "engine" ? SIGNAL_LABEL[row?.signal] : state && kind === "wallets" ? {up:"Long delta", defensive:"Short delta", neutral:"Balanced delta"}[state] : STATE_NAMES[state]) || STATUS_NAMES[key] || "Unavailable", state, row,
    why: state ? null : STATUS_WHY[key] || STATUS_WHY.unavailable };
}

// Invalid samples remain gaps. Never connect an absent observation or smooth price beyond the data.
export function traceGeometry(values, width, height, inset = 3) {
  const valid = (values || []).filter(Number.isFinite);
  if (valid.length < 2 || values.length < 2) return null;
  const lo = Math.min(...valid), hi = Math.max(...valid), spread = hi - lo;
  const padding = spread ? spread * .12 : Math.max(Math.abs(lo) * .001, .001);
  const min = lo - padding, max = hi + padding;
  const x = i => inset + i / (values.length - 1) * (width - 2 * inset);
  const y = v => inset + (max - v) / (max - min) * (height - 2 * inset);
  let pen = false;
  const path = values.map((v, i) => {
    if (!Number.isFinite(v)) { pen = false; return ""; }
    const segment = `${pen ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
    pen = true; return segment;
  }).join(" ");
  const first = values.findIndex(Number.isFinite), last = values.findLastIndex(Number.isFinite);
  return { path, lo, hi, first, last, x, y, change: values[first] === 0 ? null : (values[last] / values[first] - 1) * 100 };
}

export function radarPoint(coin, horizon, now) {
  // The horizontal reading always uses the daily engine, separately from wallet expiry.
  const engine = viewReading(coin.align, "30d", "engine", now);
  const wallet = viewReading(coin.align, horizon, "wallets", now);
  const w = wallet.row;
  if (!engine.state || !wallet.state || !Number.isFinite(coin.z_1d) || !Number.isFinite(w?.score) || Math.abs(w.score) > 1 || !Number.isFinite(w?.gross_delta_usd) || w.gross_delta_usd <= 0 || w.gross_complete !== true || w.estimated_positions > 0 || w.missing_positions > 0) return null;
  return { coin, x: coin.z_1d, y: w.score, gross: w.gross_delta_usd, positions: w.positions };
}

// Move labels, never observations. Leaders preserve the exact relationship to close points.
export function radarLabels(points, bounds) {
  const placed = [];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return points.map(p => {
    const half = p.name.length * 3.6 + 3;
    // Right of the dot first; candidate order breaks ties.
    const candidates = [[p.r + half + 6, 4], [-p.r - half - 6, 4], [0, -p.r - 10], [0, p.r + 18],
      [p.r + half + 10, -18], [p.r + half + 10, 26], [-32, -p.r - 26], [32, p.r + 34]];
    let best;
    for (const [i, [dx, dy]] of candidates.entries()) {
      const x = clamp(p.x + dx, bounds.left + half, bounds.right - half);
      const y = clamp(p.y + dy, bounds.top + 14, bounds.bottom - 4);
      const rect = { left: x - half, right: x + half, top: y - 12, bottom: y + 3 };
      const overlaps = placed.filter(b => rect.left < b.right + 4 && rect.right + 4 > b.left && rect.top < b.bottom + 3 && rect.bottom + 3 > b.top).length;
      const circles = points.filter(c => {
        const nx = clamp(c.x, rect.left, rect.right), ny = clamp(c.y, rect.top, rect.bottom);
        return Math.hypot(c.x - nx, c.y - ny) < c.r + 3;
      }).length;
      const score = overlaps * 1000 + circles * 100 + i;
      if (!best || score < best.score) best = { x, y, rect, score, name: p.name };
    }
    placed.push(best.rect);
    return best;
  });
}
