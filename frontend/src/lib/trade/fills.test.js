import { describe, expect, it, vi } from "vitest";
import { tradesSince } from "./fills.js";

describe("complete trade history", () => {
  it("reads beyond five pages and deduplicates overlapping trades", async () => {
    const call = vi.fn(async (_method, p) => ({
      trades: [{ trade_id: String(p.page), timestamp: 1000 }, { trade_id: "overlap", timestamp: 900 }],
      pagination: { num_pages: 7 },
    }));
    const rows = await tradesSince({ call }, 42);
    expect(call).toHaveBeenCalledTimes(7);
    expect(rows).toHaveLength(8);
    expect(call.mock.calls[0][1].from_timestamp).toBe(0);
    expect(call.mock.calls[1][1].to_timestamp).toBe(1000);
  });
  it("fails rather than returning a truncated result", async () => {
    const call = vi.fn(async () => ({ trades: [{ trade_id: "one", timestamp: 1000 }], pagination: { num_pages: 3 } }));
    await expect(tradesSince({ call }, 42, { maxPages: 2 })).rejects.toThrow(/incomplete/);
  });
  it("fails on missing history or an empty page before completion", async () => {
    await expect(tradesSince({ call: async () => ({}) }, 42)).rejects.toThrow(/no trade history/);
    await expect(tradesSince({ call: async () => ({ trades: [], pagination: { num_pages: 2 } }) }, 42)).rejects.toThrow(/incomplete/);
  });
});
