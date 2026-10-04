// Saved outcomes ("Follow") and the notices shown on return to the Saloon, kept in this browser
// only. Nothing is sent anywhere and nothing runs in the background: on each visit the latest
// published files are compared with what this browser last saw. Storage can be blocked, cleared or
// hold an older shape, so every read and write is guarded and falls back to memory.

import { useEffect, useState } from "react";
import { ANSWER, centsUp, countdown, dayLabel, findLevel, live, money, parseId, payAt } from "./questions.js";
import { DEFAULT_BUDGET, cleanBudget } from "./board.js";
import { viewReading } from "./presentation.js";
import { REGIME, SIGNAL_LABEL } from "./format.js";

export const KEY = "cowboy-follows";
export const VERSION = 1;
export const SOON_SEC = 6 * 3600;
const KEEP_AFTER_SETTLE = 7 * 86400;
const MAX_NOTICES = 30;
const MAX_DISMISSED = 300;

const empty = () => ({ version: VERSION, budget: DEFAULT_BUDGET, follows: [], research: {}, notices: [], dismissed: [] });
let memory = empty();
const listeners = new Set();

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

const ok = (v) => v != null && Number.isFinite(v);

/** A follow kept only when its id parses and its side is Higher ("yes") or Lower ("no"). */
export function cleanFollow(f) {
  if (!f || typeof f.id !== "string" || (f.side !== "yes" && f.side !== "no")) return null;
  const p = parseId(f.id);
  if (!p) return null;
  const settle = Date.UTC(+p.expiry.slice(0, 4), +p.expiry.slice(4, 6) - 1, +p.expiry.slice(6, 8), 8) / 1000;
  const seen = f.seen && typeof f.seen === "object" ? f.seen : {};
  return {
    id: f.id, side: f.side, und: p.und, expiry: p.expiry, k: p.k, lo: p.lo, hi: p.hi, settle_ts: settle,
    at: ok(f.at) ? f.at : 0,
    level: ok(f.level) && f.level >= 1 && f.level <= 99 ? Math.round(f.level) : null,
    seen: { live: !!seen.live, buy: ok(seen.buy) ? seen.buy : null, soon: !!seen.soon, settled: !!seen.settled, init: seen.init !== false },
  };
}

/**
 * Any stored shape to the current one. Version 0 was a bare list of follows; a document from a
 * newer version keeps what this version understands. Anything unreadable gives an empty document.
 */
export function migrate(raw) {
  const doc = empty();
  if (Array.isArray(raw)) raw = { follows: raw };
  if (!raw || typeof raw !== "object") return doc;
  const seen = new Set();
  doc.follows = (Array.isArray(raw.follows) ? raw.follows : []).map(cleanFollow).filter((f) => {
    if (!f) return false;
    const k = followKey(f);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  doc.budget = raw.budget == null ? DEFAULT_BUDGET : cleanBudget(raw.budget);
  doc.research = raw.research && typeof raw.research === "object" && !Array.isArray(raw.research) ? raw.research : {};
  doc.notices = (Array.isArray(raw.notices) ? raw.notices : []).filter((n) => n && typeof n.key === "string" && typeof n.text === "string").slice(-MAX_NOTICES);
  doc.dismissed = (Array.isArray(raw.dismissed) ? raw.dismissed : []).filter((k) => typeof k === "string").slice(-MAX_DISMISSED);
  return doc;
}

export function loadDoc() {
  const s = storage();
  if (!s) return migrate(memory);
  try {
    const text = s.getItem(KEY);
    return text ? migrate(JSON.parse(text)) : migrate(memory);
  } catch {
    return migrate(memory);
  }
}

export function saveDoc(doc) {
  memory = migrate(doc);
  const s = storage();
  let saved = false;
  if (s) {
    try {
      s.setItem(KEY, JSON.stringify(memory));
      saved = true;
    } catch {
      saved = false;
    }
  }
  listeners.forEach((fn) => fn());
  return saved;
}

/** Re-renders a component whenever the saved document changes in this tab. */
export function useFollowsDoc() {
  const [doc, setDoc] = useState(loadDoc);
  useEffect(() => {
    const fn = () => setDoc(loadDoc());
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return doc;
}

export const followKey = (f) => `${f.id}:${f.side}`;
export const isFollowing = (doc, id, side) => doc.follows.some((f) => f.id === id && f.side === side);

/** The budget used by the board and as the guided flow's first amount. */
export const loadBudget = () => loadDoc().budget;
export function saveBudget(v) {
  const doc = loadDoc();
  doc.budget = cleanBudget(v);
  saveDoc(doc);
  return doc.budget;
}

/** What a side looks like now, for the follow's "last seen". */
function sideNow(board, id, side, now) {
  const found = board ? findLevel(board, id) : null;
  const level = found && !found.settled ? found.level : null;
  const isLive = !!level && live(level, side, !!board?.paused, now);
  return { live: isLive, buy: isLive ? centsUp(level[side].buy) : null };
}

/** Follow an answer (id and side). `board` is its coin file, if at hand, so the follow starts from
 * what the user sees now and only later changes become notices. */
export function follow(id, side, { board = null, level = null, now = Date.now() / 1000 } = {}) {
  const doc = loadDoc();
  if (isFollowing(doc, id, side)) return doc;
  const f = cleanFollow({ id, side, at: Math.floor(now), level });
  if (!f) return doc;
  const s = sideNow(board, id, side, now);
  f.seen = { ...s, soon: f.settle_ts - now <= SOON_SEC, settled: now >= f.settle_ts, init: !!board };
  doc.follows.push(f);
  saveDoc(doc);
  return doc;
}

export function unfollow(id, side) {
  const doc = loadDoc();
  doc.follows = doc.follows.filter((f) => !(f.id === id && f.side === side));
  saveDoc(doc);
  return doc;
}

/** The cost per $1 (in cents) at or below which a notice appears; null clears it. */
export function setLevel(id, side, cents) {
  const doc = loadDoc();
  const c = cents === "" || cents == null ? null : Number(cents);
  doc.follows = doc.follows.map((f) => (f.id === id && f.side === side
    ? { ...f, level: ok(c) && c >= 1 && c <= 99 ? Math.round(c) : null } : f));
  saveDoc(doc);
  return doc;
}

export function dismiss(key) {
  const doc = loadDoc();
  doc.notices = doc.notices.filter((n) => n.key !== key);
  doc.dismissed = [...doc.dismissed, key].slice(-MAX_DISMISSED);
  saveDoc(doc);
  return doc;
}

export function dismissAll() {
  const doc = loadDoc();
  doc.dismissed = [...doc.dismissed, ...doc.notices.map((n) => n.key)].slice(-MAX_DISMISSED);
  doc.notices = [];
  saveDoc(doc);
  return doc;
}

export function exportFollows() {
  const { version, budget, follows } = loadDoc();
  return JSON.stringify({ kind: "cowboy-follows", version, budget, follows: follows.map(({ id, side, level, at }) => ({ id, side, level, at })) }, null, 1);
}

/** Adds the follows in an exported file; ones already followed keep their own settings. */
export function importFollows(text) {
  const incoming = migrate(JSON.parse(text));
  const doc = loadDoc();
  const have = new Set(doc.follows.map(followKey));
  for (const f of incoming.follows) if (!have.has(followKey(f))) doc.follows.push({ ...f, seen: { ...f.seen, init: false } });
  saveDoc(doc);
  return doc;
}

/** The research readings a notice compares, for one coin's markets.json row. */
export function researchOf(row, now) {
  if (!row) return null;
  const lean = (h) => viewReading(row.align, h, "options", now).state || null;
  return { regime: row.regime_1d || null, signal: row.signal_1d || null, lean7: lean("7d"), lean30: lean("30d") };
}

const LEAN = { up: "Upward tone", defensive: "Defensive tone", neutral: "Balanced tone" };
const answerText = (f) => `${f.und} ${ANSWER[f.side]} · ${money(f.k)} on ${dayLabel(f.expiry)}`;

/** The research changes between two snapshots, in plain words; only readings present in both count. */
export function researchChanges(before, after) {
  if (!before || !after) return [];
  const out = [];
  const add = (key, name, map) => {
    if (before[key] && after[key] && before[key] !== after[key]) out.push(`${name} now ${map[after[key]] || after[key]} (was ${map[before[key]] || before[key]})`);
  };
  add("regime", "Regime", REGIME);
  add("signal", "Engine reading", SIGNAL_LABEL);
  add("lean7", "Options (next 7 days)", LEAN);
  add("lean30", "Options (next 30 days)", LEAN);
  return out;
}

/** A settled answer's result: the settlement price and what the side paid per $1. */
function settledResult(f, board, hist) {
  const d = (board?.settled || []).find((s) => s.expiry === f.expiry);
  const price = ok(d?.settle_price) ? d.settle_price : ok(hist?.settle_price) ? hist.settle_price : null;
  if (price == null) return null;
  return { price, per: payAt(price, f.lo, f.hi, f.side) };
}

/**
 * Compares the latest published files with what this browser last saw and returns the document
 * with new notices and updated "last seen" values. Pure: no storage, no clock beyond `now`.
 *   boards   {UND: questions/{UND}.json}   only coins whose file has loaded
 *   hist     {"UND-YYYYMMDD": history json} for follows past settlement
 *   markets  markets.json, or null
 * Notices: cost reached your level, a price is available again, settles within 6 hours, settled
 * (with what it paid), a research reading changed. Each is keyed so that it appears once.
 */
export function computeNotices(input, { boards = {}, hist = {}, markets = null, now = Date.now() / 1000 } = {}) {
  const doc = migrate(input);
  const known = new Set([...doc.notices.map((n) => n.key), ...doc.dismissed]);
  const fresh = [];
  const add = (n) => {
    if (known.has(n.key)) return;
    known.add(n.key);
    fresh.push({ ...n, at: Math.floor(now) });
  };
  doc.follows = doc.follows.filter((f) => now - f.settle_ts < KEEP_AFTER_SETTLE);
  for (const f of doc.follows) {
    const board = boards[f.und];
    const h = hist[`${f.und}-${f.expiry}`];
    const base = { und: f.und, id: f.id, side: f.side };
    if (now >= f.settle_ts) {
      if (f.seen.settled) continue;
      const r = settledResult(f, board, h);
      if (!r) continue;
      add({ ...base, kind: "settled", key: `settled:${followKey(f)}`,
        text: `${answerText(f)} settled at ${money(r.price)}: paid ${Math.round(r.per * 100)}c per $1` });
      f.seen = { ...f.seen, settled: true, live: false, buy: null };
      continue;
    }
    if (!board) continue;
    const s = sideNow(board, f.id, f.side, now);
    if (f.seen.init) {
      const reached = f.level != null && s.live && s.buy <= f.level;
      const wasReached = f.level != null && f.seen.live && f.seen.buy != null && f.seen.buy <= f.level;
      if (reached && !wasReached) {
        add({ ...base, kind: "level", key: `level:${followKey(f)}:${board.prices_ts}`,
          text: `${answerText(f)} costs ${s.buy}c per $1, at or below your ${f.level}c` });
      } else if (s.live && !f.seen.live) {
        add({ ...base, kind: "available", key: `available:${followKey(f)}:${board.prices_ts}`,
          text: `${answerText(f)} has a price again: ${s.buy}c per $1` });
      }
    }
    if (!f.seen.soon && f.settle_ts - now <= SOON_SEC) {
      add({ ...base, kind: "soon", key: `soon:${followKey(f)}`, text: `${answerText(f)} settles ${countdown(f.settle_ts, now)}, 08:00 UTC` });
    }
    f.seen = { ...f.seen, ...s, soon: f.seen.soon || f.settle_ts - now <= SOON_SEC, init: true };
  }
  if (markets?.coins) {
    for (const und of [...new Set(doc.follows.map((f) => f.und))]) {
      const now_ = researchOf(markets.coins.find((c) => c.und === und), now);
      if (!now_) continue;
      const changes = researchChanges(doc.research[und], now_);
      if (changes.length) {
        add({ und, kind: "research", key: `research:${und}:${JSON.stringify(now_)}`, text: `${und} research: ${changes.join("; ")}` });
      }
      doc.research[und] = now_;
    }
  }
  doc.notices = [...doc.notices, ...fresh].slice(-MAX_NOTICES);
  return { doc, fresh };
}

export function _resetMemory() {
  memory = empty();
}
