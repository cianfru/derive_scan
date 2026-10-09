import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

async function withLive(url) {
  vi.stubEnv("VITE_LIVE_URL", url);
  vi.resetModules();
  return import("./data.js");
}

describe("live Saloon prices", () => {
  it("reads only the Saloon's files from the live service", async () => {
    const d = await withLive("https://live.test/");
    expect(d.isLivePath("questions/BTC.json")).toBe(true);
    expect(d.isLivePath("questions/index.json")).toBe(true);
    expect(d.isLivePath("questions/history/BTC-20261030.json")).toBe(false);
    expect(d.isLivePath("markets.json")).toBe(false);
  });

  it("falls back to the published file when the live service fails", async () => {
    const d = await withLive("https://live.test/");
    const fetch = vi.fn(async (url) => (String(url).startsWith("https://live.test/")
      ? { ok: false, status: 502, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ und: "BTC", from: "published" }) }));
    vi.stubGlobal("fetch", fetch);
    const doc = await d.load("questions/BTC.json", { force: true });
    expect(doc.from).toBe("published");
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://live.test/questions/BTC.json", `${d.DATA_URL}questions/BTC.json`]);
  });

  it("uses the live copy when it answers, and the published data when no live service is set", async () => {
    let d = await withLive("https://live.test/");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ from: "live" }) })));
    expect((await d.load("questions/ETH.json", { force: true })).from).toBe("live");
    d = await withLive("");
    expect(d.isLivePath("questions/ETH.json")).toBe(false);
  });
});
