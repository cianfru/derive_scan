import { viewReading, WINDOWS } from "./presentation.js";
import { legFee } from "./questions.js";

// The trade journal (J1, issue #33): what a manual "I placed it" actually recorded, kept beside the
// position in this browser. Three times stay separate in every entry: the fill time (entered by the
// user, or unknown), the snapshot time (when Cowboy saved it) and each reading's own source time and
// publication time. A reading is entry context only when it was published at or before the fill;
// anything else is kept as later context, labelled "Saved later", and never shown as what the trader
// had at the fill. Nothing here picks a direction for the trader.

export const JOURNAL_SCHEMA = 1;
export const KINDS = [["engine", "Regime"], ["wallets", "Wallets"], ["options", "Options"]];
export const CURRENCY = "USDC";

const ok = Number.isFinite;
const round = (v, d = 8) => (ok(v) ? Number(v.toFixed(d)) : null);

/** The readings' horizon for a date: 7 days for anything settling within a week, else 30. */
export function horizonFor(settleTs, at) {
  if (!ok(settleTs) || !ok(at)) return "30d";
  return settleTs - at <= 7 * 86400 + 3600 ? "7d" : "30d";
}

/** One reading as published in markets.json, evaluated at its own publication time (never today's). */
export function readingFrom(markets, und, horizon, kind, at = null) {
  const coin = markets?.coins?.find((c) => c.und === und);
  const publishedAt = ok(markets?.generated_at) ? markets.generated_at : null;
  const align = coin?.align || null;
  const v = viewReading(align, horizon, kind, at ?? publishedAt ?? undefined);
  const row = v.row || null;
  const sourceTs = kind === "wallets" ? row?.valuation_at : row?.observed_at;
  return {
    kind, horizon, window: WINDOWS[horizon]?.[kind] || null,
    label: v.label, state: v.state || null, available: !!v.state, why: v.why || null,
    status: row?.status ?? null, signal: row?.signal ?? null, regime: row?.regime ?? null,
    source_ts: ok(sourceTs) ? sourceTs : null, published_at: publishedAt,
    version: { align: align?.version ?? null, reading: row?.version ?? null, analytics: markets?.analytics_version ?? null },
    // History rebuilt after the fact is never something the trader saw at entry.
    reconstructed: row?.status === "history_updated" || row?.reconstructed === true,
  };
}

/** Entry context only when published (and observed) at or before the fill; otherwise later. */
export function timingOf(r, fillTs) {
  if (!ok(fillTs) || !ok(r?.published_at)) return "later";
  if (r.published_at > fillTs) return "later";
  if (ok(r.source_ts) && r.source_ts > fillTs) return "later";
  return r.reconstructed ? "later" : "entry";
}

/** The three readings saved with a manual entry. `status` is "at_fill" only when every reading was
 * published at or before the fill; otherwise "saved_later". */
export function captureContext({ markets, und, settleTs, fillTs, savedTs }) {
  const horizon = horizonFor(settleTs, ok(fillTs) ? fillTs : savedTs);
  const readings = {};
  for (const [kind] of KINDS) {
    const r = readingFrom(markets, und, horizon, kind);
    readings[kind] = { ...r, timing: timingOf(r, fillTs) };
  }
  const all = Object.values(readings);
  return {
    fill_ts: ok(fillTs) ? fillTs : null, snapshot_ts: savedTs, horizon,
    published_at: ok(markets?.generated_at) ? markets.generated_at : null,
    status: all.every((r) => r.timing === "entry") ? "at_fill" : "saved_later",
    readings,
  };
}

/** Derive's mark for the package (debit, so a positive value is what the held package is worth),
 * from the board's published mark. A valuation benchmark, not a fill and not a sell-back quote. */
export function markBenchmark({ level, side, contracts, pricesTs, fillTs }) {
  if (!level || !ok(level.fair) || !ok(contracts)) return null;
  const per = side === "yes" ? level.fair : 1 - level.fair;
  const ts = ok(pricesTs) ? pricesTs : null;
  return { per: round(per, 6), value: round(per * (level.hi - level.lo) * contracts, 6), sign: 1, ts,
    source: "Derive mark, Cowboy board", timing: ok(fillTs) && ts != null && ts <= fillTs ? "entry" : "later" };
}

/** Where a debit answer breaks even at settlement, from the total cost; null when it never does. */
export function settleBreakeven({ side, lo, hi, contracts, cost }) {
  if (!ok(cost) || !(contracts > 0) || !(hi > lo)) return null;
  const f = cost / ((hi - lo) * contracts);
  if (!(f > 0) || f >= 1) return null;
  return side === "yes" ? lo + f * (hi - lo) : hi - f * (hi - lo);
}

/** Derive's order-book fees for the filled legs at the board's index, used only as a marked estimate. */
export function estimateFees(legs, board) {
  const spec = board?.spec;
  if (!spec || !ok(board?.index)) return null;
  let f = 0;
  for (const l of legs) if (l.qty > 0 && ok(l.price)) f += legFee(board.index, l.price, l.qty, spec);
  return round(f, 6);
}

/**
 * The fill facts from the form. `mode` "legs" (a price per option) or "total" (one package premium,
 * leg prices unknown). Legs carry `name`, `act` ("buy"/"sell"), `planned` (contracts) and the
 * entered `qty` and `price`. Returns the package as it filled, the costs and their basis, or an
 * `error` naming what is missing.
 */
export function fillFacts({ choice, mode, legs, premiumTotal, fees, feesKnown, board, side, lo, hi, plannedContracts }) {
  if (choice !== "both" && choice !== "first") return { error: "fill" };
  const rows = legs.map((l, i) => ({ name: l.name, act: l.act, planned: l.planned,
    qty: choice === "first" && i > 0 ? 0 : ok(l.qty) ? l.qty : null, price: mode === "legs" ? (ok(l.price) ? l.price : null) : null }));
  if (rows.some((r) => r.qty == null || r.qty < 0) || !(rows[0].qty > 0)) return { error: "qty" };
  const filled = rows.filter((r) => r.qty > 0);
  const complete = choice === "both" && rows.every((r) => r.qty > 0) && rows.every((r) => Math.abs(r.qty - rows[0].qty) < 1e-9);
  let premium;
  if (mode === "legs") {
    if (filled.some((r) => r.price == null || r.price < 0)) return { error: "price" };
    premium = filled.reduce((a, r) => a + (r.act === "buy" ? 1 : -1) * r.qty * r.price, 0);
  } else {
    if (!ok(premiumTotal) || premiumTotal < 0) return { error: "premium" };
    premium = premiumTotal;
  }
  if (feesKnown && (!ok(fees) || fees < 0)) return { error: "fees" };
  // Fees not entered: Derive's fee formula on the entered leg prices, or for a package total on the
  // board's limits. Either way it is marked as an estimate.
  const est = feesKnown ? null : estimateFees(mode === "legs" ? filled : filled.map((r) => ({ ...r, price: legs[rows.indexOf(r)]?.limit ?? null })), board);
  const feeUsed = feesKnown ? fees : est;
  const contracts = complete ? rows[0].qty : plannedContracts;
  const total = feeUsed == null ? null : premium + feeUsed;
  const be = complete ? settleBreakeven({ side, lo, hi, contracts, cost: total ?? premium }) : null;
  return {
    complete, contracts,
    fill: {
      mode, complete, currency: CURRENCY,
      legs: rows.map((r) => ({ name: r.name, act: r.act, planned: r.planned, qty: r.qty, signed_qty: round((r.act === "buy" ? 1 : -1) * r.qty), price: r.price })),
      premium: round(premium, 6), fees: feesKnown ? round(fees, 6) : null, fees_known: !!feesKnown,
      limitation: mode === "total" ? "package_total" : null,
    },
    cost: {
      premium: round(premium, 6), fees: feeUsed == null ? null : round(feeUsed, 6),
      fees_basis: feesKnown ? "entered" : est != null ? "estimated" : "unknown",
      total: total == null ? null : round(total, 6),
      breakeven: be == null ? null : round(be, 2),
      breakeven_basis: !complete || be == null ? "unavailable" : feesKnown ? "exact" : est != null ? "estimated" : "before_fees",
    },
  };
}

/** The journal block kept on a position saved from "I placed it". */
export function journalEntry({ facts, context, mark, estimate, pkg, savedTs }) {
  return {
    schema: JOURNAL_SCHEMA, source: "manual", venue: "Derive", network: pkg.network,
    entered_by_you: ["fill_ts", "fill", "fees"],
    saved_ts: savedTs,
    package: pkg,
    fill: { ts: context.fill_ts, ...facts.fill },
    cost: facts.cost,
    board_estimate: estimate, // what the Saloon's board estimated: never a fill
    mark,
    context,
  };
}

/** The strip: each saved reading beside the latest one. Entry cells show a value only for readings
 * published at or before the fill; later or missing ones explain why in their (i). */
export function compareReadings(p, markets, now = Date.now() / 1000) {
  const ctx = p?.journal?.context;
  const und = p?.und;
  const horizon = ctx?.horizon || horizonFor(p?.settle_ts, now);
  return KINDS.map(([kind, name]) => {
    const saved = ctx?.readings?.[kind] || null;
    // The latest reading as it stands now (a reading past its window reads "Updating").
    const latest = markets ? readingFrom(markets, und, horizon, kind, now) : null;
    let entry;
    if (!ctx) entry = { show: false, text: "Not available yet", why: "This position was saved before Cowboy kept the readings at entry." };
    else if (!saved || !saved.available) entry = { show: false, text: "Not available yet", why: saved?.why || "No reading was published for this layer when the position was saved." };
    else if (saved.timing !== "entry") entry = { show: false, text: "Saved later", why: laterWhy(saved, ctx) };
    else entry = { show: true, text: saved.label, state: saved.state, ts: saved.source_ts, published: saved.published_at };
    let now_;
    if (!latest || !latest.available) now_ = { show: false, text: "Not available yet", why: latest?.why || "The latest readings have not loaded." };
    else if (saved && !sameBasis(saved, latest)) now_ = { show: false, text: "Not available yet", why: "This reading is now calculated differently from the one saved at entry, so the two are not compared." };
    else now_ = { show: true, text: latest.label, state: latest.state, ts: latest.source_ts, published: latest.published_at };
    return { kind, name, horizon, entry, latest: now_ };
  });
}

function sameBasis(a, b) {
  return a.horizon === b.horizon && a.version?.align === b.version?.align && (a.version?.reading ?? null) === (b.version?.reading ?? null);
}

const hm = (t) => `${new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

function laterWhy(r, ctx) {
  const reading = r.available ? ` It read ${r.label}.` : "";
  if (r.reconstructed) return `This reading comes from history rebuilt after the fact, not something shown at your fill.${reading}`;
  if (ctx.fill_ts == null) return `No fill time was entered, so Cowboy cannot tell what was available when it filled. It saved the reading published ${r.published_at ? hm(r.published_at) : "at an unknown time"} as later context.${reading}`;
  if (r.published_at == null) return `This reading's publication time is unknown, so it is kept as later context.${reading}`;
  return `Published ${hm(r.published_at)}, after your fill at ${hm(ctx.fill_ts)}, so it is later context, not what was available at the fill.${reading}`;
}

/** Older entries (saved before the journal) stay visible with every journal field unknown. */
export const hasJournal = (p) => !!p?.journal && p.journal.schema >= 1;
