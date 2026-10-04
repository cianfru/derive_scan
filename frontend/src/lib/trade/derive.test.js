import { describe, it, expect, vi } from "vitest";
import frames from "../../fixtures/trade/public_frames.json";
import debugFixture from "../../fixtures/trade/execute_quote_debug.json";
import { CANCEL_PLAIN, DeriveError, checkIncidents, createClient, incidentState, instrumentCache, plainError } from "./derive.js";
import { fakeDerive, deriveError } from "./fakeSocket.js";
import { BANNED } from "../questions.js";
import { buildExecute, debugMatches, domainSeparator, keyFromSecret } from "./sign.js";
import { keccak256, toUtf8Bytes } from "ethers";

const client = (fake, opts = {}) => createClient({ url: "wss://fake", WebSocketImpl: fake.WebSocketImpl, sleep: async () => {}, ...opts });

describe("the Derive connection", () => {
  it("replays recorded public frames from V3 testnet", async () => {
    const fake = fakeDerive({ recorded: frames.frames });
    const c = client(fake);
    expect(await c.call("public/get_time")).toBe(frames.frames[0].frame.result);
    const ins = await c.call("public/get_instrument", { instrument_name: "BTC-20261009-82000-C" });
    expect(ins.base_asset_address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ins.minimum_amount).toBe("0.01");
    await expect(c.call("public/get_instrument", { instrument_name: "BTC-20261009-83000-C" })).rejects.toMatchObject({ code: 12001 });
    expect(fake.log.map((m) => m.jsonrpc)).toEqual(["2.0", "2.0", "2.0"]);
  });

  it("retries Derive's retryable errors with a growing pause, but not unsafe calls", async () => {
    let n = 0;
    const fake = fakeDerive({ handlers: { "public/get_time": () => (++n < 3 ? deriveError(9002) : 42), "private/x": () => deriveError(-32000) } });
    const pauses = [];
    const c = client(fake, { sleep: async (ms) => pauses.push(ms) });
    expect(await c.call("public/get_time")).toBe(42);
    expect(pauses).toEqual([400, 800]);
    await expect(c.call("private/x", {}, { safe: false })).rejects.toMatchObject({ code: -32000 });
    expect(fake.calls("private/x")).toHaveLength(1);
    await expect(c.call("private/x")).rejects.toBeInstanceOf(DeriveError);
    expect(fake.calls("private/x")).toHaveLength(5); // 1 + the first try and 3 retries
  });

  it("reconnects after a drop and logs in again", async () => {
    const fake = fakeDerive({ handlers: { "public/login": [7], "public/get_time": 1 } });
    const sign = vi.fn(async (ts) => `sig-${ts.length}`);
    const c = client(fake);
    expect(await c.login("0xabc", sign)).toEqual([7]);
    fake.sockets[0].drop();
    expect(await c.call("public/get_time")).toBe(1);
    expect(fake.sockets).toHaveLength(2);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(fake.calls("public/login").map((m) => m.params.wallet)).toEqual(["0xabc", "0xabc"]);
  });

  it("maps every code to a plain message, with no forecast words", () => {
    for (const [code, re] of [[11104, /no longer open/], [11110, /better price/], [11112, /fewer legs/], [9002, /isn't taking orders/], [-32000, /busy/], [4001, /declined/]]) {
      expect(plainError(new DeriveError(code))).toMatch(re);
    }
    expect(plainError("compliance")).toBe("Derive did not accept this trade.");
    expect(plainError({ code: 99999 })).toMatch(/didn't accept/);
    for (const m of [...Object.values(CANCEL_PLAIN), plainError({ code: 11104 }), plainError({ code: 11110 })]) expect(m).not.toMatch(BANNED);
  });

  it("reads incidents: none is ok, medium or high is down", async () => {
    expect(await checkIncidents(client(fakeDerive({ recorded: frames.frames })))).toBe("ok");
    expect(incidentState({ incidents: [{ severity: "low" }] })).toBe("notice");
    expect(incidentState({ incidents: [{ severity: "high" }] })).toBe("down");
    expect(await checkIncidents(client(fakeDerive({ handlers: { "public/get_live_incidents": deriveError(9002) } }), { retries: 0 }))).toBe("down");
  });

  it("caches instrument facts per page", async () => {
    const fake = fakeDerive({ recorded: frames.frames });
    const get = instrumentCache(client(fake));
    await get("BTC-20261009-82000-C");
    await get("BTC-20261009-82000-C");
    expect(fake.calls("public/get_instrument")).toHaveLength(1);
  });
});

describe("signing, checked against Derive's own encoding", () => {
  it("matches the testnet domain separator in Derive's docs", () => {
    expect(domainSeparator(11155111)).toBe("0x24d674cd5f2b9d564691c51e9d88f649b99246a2244dd74ce27b96578d773e85");
  });
  it("encodes an execution byte for byte as V3 testnet's execute_quote_debug did", () => {
    const key = keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));
    expect(key.address).toBe(debugFixture.args.signer);
    const b = buildExecute({ ...debugFixture.args, key });
    expect(b.payload).toEqual(debugFixture.request);
    const m = debugMatches(b.local, debugFixture.response.result);
    expect(m).toEqual({ ok: true, mismatched: [], compared: ["encoded_data", "encoded_data_hashed", "action_hash", "typed_data_hash"] });
  });
  it("reports a mismatch", () => {
    const key = keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));
    const b = buildExecute({ ...debugFixture.args, key, maxFee: "2.44" });
    expect(debugMatches(b.local, debugFixture.response.result).ok).toBe(false);
  });
});
