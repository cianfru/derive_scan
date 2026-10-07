// Live index prices (owner, 7 October 2026: "I want the web socket integrated 100% and we need to have fresh
// candles all the time"). One shared connection per page to Derive's public `spot_feed.{UND}` channel (the
// index the Saloon settles against, about every 3 seconds, with the price 24 hours earlier). Read-only market
// data: no sign-in, no trading methods. Opened when a component asks for a coin, closed when none do, and
// reopened after a drop.
import { useEffect, useMemo, useState } from "react";
import { useClock } from "./useClock.js";

// Builds that trade on the testnet (testnet fills, the dry run) read the testnet's index, which tracks mainnet's;
// real-money builds and builds without trading read mainnet's.
const TRADE = import.meta.env.VITE_SALOON_TRADE || "";
export const LIVE_WS = TRADE && TRADE !== "mainnet" ? "wss://testnet.api.derive.xyz/v3/ws" : "wss://api.derive.xyz/v3/ws";
const RETRY_MS = 3000;
export const LIVE_PRICE_MAX_AGE = 30;

const latest = new Map(); // und -> {price, prev, ts}
const listeners = new Map(); // und -> Set(fn)
const pending = new Map(); // request id -> {resolve, reject, timer}
const queued = new Map(); // request id -> body waiting for the connection
let ws = null, retry = 0, id = 0;
let connected = false;

const validTime = (ts) => Number.isFinite(ts) && ts > 0;
const validPrice = (price) => Number.isFinite(price) && price > 0;
const clockText = (ts) => validTime(ts) ? new Date(ts * 1000).toISOString().slice(11, 19) + " UTC" : null;

/** Current-index provenance only. Published option quotes and daily closes keep their own clocks. */
export function indexPriceState(live, publishedPrice, publishedTs = null, now = Date.now() / 1000) {
  const goodLive = validPrice(live?.price) && validTime(live?.ts) && live.ts <= now + 5;
  const fresh = goodLive && live.connected === true && now - live.ts <= LIVE_PRICE_MAX_AGE;
  const published = validPrice(publishedPrice);
  const publishedTime = validTime(publishedTs) && publishedTs <= now + 5;
  const newerPublished = published && publishedTime && (!goodLive || publishedTs > live.ts);
  if (fresh) return { ...live, source: "live", state: "live", fresh: true, notice: `Live index · ${clockText(live.ts)}` };
  if (goodLive && !newerPublished) {
    const state = live.connected ? "stale" : "disconnected";
    return { ...live, source: "live", state, fresh: false,
      notice: `${state === "disconnected" ? "Live index disconnected" : "Live index stale"} · last received ${clockText(live.ts)}` };
  }
  if (published) return { price: publishedPrice, prev: null, ts: publishedTime ? publishedTs : null,
    source: "published", state: "published", fresh: false, connected: !!live?.connected,
    notice: `Published index${publishedTime ? ` · ${clockText(publishedTs)}` : ""} · live index unavailable` };
  return { price: null, prev: null, ts: null, source: "unavailable", state: "unavailable", fresh: false,
    connected: !!live?.connected, notice: "Index price unavailable" };
}

function emit(und) {
  const value = latest.get(und);
  for (const fn of listeners.get(und) || []) fn(value ? { ...value, connected } : null);
}
function connection(opened) {
  connected = opened;
  for (const und of listeners.keys()) emit(und);
}

/** A spot_feed notification -> [[und, {price, prev, ts}]]. */
export function parseSpot(msg) {
  const data = msg?.method === "subscription" && String(msg.params?.channel || "").startsWith("spot_feed.") ? msg.params.data : null;
  if (!data?.feeds) return [];
  return Object.entries(data.feeds).map(([und, f]) => [und, { price: Number(f.price), prev: Number(f.price_prev_daily), ts: Number(data.timestamp) / 1000 }])
    .filter(([, v]) => validPrice(v.price) && validTime(v.ts));
}

function send(method, channels) {
  if (ws?.readyState === 1 && channels.length) ws.send(JSON.stringify({ id: ++id, method, params: { channels } }));
}

function open() {
  // Tests never reach the network: the feed stays closed and pages show the published prices.
  if (ws || typeof WebSocket === "undefined" || !listeners.size || import.meta.env.MODE === "test") return;
  try { ws = new WebSocket(LIVE_WS); } catch {
    connection(false); clearTimeout(retry); retry = setTimeout(open, RETRY_MS); return;
  }
  const socket = ws;
  ws.onopen = () => {
    if (ws !== socket) return;
    connection(true);
    send("subscribe", [...listeners.keys()].map((u) => `spot_feed.${u}`));
    for (const [rid, body] of queued) { if (pending.has(rid)) socket.send(body); }
    queued.clear();
  };
  ws.onmessage = (e) => {
    if (ws !== socket) return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const req = msg?.id != null && pending.get(msg.id);
    if (req) {
      pending.delete(msg.id); clearTimeout(req.timer);
      if (msg.error) req.reject(new Error(msg.error.message || "Derive error")); else req.resolve(msg.result);
      return;
    }
    for (const [und, v] of parseSpot(msg)) {
      if (v.ts > Date.now() / 1000 + 5 || v.ts < (latest.get(und)?.ts || 0)) continue;
      latest.set(und, v);
      emit(und);
    }
  };
  ws.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    connection(false);
    if (listeners.size) { clearTimeout(retry); retry = setTimeout(open, RETRY_MS); }
  };
  ws.onerror = () => { try { socket.close(); } catch { /* closing */ } };
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const rid = ++id, body = JSON.stringify({ id: rid, method, params });
    const timer = setTimeout(() => { pending.delete(rid); queued.delete(rid); reject(new Error("timeout")); }, 10000);
    pending.set(rid, { resolve, reject, timer });
    if (ws?.readyState === 1) ws.send(body); else queued.set(rid, body);
    open();
  });
}

/** Index candles [t, o, h, l, c] (seconds) of `und` from `start`, the forming one included: what the published
 * file has not caught up with yet. Asked over the shared connection, which a listener on `und` keeps open. */
export async function recentBars(und, period, start) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await request("public/get_index_chart_data", { currency: und, period, start_timestamp: Math.max(start, now - 20 * period), end_timestamp: now });
  return (Array.isArray(rows) ? rows : []).map((c) => [Number(c.timestamp), +c.open_price, +c.high_price, +c.low_price, +c.close_price])
    .filter((b) => b.slice(1).every((v) => Number.isFinite(v) && v > 0) && b[0] >= start).sort((a, b) => a[0] - b[0]);
}

/** Calls fn with each live price of `und`; returns the unsubscribe. */
export function watchPrice(und, fn) {
  if (!und) return () => {};
  let set = listeners.get(und);
  if (!set) { set = new Set(); listeners.set(und, set); send("subscribe", [`spot_feed.${und}`]); }
  set.add(fn);
  if (latest.has(und)) fn({ ...latest.get(und), connected });
  open();
  return () => {
    set.delete(fn);
    if (set.size) return;
    listeners.delete(und);
    send("unsubscribe", [`spot_feed.${und}`]);
    if (!listeners.size) {
      clearTimeout(retry);
      connected = false;
      if (ws) { const s = ws; ws = null; s.onclose = null; try { s.close(); } catch { /* closed */ } }
    }
  };
}

/** The last live index and its connection/freshness, or null until a valid tick arrives. */
export function useLivePrice(und) {
  const [reading, setReading] = useState(() => ({ und, value: latest.has(und) ? { ...latest.get(und), connected } : null }));
  const now = useClock();
  useEffect(() => {
    setReading({ und, value: latest.has(und) ? { ...latest.get(und), connected } : null });
    return watchPrice(und, (value) => setReading({ und, value }));
  }, [und]);
  const value = reading.und === und ? reading.value : null;
  const state = value ? indexPriceState(value, null, null, now).state : null;
  return useMemo(() => value ? { ...value, state, fresh: state === "live" } : null, [value, state]);
}

/** One source for every “index now” display and read-only settlement illustration. */
export function useIndexPrice(und, publishedPrice, publishedTs = null) {
  const live = useLivePrice(und);
  return useMemo(() => indexPriceState(live, publishedPrice, publishedTs), [live, publishedPrice, publishedTs]);
}
