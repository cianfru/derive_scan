export const DATA_ROOT =
  "https://raw.githubusercontent.com/cianfru/derive_scan/data/";
export const number = (v, digits = 2) =>
  Number.isFinite(v)
    ? v.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";
export const price = (v) =>
  Number.isFinite(v) ? "$" + number(v, v < 1 ? 5 : 2) : "—";
export const percent = (v) =>
  Number.isFinite(v) ? number(v * 100, 1) + "%" : "—";
export const title = (s) =>
  (s || "Unavailable")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export const timestamp = (ts) =>
  ts
    ? new Date(ts * 1000).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : "Unavailable";
export const labels = {
  STRONG_LONG: "Strong long",
  LIGHT_LONG: "Light long",
  LONG: "Long",
  ACCUMULATE: "Accumulate",
  WAIT: "Wait",
  EXIT: "Exit",
  STRONG_SHORT: "Strong short",
  SHORT: "Short",
};
export const signalLabel = (r) =>
  r.data_status === "not enough data"
    ? "Insufficient data"
    : labels[r.signal] || title(r.signal);
export const change = (r, tf) => {
  const a = r.sparkline || [];
  const bars = tf === "4h" ? 6 : 1;
  const old = a[a.length - 1 - bars];
  return Number.isFinite(old) && old !== 0 && Number.isFinite(r.price)
    ? (r.price / old - 1) * 100
    : null;
};
export function selectRows(
  rows,
  {
    query = "",
    filter = "all",
    watchlist = [],
    sort = "market",
    direction = 1,
    tf = "4h",
  } = {},
) {
  const rank = ["BTC", "ETH", "SOL", "HYPE"];
  return rows
    .filter(
      (r) =>
        r.symbol.toLowerCase().includes(query.toLowerCase()) &&
        (filter !== "watchlist" || watchlist.includes(r.symbol)) &&
        (filter !== "active" ||
          (r.data_status !== "not enough data" && r.signal !== "WAIT")),
    )
    .sort((a, b) => {
      if (sort === "price")
        return ((a.price || 0) - (b.price || 0)) * direction;
      if (sort === "change")
        return (
          ((change(a, tf) ?? -Infinity) - (change(b, tf) ?? -Infinity)) *
          direction
        );
      if (sort === "heat") return ((a.heat || 0) - (b.heat || 0)) * direction;
      const ai = rank.indexOf(a.underlying),
        bi = rank.indexOf(b.underlying);
      return (
        ((ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) ||
          a.symbol.localeCompare(b.symbol)) * direction
      );
    });
}
export function validateSignals(d) {
  if (!Number.isFinite(d?.generated_at))
    throw new Error("Invalid signal timestamp");
  for (const tf of ["4h", "1d"]) {
    if (
      !Number.isFinite(d.timeframes?.[tf]?.bar_close) ||
      !Array.isArray(d.timeframes[tf].rows) ||
      !d.timeframes[tf].rows.length ||
      d.timeframes[tf].rows.some(
        (r) =>
          typeof r.symbol !== "string" ||
          typeof r.signal !== "string" ||
          typeof r.underlying !== "string",
      )
    )
      throw new Error("Invalid signals");
  }
  return d;
}
export function validateSurface(d) {
  if (!Number.isFinite(d?.ts) || !d.features || !Array.isArray(d.expiries))
    throw new Error("Invalid surface");
  return d;
}
export function csv(rows, tf) {
  const quote = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return [
    [
      "Market",
      "Timeframe",
      "Price",
      "24h change (%)",
      "Signal",
      "Combined",
      "Regime",
      "Heat",
      "Z-score",
      "Data status",
      "Volume status",
      "Bar close UTC",
    ],
    ...rows.map((r) => [
      r.symbol,
      tf,
      r.price,
      change(r, tf),
      signalLabel(r),
      r.data_status === "not enough data"
        ? "Insufficient data"
        : r.unified_signal,
      r.regime,
      r.heat,
      r.zscore,
      r.data_status,
      r.volume_status,
      timestamp(r.signal_bar_close_time),
    ]),
  ]
    .map((row) => row.map(quote).join(","))
    .join("\n");
}
