import { sameLegs } from "./questions.js";

// Positions: what the user says they placed on Derive, kept in this browser only. Nothing is sent
// anywhere. Storage can be blocked or cleared, so every read and write falls back to memory.

const KEY = "cowboy-questions";
let memory = [];

function storage() {
  try {
    const s = globalThis.localStorage;
    const probe = "__cowboy_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function loadPositions() {
  const s = storage();
  if (!s) return [...memory];
  try {
    const v = JSON.parse(s.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter(valid) : [];
  } catch {
    return [...memory];
  }
}

export function savePositions(list) {
  memory = [...list];
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function valid(p) {
  return p && typeof p.id === "string" && (p.side === "yes" || p.side === "no") && Number.isFinite(p.contracts) && p.contracts > 0;
}

/** Saved from "I placed it": the question, the side, contracts, what the user says they paid (fees
 * included), how it was placed (`exec`: "hand_both", or "hand_partial" when only the first option
 * filled; older entries have none and count as both) and the exact instruments held (`legs`). */
export function addPosition(p) {
  const list = loadPositions();
  const row = { key: `${p.id}:${p.side}:${Date.now()}`, at: Math.floor(Date.now() / 1000), ...p };
  if (!valid(row)) return list;
  list.push(row);
  savePositions(list);
  return list;
}

/** Sold back by hand: what came back after fees closes the position. */
export function closePosition(key, proceeds, now = Date.now() / 1000) {
  const list = loadPositions().map((p) => (p.key === key ? { ...p, closed_at: Math.floor(now), proceeds } : p));
  savePositions(list);
  return list;
}

export const partial = (p) => p.exec === "hand_partial";

export function removePosition(key) {
  const list = loadPositions().filter((p) => p.key !== key);
  savePositions(list);
  return list;
}

/** Positions settled more than 90 days ago are dropped. */
export function prune(list, now = Date.now() / 1000) {
  return list.filter((p) => !p.settle_ts || now - p.settle_ts < 90 * 86400);
}

export function exportPositions() {
  return JSON.stringify({ kind: "cowboy-questions", version: 1, positions: loadPositions() }, null, 1);
}

export function importPositions(text) {
  const doc = JSON.parse(text);
  const rows = (Array.isArray(doc) ? doc : doc?.positions || []).filter(valid);
  const have = new Set(loadPositions().map((p) => p.key));
  const list = [...loadPositions(), ...rows.filter((r) => !have.has(r.key))];
  savePositions(list);
  return list;
}

/** What a position is worth now at the published sell-back price after Derive's exit fees, what it
 * paid at settlement, or what the user got selling back. A position with only its first option
 * filled has no value here: Cowboy prices the full answer only. */
export function valuePosition(p, found, settlePrice = null, exitFees = null) {
  const w = p.hi - p.lo;
  if (p.closed_at) return { settled: true, closed: true, got: p.proceeds };
  if (partial(p)) return { settled: settlePrice != null, partial: true, now: null };
  if (settlePrice != null) {
    const y = Math.min(1, Math.max(0, (settlePrice - p.lo) / w));
    const per = p.side === "yes" ? y : 1 - y;
    return { settled: true, per, got: per * w * p.contracts };
  }
  const side = found?.level?.[p.side];
  if (!side || side.sell == null || found?.level?.state === "settling") return { settled: false, now: null };
  if (p.legs && !sameLegs(p.legs, side.legs)) return { settled: false, now: null, otherLegs: true };
  const gross = side.sell * w * p.contracts;
  return { settled: false, gross, fees: exitFees, now: exitFees == null ? null : gross - exitFees, mark: found.level.fair == null ? null
    : (p.side === "yes" ? found.level.fair : 1 - found.level.fair) * w * p.contracts };
}

export function _resetMemory() {
  memory = [];
}
