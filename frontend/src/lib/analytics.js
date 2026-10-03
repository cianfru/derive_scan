export function conePath(implied, snapshot, index, horizon, quantile) {
  if (!Number.isFinite(snapshot) || !Number.isFinite(index) || index <= 0) return [];
  const rows = (implied || []).filter((r) => r.expiry > snapshot && r.days <= horizon && Number.isFinite(r.q?.[quantile])).sort((a, b) => a.expiry - b.expiry);
  if (!rows.length) return [];
  return [{ time: snapshot, value: index }, ...rows.map((r) => ({ time: r.expiry, value: r.q[quantile] }))];
}

export function readingState(reading, kind, now = Date.now() / 1000) {
  // Options tone from skew alone counts as a reading until taker flow covers its window.
  if (!reading || !(reading.status === "ready" || (kind === "options" && reading.status === "skew_only"))) return null;
  const at = kind === "wallets" ? reading.valuation_at : reading.observed_at;
  const ttl = kind === "engine" ? (reading.timeframe === "1d" ? 86400 : 14400) + 1200 : 1800;
  return Number.isFinite(at) && now >= at && now - at <= ttl ? reading.state : null;
}
