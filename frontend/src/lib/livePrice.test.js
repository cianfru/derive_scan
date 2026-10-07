import { afterEach, describe, it, expect, vi } from "vitest";
import { indexPriceState, parseSpot, watchPrice } from "./livePrice.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("parseSpot", () => {
  it("reads a spot_feed notification", () => {
    const msg = { method: "subscription", params: { channel: "spot_feed.BTC", data: { timestamp: 1791380000000, feeds: { BTC: { price: "82886.24", price_prev_daily: "85729.63" } } } } };
    expect(parseSpot(msg)).toEqual([["BTC", { price: 82886.24, prev: 85729.63, ts: 1791380000 }]]);
  });
  it("ignores other messages and bad prices", () => {
    expect(parseSpot({ id: 1, result: ["spot_feed.BTC"] })).toEqual([]);
    expect(parseSpot({ method: "subscription", params: { channel: "ticker.BTC", data: { feeds: { BTC: { price: "1" } } } } })).toEqual([]);
    expect(parseSpot({ method: "subscription", params: { channel: "spot_feed.ETH", data: { timestamp: 1, feeds: { ETH: { price: "0" } } } } })).toEqual([]);
  });
});

describe("index source and freshness", () => {
  const now = 1791380000;
  const tick = { price: 90000, prev: 88000, ts: now, connected: true };
  it("separates a fresh live tick from a timestamped published fallback", () => {
    expect(indexPriceState(tick, 85000, now - 900, now)).toMatchObject({ price: 90000, source: "live", fresh: true });
    expect(indexPriceState(null, 85000, now - 900, now)).toMatchObject({ price: 85000, source: "published", fresh: false });
  });
  it("qualifies silence and disconnection and prefers a newer published observation", () => {
    expect(indexPriceState(tick, 85000, now - 900, now + 31)).toMatchObject({ price: 90000, state: "stale", fresh: false });
    expect(indexPriceState({ ...tick, connected: false }, 85000, now - 900, now + 10)).toMatchObject({ state: "disconnected", fresh: false });
    expect(indexPriceState({ ...tick, connected: false }, 85000, now + 20, now + 31)).toMatchObject({ price: 85000, source: "published", fresh: false });
  });
  it("does not call an invalid or future timestamp live", () => {
    expect(indexPriceState({ ...tick, ts: NaN }, null, null, now).source).toBe("unavailable");
    expect(indexPriceState({ ...tick, ts: now + 60 }, 85000, now, now).source).toBe("published");
    expect(parseSpot({ method: "subscription", params: { channel: "spot_feed.BTC", data: { feeds: { BTC: { price: "90000" } } } } })).toEqual([]);
  });
  it("notifies subscribers immediately on disconnect and ignores older ticks", () => {
    vi.useFakeTimers(); vi.setSystemTime(now * 1000); vi.stubEnv("MODE", "development");
    const sockets = [];
    class Socket {
      readyState = 0;
      constructor() { sockets.push(this); }
      send() {}
      close() { this.readyState = 3; this.onclose?.(); }
    }
    vi.stubGlobal("WebSocket", Socket);
    const seen = vi.fn();
    const stop = watchPrice("AUDIT", seen);
    try {
      const socket = sockets[0]; socket.readyState = 1; socket.onopen();
      const send = (price, ts) => socket.onmessage({ data: JSON.stringify({ method: "subscription", params: { channel: "spot_feed.AUDIT", data: { timestamp: ts * 1000, feeds: { AUDIT: { price, price_prev_daily: 88000 } } } } }) });
      send(90000, now); send(80000, now - 1);
      expect(seen.mock.lastCall[0]).toMatchObject({ price: 90000, connected: true });
      socket.close();
      expect(seen.mock.lastCall[0]).toMatchObject({ price: 90000, ts: now, connected: false });
    } finally { stop(); }
  });
});
