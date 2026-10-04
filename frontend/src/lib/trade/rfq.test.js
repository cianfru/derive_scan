import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import shapes from "../../fixtures/trade/private_shapes.json";
import frames from "../../fixtures/trade/public_frames.json";
import debugFixture from "../../fixtures/trade/execute_quote_debug.json";
import { createClient, instrumentCache } from "./derive.js";
import { fakeDerive, deriveError } from "./fakeSocket.js";
import { createDryRun, createTicket, executeExpiry } from "./rfq.js";
import { keyFromSecret } from "./sign.js";

const key = keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));
const LEGS = shapes["private/send_rfq"].legs;
const best = shapes["private/rfq_get_best_quote"];

function run({ quotes, handlers = {}, limit = 103.95, ...over } = {}) {
  let i = 0;
  const fake = fakeDerive({
    recorded: frames.frames,
    handlers: {
      "private/send_rfq": shapes["private/send_rfq"],
      "private/rfq_get_best_quote": () => (typeof quotes === "function" ? quotes(i++) : quotes),
      "private/cancel_rfq": "ok",
      "public/execute_quote_debug": deriveError(-32601, "not in this test"),
      ...handlers,
    },
  });
  const client = createClient({ url: "wss://fake", WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} });
  const states = [];
  const dry = createDryRun({
    client, getInstrument: instrumentCache(client), subaccountId: 90212, owner: "0x4201C60C3c85e641c9837588429F59CA57e22bE2", key,
    legs: LEGS, direction: "buy", limit, payout: 197.94, feeEstimate: 1.34, label: "BTC-20261009-A-82000-88000:yes",
    onChange: (s) => states.push(s.phase), ...over,
  });
  return { fake, dry, states };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1791089400000); });
afterEach(() => vi.useRealTimers());

describe("the dry run", () => {
  it("asks once, shows the firm quote and its figures", async () => {
    const { fake, dry } = run({ quotes: best });
    await dry.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(dry.state.phase).toBe("quoted");
    expect(dry.state.check).toMatchObject({ ok: true, total: 96.9906, fee: 1.3395 });
    expect(dry.state.check.mostLose).toBeCloseTo(98.3301, 4);
    expect(dry.state.firmUntil).toBe(1791089400000 + 12_000);
    const sent = fake.calls("private/send_rfq")[0].params;
    expect(sent).toMatchObject({ subaccount_id: 90212, max_total_cost: "103.95", partial_fill_step: "1", extra_fee: "0", label: "BTC-20261009-A-82000-88000:yes" });
    expect(sent.min_total_cost).toBeUndefined();
    expect(fake.calls("public/get_live_incidents")).toHaveLength(1);
  });

  it("gives up after 10 s without a quote and cancels the RFQ", async () => {
    const { fake, dry } = run({ quotes: { ...best, best_quote: null } });
    await dry.start();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(dry.state.phase).toBe("asking");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dry.state).toMatchObject({ phase: "no_quote", message: "No price from Derive right now.", detail: null });
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
  });

  it("does not offer a quote beyond the ceiling", async () => {
    const { fake, dry } = run({ quotes: { ...best, estimated_total_cost: "113.70" } });
    await dry.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(dry.state.phase).toBe("beyond");
    expect(Math.round(dry.state.check.perDollar * 100)).toBe(57);
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
  });

  it("lets a quote lapse after 12 s and asks for a new price", async () => {
    const { fake, dry } = run({ quotes: best });
    await dry.start();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(dry.state.phase).toBe("quoted");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dry.state.phase).toBe("lapsed");
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
    await dry.confirm(96.9906);
    expect(fake.calls("public/execute_quote_debug")).toHaveLength(0);
  });

  it("never signs a number the user did not see", async () => {
    const q2 = { ...best, estimated_total_cost: "97.50", best_quote: { ...best.best_quote, quote_id: "11111111-2222-4333-8444-555555555555" } };
    const { fake, dry } = run({ quotes: (i) => (i === 0 ? best : q2) });
    await dry.start();
    await vi.advanceTimersByTimeAsync(10);
    const seen = dry.state.check.total;
    await vi.advanceTimersByTimeAsync(1_600);
    expect(dry.state.check.total).toBe(97.5);
    expect(dry.state.changed).toBe(true);
    await dry.confirm(seen);
    expect(fake.calls("public/execute_quote_debug")).toHaveLength(0);
    expect(dry.state.phase).toBe("quoted");
  });

  it("signs on the tap, checks it with execute_quote_debug byte for byte, fills nothing and cancels", async () => {
    const a = debugFixture.args;
    const fixtureBest = { ...best, suggested_max_fee: a.maxFee, estimated_total_cost: "99.65", best_quote: { ...best.best_quote, ...a.quote } };
    // valid_until such that the signature expiry is the recorded one (60 s past the RFQ's end, rounded up)
    const rfq = { ...shapes["private/send_rfq"], rfq_id: a.quote.rfq_id, valid_until: (a.expirySec - 120) * 1000 };
    const { fake, dry } = run({
      quotes: fixtureBest, limit: 120, subaccountId: a.subaccountId, owner: a.owner, legs: a.quote.legs.map(({ price, ...l }) => l),
      makeNonce: () => a.nonce,
      handlers: { "private/send_rfq": rfq, "public/execute_quote_debug": () => debugFixture.response.result },
    });
    await dry.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(dry.state.phase).toBe("quoted");
    await dry.confirm(dry.state.check.total);
    expect(dry.state.phase).toBe("checked");
    expect(dry.state.debug).toMatchObject({ ok: true, mismatched: [] });
    expect(fake.calls("public/execute_quote_debug")[0].params).toEqual(debugFixture.request);
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
    expect(fake.log.some((m) => m.method === "private/execute_quote")).toBe(false);
  });

  it("always cancels the RFQ when the ticket closes", async () => {
    const { fake, dry } = run({ quotes: best });
    await dry.start();
    await vi.advanceTimersByTimeAsync(10);
    await dry.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
    expect(fake.calls("private/rfq_get_best_quote")).toHaveLength(1);
  });

  it("sells back with a floor, not a ceiling", async () => {
    const { fake, dry } = run({ quotes: { ...best, direction: "sell", estimated_total_cost: "92.6" }, direction: "sell", limit: 88.6 });
    await dry.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(fake.calls("private/send_rfq")[0].params).toMatchObject({ min_total_cost: "88.6" });
    expect(fake.calls("private/rfq_get_best_quote")[0].params.direction).toBe("sell");
    expect(dry.state.check.net).toBeCloseTo(92.6 - 1.3395, 6);
  });

  it("stays off when Derive reports an incident", async () => {
    const { fake, dry } = run({ quotes: best, handlers: { "public/get_live_incidents": { incidents: [{ severity: "high", label: "x", message: "x" }] } } });
    await dry.start();
    expect(dry.state.phase).toBe("down");
    expect(fake.calls("private/send_rfq")).toHaveLength(0);
  });

  it("says the testnet does not list the level when a leg answers 12001, naming it, and asks nothing", async () => {
    const { fake, dry } = run({ quotes: best, legs: [{ instrument_name: "BTC-20261009-83000-C", direction: "buy", amount: "0.01" }, LEGS[1]] });
    await dry.start();
    expect(dry.state).toMatchObject({ phase: "not_listed", message: "Derive's testnet doesn't list this level. Pick another level.", missing: ["BTC-20261009-83000-C"] });
    expect(dry.state.detail).toMatchObject({ step: "price", source: "Derive", code: 12001 });
    expect(dry.state.detail.message).toContain("BTC-20261009-83000-C");
    expect(dry.state.detail.message).not.toContain(LEGS[1].instrument_name);
    expect(fake.calls("private/send_rfq")).toHaveLength(0);
  });

  it("keeps no price for other instrument errors", async () => {
    const { fake, dry } = run({ quotes: best, handlers: { "public/get_instrument": deriveError(9002, "backend unavailable") } });
    await dry.start();
    expect(dry.state).toMatchObject({ phase: "no_quote", message: "No price from Derive right now." });
    expect(fake.calls("private/send_rfq")).toHaveLength(0);
  });

  it("explains a quote that never came in a testnet build", async () => {
    const fake = fakeDerive({ recorded: frames.frames, handlers: { "private/send_rfq": shapes["private/send_rfq"], "private/rfq_get_best_quote": { ...best, best_quote: null }, "private/cancel_rfq": "ok" } });
    const client = createClient({ url: "wss://fake", WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} });
    const dry = createTicket({
      client, getInstrument: instrumentCache(client), subaccountId: 90212, owner: "0x4201C60C3c85e641c9837588429F59CA57e22bE2", key,
      legs: LEGS, direction: "buy", limit: 103.95, payout: 197.94, feeEstimate: 1.34, label: "x", mode: "testnet",
    });
    await dry.start();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(dry.state).toMatchObject({ phase: "no_quote", message: "No price from Derive right now.",
      detail: { step: "price", source: "Derive", message: "no market maker quoted within 10 s" } });
  });
});

it("signs executions to stay valid past the RFQ's own end, within a day", () => {
  const now = 1791089400;
  expect(executeExpiry(now, 1791091200000)).toBe(1791091320); // ms from Derive
  expect(executeExpiry(now, 1791091200)).toBe(1791091320); // or seconds
  expect(executeExpiry(now, null)).toBe(now + 1900);
  expect(executeExpiry(now, (now + 200_000) * 1000)).toBe(now + 86_000);
});
