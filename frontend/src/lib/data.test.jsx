import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DATA_TIMEOUT_MS, load, useData } from "./data.js";
import { publicationState } from "./publication.js";
import { recordProductEvent } from "./diagnostics.js";
vi.mock("./diagnostics.js", () => ({ recordProductEvent: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });
const response = (data) => ({ ok: true, json: async () => data });

it("deduplicates overlapping reads and keeps force retry outside the cache TTL", async () => {
  let release;
  const fetch = vi.fn(() => new Promise((resolve) => { release = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const first = load("loader-dedupe.json"), second = load("loader-dedupe.json");
  expect(fetch).toHaveBeenCalledTimes(1);
  release(response({ value: 1 }));
  expect(await first).toEqual({ value: 1 }); expect(await second).toEqual({ value: 1 });
  fetch.mockResolvedValueOnce(response({ value: 2 }));
  expect(await load("loader-dedupe.json")).toEqual({ value: 1 });
  expect(await load("loader-dedupe.json", { force: true })).toEqual({ value: 2 });
});

it("bounds a stalled request even when fetch ignores abort", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const result = load("loader-stalled.json").catch((error) => error);
  await vi.advanceTimersByTimeAsync(DATA_TIMEOUT_MS);
  expect(await result).toMatchObject({ code: "timeout" });
});

it("retries a transient response once, but never mistakes404 for a transient failure", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce(response({ value: 3 }));
  vi.stubGlobal("fetch", fetch);
  const result = load("loader-retry503.json"); await vi.advanceTimersByTimeAsync(250);
  expect(await result).toEqual({ value: 3 }); expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValueOnce({ ok: false, status: 404 });
  await expect(load("loader-missing.json")).rejects.toMatchObject({ code: "http", status: 404 });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("exposes explicit retry and retains last good data on an offline refresh", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ value: 1 })).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response({ value: 2 }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useData("loader-hook.json"));
  await waitFor(() => expect(result.current.data?.value).toBe(1));
  await act(async () => { await result.current.retry(); });
  expect(result.current.data.value).toBe(1); expect(result.current.error.code).toBe("network");
  await act(async () => { await result.current.retry(); });
  expect(result.current.data.value).toBe(2); expect(result.current.error).toBeNull();
  expect(recordProductEvent.mock.calls).toEqual([["data_unavailable"], ["data_recovered"]]);
});

it("treats an expected missing entry separately from data outages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  const { result } = renderHook(() => useData("loader-expected404.json"));
  await waitFor(() => expect(result.current.missing).toBe(true));
  expect(recordProductEvent).not.toHaveBeenCalled();
});

it("evicts an explicit404 so remounting cannot resurrect a deleted file", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ value: 1 })).mockResolvedValue({ ok: false, status: 404 }));
  await load("loader-evict.json");
  await expect(load("loader-evict.json", { force: true })).rejects.toMatchObject({ status: 404 });
  await expect(load("loader-evict.json")).rejects.toMatchObject({ status: 404 });
});

it("rejects unusable roots and reports revision mismatch without retiming observations", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("unexpected")));
  await expect(load("loader-shape.json")).rejects.toMatchObject({ code: "invalid_data" });
  expect(publicationState([{ publication_revision: "a", generated_at: 1 }, { publication_revision: "b", generated_at: 2 }]).mismatch).toBe(true);
  expect(publicationState([{ generated_at: 1 }, { generated_at: 2 }]).mismatch).toBe(false);
});
