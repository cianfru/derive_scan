// Snapshot presentation only: no signal synthesis or wallet ranking in the browser.
export function currentEngine(row, now = Date.now() / 1000) {
  if (!row || row.status !== "ready") return false;
  const ttl = (row.timeframe === "1d" ? 86400 : 14400) + 1200;
  return (
    Number.isFinite(row.observed_at) &&
    now >= row.observed_at &&
    now - row.observed_at <= ttl
  );
}
export function comparisonView(comparison, now = Date.now() / 1000) {
  const daily = comparison?.["1d"],
    four = comparison?.["4h"];
  const complete = currentEngine(daily, now) && currentEngine(four, now);
  return {
    daily,
    four,
    complete,
    confluence: complete ? comparison.confluence : null,
    unified: complete ? comparison.unified : null,
  };
}
export function moveScale(index, iv, days = 30) {
  if (
    !Number.isFinite(index) ||
    index <= 0 ||
    !Number.isFinite(iv) ||
    iv <= 0 ||
    !Number.isFinite(days) ||
    days <= 0
  )
    return null;
  const fraction = iv * Math.sqrt(days / 365),
    move = index * fraction;
  return { move, fraction, lower: index - move, upper: index + move };
}
export const expiryDate = (ts) =>
  Number.isFinite(Number(ts))
    ? new Date(Number(ts) * 1000).toISOString().slice(0, 10)
    : "Unavailable";
export function expiryEvidence(opts, selected) {
  const key = String(selected);
  const rows = opts?.strikes?.expiries?.[key] || [];
  const expiry = opts?.expiries?.find((e) => String(e.expiry) === key);
  const implied = opts?.implied?.find((e) => String(e.expiry) === key);
  const peak = (side) =>
    rows
      .filter((r) => Number.isFinite(r[side]) && r[side] > 0)
      .reduce((top, r) => (!top || r[side] > top[side] ? r : top), null);
  return { rows, expiry, implied, call: peak(1), put: peak(2) };
}
