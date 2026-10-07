import { expect, it, vi } from "vitest";
import { diagnosticSnapshot, recordProductEvent, screenName } from "./diagnostics.js";

it("reduces private or specific routes to fixed categories", () => {
  expect(screenName("/trader/0x123456789?budget=250")).toBe("trader");
  expect(screenName("/q/BTC-20261009-A-80000-90000")).toBe("q");
  expect(screenName("/saloon/mine")).toBe("my_space");
  expect(screenName("/private-data")).toBe("other");
});

it("keeps only known event codes and deduplicates bursts", () => {
  vi.useFakeTimers();
  const before = diagnosticSnapshot().length;
  recordProductEvent("some raw error with a wallet address");
  expect(diagnosticSnapshot()).toHaveLength(before);
  recordProductEvent("view_failed");
  recordProductEvent("view_failed");
  expect(diagnosticSnapshot()).toHaveLength(before + 1);
  expect(Object.keys(diagnosticSnapshot().at(-1)).sort()).toEqual(["at", "kind", "screen"]);
  vi.useRealTimers();
});
