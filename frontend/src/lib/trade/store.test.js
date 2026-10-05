import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KEYS, read, write, _resetTradeStorage } from "./store.js";
import { loadPositions, savePositions, persistent, _resetMemory } from "../positions.js";

beforeEach(() => { localStorage.clear(); _resetTradeStorage(); _resetMemory(); });
afterEach(() => vi.restoreAllMocks());
it("reads the latest value after a quota failure despite a successful probe", () => {
  const key = KEYS.account("0x1");
  write(key, { id: 1 });
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
    if (k === key) throw new DOMException("Quota", "QuotaExceededError");
    return set.call(this, k, v);
  });
  write(key, { id: 2 });
  expect(read(key)).toEqual({ id: 2 });
  vi.restoreAllMocks();
  write(key, { id: 3 });
  expect(read(key)).toEqual({ id: 3 });
});
it("keeps the approved key across a reload (owner, 5 October 2026: the connection survives a reload)", () => {
  const key = KEYS.key("0x1");
  write(key, { secret: "current" });
  _resetTradeStorage();
  expect(read(key)).toEqual({ secret: "current" });
});
it("retains positions after a failed large write on each network", () => {
  const row = { id: "answer", side: "yes", contracts: 1 };
  savePositions([row]);
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
    if (k === "cowboy-questions") throw new DOMException("Quota", "QuotaExceededError");
    return set.call(this, k, v);
  });
  expect(savePositions([{ ...row, contracts: 2 }])).toBe(false);
  expect(savePositions([row], "testnet")).toBe(true);
  expect(loadPositions()[0].contracts).toBe(2);
  expect(persistent()).toBe(false);
  vi.restoreAllMocks();
  expect(savePositions([{ ...row, contracts: 3 }])).toBe(true);
  expect(loadPositions()[0].contracts).toBe(3);
  expect(persistent()).toBe(true);
});
