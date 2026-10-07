// Live index prices (owner, 7 October 2026: "I want the web socket integrated 100% and we need to have fresh
// candles all the time"). One shared connection per page to Derive's public `spot_feed.{UND}` channel (the
// index the Saloon settles against, about every 3 seconds, with the price 24 hours earlier). Read-only market
// data: no sign-in, no trading methods. Opened when a component asks for a coin, closed when none do, and
// reopened after a drop.
import { useEffect, useState } from "react";

// Builds that trade on the testnet (testnet fills, the dry run) read the testnet's index, which tracks mainnet's;
// real-money builds and builds without trading read mainnet's.
const TRADE = import.meta.env.VITE_SALOON_TRADE || "";
export const LIVE_WS = TRADE && TRADE !== "mainnet" ? "wss://testnet.api.derive.xyz/v3/ws" : "wss://api.derive.xyz/v3/ws";
const RETRY_MS = 3000;

const latest = new Map(); // und -> {price, prev, ts}
const listeners = new Map(); // und -> Set(fn)
const pending = new Map(); // request id -> {resolve, reject, timer}
const queued = []; // requests waiting for the connection
let ws = null, retry = 0, id = 0;

/** A spot_feed notification -> [[und, {price, prev, ts}]]. */
export function parseSpot(msg) {
  const data = msg?.method === "subscription" && String(msg.params?.channel || "").startsWith("spot_feed.") ? msg.params.data : null;
  if (!data?.feeds) return [];
  return Object.entries(data.feeds).map(([und, f]) => [und, { price: Number(f.price), prev: Number(f.price_prev_daily), ts: Number(data.timestamp) / 1000 }])
    .filter(([, v]) => Number.isFinite(v.price) && v.price > 0);
}

function send(method, channels) {
  if (ws?.readyState === 1 && channels.length) ws.send(JSON.stringify({ id: ++id, method, params: { channels } }));
}

function open() {
  // Tests never reach the network: the feed stays closed and pages show the published prices.
  if (ws || typeof WebSocket === "undefined" || !listeners.size || import.meta.env.MODE === "test") return;
  ws = new WebSocket(LIVE_WS);
  ws.onopen = () => {
    send("subscribe", [...listeners.keys()].map((u) => `spot_feed.${u}`));
    while (queued.length) ws.send(queued.shift());
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const req = msg?.id != null && pending.get(msg.id);
    if (req) {
      pending.delete(msg.id); clearTimeout(req.timer);
      if (msg.error) req.reject(new Error(msg.error.message || "Derive error")); else req.resolve(msg.result);
      return;
    }
    for (const [und, v] of parseSpot(msg)) {
      latest.set(und, v);
      for (const fn of listeners.get(und) || []) fn(v);
    }
  };
  ws.onclose = () => {
    ws = null;
    if (listeners.size) { clearTimeout(retry); retry = setTimeout(open, RETRY_MS); }
  };
  ws.onerror = () => { try { ws?.close(); } catch { /* closing */ } };
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const rid = ++id, body = JSON.stringify({ id: rid, method, params });
    const timer = setTimeout(() => { pending.delete(rid); reject(new Error("timeout")); }, 10000);
    pending.set(rid, { resolve, reject, timer });
    if (ws?.readyState === 1) ws.send(body); else queued.push(body);
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
  if (latest.has(und)) fn(latest.get(und));
  open();
  return () => {
    set.delete(fn);
    if (set.size) return;
    listeners.delete(und);
    send("unsubscribe", [`spot_feed.${und}`]);
    if (!listeners.size && ws) { clearTimeout(retry); const s = ws; ws = null; s.onclose = null; try { s.close(); } catch { /* closed */ } }
  };
}

/** The live price of `und` ({price, prev, ts}), or null until the first one arrives. */
export function useLivePrice(und) {
  const [v, setV] = useState(() => latest.get(und) || null);
  useEffect(() => { setV(latest.get(und) || null); return watchPrice(und, setV); }, [und]);
  return v;
}
