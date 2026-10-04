import { remainingQty } from "./realized.js";

// Combined exposure at expiry (Discovery and return 3): open positions grouped by coin, settlement
// reference and date, each group drawn as one payoff from the combined legs, after what was paid.
// Every figure is a fact at Derive's 08:00 UTC settlement for a given settlement price, never a view
// of where the price settles. Different dates settle independently, so the total most-you-can-lose
// across groups is the sum of each group's combined worst case; within a group it comes from the
// combined payoff, never from adding tickets.

const ok = Number.isFinite;

/** "BTC-20261009-83000-C" (fractional strikes written "1_35") as its parts, or null. */
export function parseInstrument(name) {
  const m = /^([A-Z0-9]+)-(\d{8})-([\d_.]+)-([CP])$/.exec(name || "");
  if (!m) return null;
  const strike = Number(m[3].replace("_", "."));
  return ok(strike) ? { name, und: m[1], expiry: m[2], strike, kind: m[4] } : null;
}

/** What one option pays per contract at settlement price S. */
export const intrinsic = (leg, S) => (leg.kind === "C" ? Math.max(0, S - leg.strike) : Math.max(0, leg.strike - S));

/** Derive settles every option on a coin against that coin's index, averaged over 07:30-08:00 UTC. */
export const settleRef = (und) => `${und} index, 30-minute average to 08:00 UTC`;

const expiryOf = (p) => p.journal?.package?.expiry || /^[A-Z0-9]+-(\d{8})-/.exec(p.id || "")?.[1] || null;

/**
 * A position's exposure at settlement: its legs (signed contracts per instrument) and what it cost,
 * for the part still open. The exact instruments and filled amounts from the journal when recorded
 * (a partial fill counts only the legs that filled); an older record without them is drawn from its
 * answer (Higher pays like a call spread from lo to hi, Lower like a put spread), marked as such.
 */
export function positionExposure(p) {
  const left = remainingQty(p);
  if (!(left > 0) || !(p.contracts > 0)) return null;
  const r = left / p.contracts;
  const j = p.journal;
  const fillLegs = (j?.fill?.legs || []).filter((l) => l.qty > 0 && ok(l.signed_qty));
  let legs = null, basis = "instruments";
  if (fillLegs.length) {
    const parsed = fillLegs.map((l) => ({ ...parseInstrument(l.name), qty: l.signed_qty * r }));
    if (parsed.every((l) => l.name)) legs = parsed;
  }
  if (!legs) {
    if (!(p.hi > p.lo) || (p.side !== "yes" && p.side !== "no")) return null;
    const c = p.contracts * r;
    legs = p.side === "yes"
      ? [{ kind: "C", strike: p.lo, qty: c }, { kind: "C", strike: p.hi, qty: -c }]
      : [{ kind: "P", strike: p.hi, qty: c }, { kind: "P", strike: p.lo, qty: -c }];
    basis = "answer";
  }
  const c = j?.cost;
  const total = c ? (c.total ?? c.premium) : p.paid;
  const feesBasis = c ? c.fees_basis : "included";
  return {
    key: p.key, und: p.und || legs[0]?.und || p.id?.split("-")[0], expiry: expiryOf(p), settle_ts: p.settle_ts ?? null,
    legs, cost: ok(total) ? total * r : null, feesBasis, basis, partial: p.exec === "hand_partial", remaining: r,
  };
}

/** Net contracts per instrument (offsetting legs cancel), keeping only those that do not. */
export function netLegs(legs) {
  const by = new Map();
  for (const l of legs) {
    const k = `${l.kind}${l.strike}`;
    const cur = by.get(k);
    by.set(k, cur ? { ...cur, qty: cur.qty + l.qty } : { kind: l.kind, strike: l.strike, name: l.name, qty: l.qty });
  }
  return [...by.values()].filter((l) => Math.abs(l.qty) > 1e-12);
}

/** Gross payout of a set of legs at S (what the options pay, before anything paid). */
export const payoutAt = (legs, S) => legs.reduce((a, l) => a + l.qty * intrinsic(l, S), 0);

/**
 * The combined position's figures at settlement, from its legs and its total cost (fees included as
 * recorded). The payoff is piecewise linear with corners at the strikes, so its extremes lie at a
 * strike, at zero or past the highest strike (where it grows or falls without limit when net calls
 * are long or short).
 *   mostLose    the worst result after cost, as a positive amount (Infinity when unlimited)
 *   mostPays    the most the options pay back in total (Infinity when it keeps growing)
 *   mostMake    the best result after cost (Infinity when unlimited)
 *   breakevens  settlement prices where the result after cost is zero
 */
export function combine(legsIn, cost) {
  const legs = netLegs(legsIn);
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const pts = [0, ...strikes.filter((k) => k > 0)];
  const pl = (S) => payoutAt(legs, S) - cost;
  const slopeRight = legs.reduce((a, l) => a + (l.kind === "C" ? l.qty : 0), 0);
  const vals = pts.map(pl);
  const pays = pts.map((S) => payoutAt(legs, S));
  const eps = 1e-9;
  const worst = slopeRight < -eps ? -Infinity : Math.min(...vals);
  const best = slopeRight > eps ? Infinity : Math.max(...vals);
  const mostPays = slopeRight > eps ? Infinity : Math.max(...pays);
  const breakevens = [];
  const push = (x) => { if (!breakevens.some((b) => Math.abs(b - x) < 1e-6)) breakevens.push(x); };
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [a, b] = [vals[i], vals[i + 1]];
    if (Math.abs(a) < eps) push(pts[i]);
    else if ((a < 0 && b > 0) || (a > 0 && b < 0)) push(pts[i] + (pts[i + 1] - pts[i]) * (-a / (b - a)));
  }
  const last = pts[pts.length - 1];
  const vLast = vals[vals.length - 1];
  if (Math.abs(vLast) < eps && last > 0) push(last);
  else if (Math.abs(slopeRight) > eps && vLast * slopeRight < 0) push(last - vLast / slopeRight);
  return {
    legs, strikes, cost, pl, slopeRight,
    mostLose: worst === -Infinity ? Infinity : Math.max(0, -worst),
    mostPays: Math.max(0, mostPays), mostMake: best, breakevens: breakevens.sort((a, b) => a - b),
  };
}

/** Open positions grouped by coin, settlement reference and date, each with its combined figures.
 * `sumTickets` is what adding each ticket's own worst case gives, kept only to show the difference. */
export function exposureGroups(positions, now = Date.now() / 1000) {
  const groups = new Map();
  for (const p of positions || []) {
    if (p.closed_at || (ok(p.settle_ts) && now >= p.settle_ts)) continue;
    const e = positionExposure(p);
    if (!e || !e.expiry || e.cost == null) continue;
    const key = `${e.und}|${settleRef(e.und)}|${e.expiry}`;
    if (!groups.has(key)) groups.set(key, { key, und: e.und, ref: settleRef(e.und), expiry: e.expiry, settle_ts: e.settle_ts, items: [] });
    groups.get(key).items.push(e);
  }
  return [...groups.values()].map((g) => {
    const legs = g.items.flatMap((e) => e.legs);
    const cost = g.items.reduce((a, e) => a + e.cost, 0);
    const sumTickets = g.items.reduce((a, e) => a + combine(e.legs, e.cost).mostLose, 0);
    return { ...g, ...combine(legs, cost), sumTickets,
      estimatedFees: g.items.some((e) => e.feesBasis === "estimated"), feesMissing: g.items.some((e) => e.feesBasis === "unknown"),
      fromAnswer: g.items.some((e) => e.basis === "answer"), partial: g.items.some((e) => e.partial) };
  }).sort((a, b) => (a.settle_ts ?? 0) - (b.settle_ts ?? 0) || a.und.localeCompare(b.und));
}

/** Across dates, each settling on its own: the sum of each group's combined worst case. */
export const totalMostLose = (groups) => groups.reduce((a, g) => a + g.mostLose, 0);

/** A proposed answer from the board as legs and its total cost (fees included), for `t` contracts. */
export function proposalLegs(level, side, t) {
  const s = level?.[side];
  if (!s?.legs || !t) return null;
  const legs = s.legs.map(([name, act]) => ({ ...parseInstrument(name), qty: (act === "buy" ? 1 : -1) * t.contracts }));
  if (legs.some((l) => !l.name)) return null;
  return { legs, cost: t.mostLose };
}

/** The held group on a date with a proposed trade drawn on top: figures before and with it. */
export function withTrade(group, proposal) {
  if (!group || !proposal) return null;
  const after = combine([...group.legs, ...proposal.legs], group.cost + proposal.cost);
  return { held: group, after, addsToMostLose: after.mostLose - group.mostLose };
}
