import { describe, it, expect } from "vitest";
import { parseSpot } from "./livePrice.js";

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
