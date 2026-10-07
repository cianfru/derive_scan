import { useEffect, useState } from "react";
import { loadBudget } from "./follows.js";
import { parseId } from "./questions.js";

const KEY = "cowboy-decision";
const listeners = new Set();
let memory = null;
let transient = false;
const empty = () => ({ amountDraft: String(loadBudget()), coin: null, outcome: null, panelOpen: false, view: "chart", list: {}, compare: [], entries: [] });
const selection = (s) => {
  const p = parseId(s?.id);
  return p && ["yes", "no"].includes(s.side) ? { id: s.id, side: s.side, und: p.und, expiry: p.expiry } : null;
};

export function readDecision() {
  if (transient && memory) return memory;
  let raw;
  try { raw = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return memory || empty(); }
  if (!raw) return empty();
  const d = empty();
  d.amountDraft = typeof raw.amountDraft === "string" && /^[\d.]*$/.test(raw.amountDraft) ? raw.amountDraft : d.amountDraft;
  d.coin = typeof raw.coin === "string" && /^[A-Z0-9]+$/.test(raw.coin) ? raw.coin : null;
  d.outcome = selection(raw.outcome);
  d.panelOpen = raw.panelOpen === true;
  d.view = raw.view === "list" ? "list" : "chart";
  d.list = raw.list && typeof raw.list === "object" ? raw.list : {};
  d.entries = (Array.isArray(raw.entries) ? raw.entries : []).filter((k) => typeof k === "string").slice(-40);
  d.compare = (Array.isArray(raw.compare) ? raw.compare : []).map(selection).filter(Boolean)
    .filter((s, i, all) => all.findIndex((v) => v.id === s.id && v.side === s.side) === i).slice(0, 3);
  return d;
}

export function updateDecision(change) {
  const previous = readDecision();
  const next = { ...previous, ...(typeof change === "function" ? change(previous) : change) };
  memory = next;
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); transient = false; } catch { transient = true; }
  listeners.forEach((fn) => fn(next));
  return next;
}

/** Only the person's choices are retained. Prices and outcome data are always read afresh. */
export function useDecision(initialDollars, initialDraft, entryKey) {
  const visited = entryKey && readDecision().entries.includes(entryKey);
  const initial = visited ? null : typeof initialDraft === "string" && /^[\d.]*$/.test(initialDraft) ? initialDraft
    : Number.isFinite(initialDollars) && initialDollars > 0 ? String(initialDollars) : null;
  const [d, set] = useState(() => initial == null ? readDecision() : { ...readDecision(), amountDraft: initial });
  useEffect(() => {
    listeners.add(set);
    if (initial != null) updateDecision((previous) => ({ amountDraft: initial,
      entries: entryKey ? [...previous.entries.filter((k) => k !== entryKey), entryKey].slice(-40) : previous.entries }));
    else set(readDecision());
    return () => listeners.delete(set);
  }, []);
  return [d, updateDecision];
}

export function retainOutcome(s) {
  const chosen = selection(s);
  if (chosen) updateDecision({ coin: chosen.und, outcome: chosen, panelOpen: true });
}

export function toggleComparison(s) {
  const chosen = selection(s);
  if (!chosen) return;
  updateDecision((d) => {
    const on = d.compare.some((v) => v.id === chosen.id && v.side === chosen.side);
    return { compare: on ? d.compare.filter((v) => v.id !== chosen.id || v.side !== chosen.side)
      : d.compare.length < 3 ? [...d.compare, chosen] : d.compare };
  });
}

export function saloonReturn(coin, d = readDecision()) {
  const p = new URLSearchParams();
  if (d.view === "list") p.set("view", "list");
  const und = coin || d.coin;
  if (und) p.set("coin", und);
  if (d.outcome?.und === und) { p.set("outcome", d.outcome.id); p.set("side", d.outcome.side); }
  return `/saloon${p.size ? `?${p}` : ""}`;
}

export function _resetDecision() {
  memory = null;
  transient = false;
  try { sessionStorage.removeItem(KEY); } catch { /* Test cleanup. */ }
  listeners.forEach((fn) => fn(empty()));
}
