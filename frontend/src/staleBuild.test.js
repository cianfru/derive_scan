import { describe, expect, it, vi } from "vitest";
import { isChunkError, reloadOnce } from "./lib/staleBuild.js";

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

describe("a page from an older build", () => {
  it("recognises failed chunk loads in each browser's wording", () => {
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: https://cowboy.trading/assets/Saloon-old.js"))).toBe(true);
    expect(isChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
  it("reloads once, then not again within a minute", () => {
    const s = store(), reload = vi.fn();
    expect(reloadOnce(1_000_000, s, reload)).toBe(true);
    expect(reloadOnce(1_030_000, s, reload)).toBe(false);
    expect(reloadOnce(1_070_000, s, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it("still reloads when storage is blocked", () => {
    const reload = vi.fn();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(reloadOnce(9_000_000, blocked, reload)).toBe(true);
    expect(reloadOnce(9_000_500, blocked, reload)).toBe(false); // no loop: remembered in memory
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
