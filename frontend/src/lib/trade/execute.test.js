// Saloon stage 2, P6: testnet fills. Every Derive answer here is a frame: recorded from V3 testnet's
// public methods (instrument facts, a real RFQ execution's trade rows) or built from Derive's openapi
// shapes (private calls). Nothing touches a network.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import shapes from "../../fixtures/trade/private_shapes.json";
import frames from "../../fixtures/trade/public_frames.json";
import rec from "../../fixtures/trade/testnet_rfq_trades.json";
import { EXECUTE, MAINNET_GUARD, createClient, instrumentCache } from "./derive.js";
import { fakeDerive, deriveError } from "./fakeSocket.js";
import { NETWORK, NETWORKS, TESTNET_WS, fillsAllowed } from "./config.js";
import { createTicket } from "./rfq.js";
import { keyFromSecret } from "./sign.js";
import { addSpent, capGate, capMessage, spentToday, tradingAllows, tradingState } from "./limits.js";
import { fillFromExecute, fillFromTrades } from "./fills.js";
import { BANNED } from "../questions.js";

const key = keyFromSecret(keccak256(toUtf8Bytes("cowboy test session key")));
const OWNER = "0x4201C60C3c85e641c9837588429F59CA57e22bE2";
const SUB = 86514;
const RFQ = rec.rfq_id;
const TAKER_QUOTE = rec.taker[0].quote_id; // the taker's own quote id, the one its trades carry
const LEGS = [
  { instrument_name: "BTC-20261005-90000-C", direction: "buy", amount: "0.01" },
  { instrument_name: "BTC-20261005-92000-C", direction: "sell", amount: "0.01" },
];
const ASSET = frames.frames.find((f) => f.method === "public/get_instrument" && f.frame.result).frame.result.base_asset_address;
const instrument = ({ instrument_name }) => ({ instrument_name, base_asset_address: ASSET, base_asset_sub_id: String(90000 + Number(instrument_name.split("-")[2])) });

/** A maker quote against the RFQ, as rfq_get_best_quote returns it (shape from Derive's openapi). */
function bestQuote({ direction = "buy", total = "0.95", fee = "0.65125", quoteId = "7e6d5c4b-3a29-4817-9605-f4e3d2c1b0a9" } = {}) {
  const b = shapes["private/rfq_get_best_quote"];
  return {
    ...b, direction, estimated_total_cost: total, estimated_fee: fee, suggested_max_fee: "1.2", orderbook_total_cost: total,
    best_quote: { ...b.best_quote, quote_id: quoteId, rfq_id: RFQ, subaccount_id: 70001, direction: direction === "buy" ? "sell" : "buy",
      legs: [{ ...LEGS[0], price: "121" }, { ...LEGS[1], price: "26" }] },
  };
}
/** execute_quote's answer (QuoteExecuteResponse in Derive's openapi), for the taker. */
function executed({ pct = "1", status = "filled", cancel = "" } = {}) {
  return {
    cancel_reason: cancel, creation_timestamp: 1790949750400, direction: "buy", extra_fee: "0", fee: "0.65125", fill_pct: pct,
    is_transfer: false, label: "BTC-20261005-A-90000-92000:yes", last_update_timestamp: 1790949750491,
    legs: [{ ...LEGS[0], price: "121" }, { ...LEGS[1], price: "26" }], legs_hash: "0x11", liquidity_role: "taker", max_fee: "1.2",
    mmp: false, nonce: "1", quote_id: TAKER_QUOTE, rfq_filled_pct: pct, rfq_id: RFQ, signature_expiry_sec: 1790951000, status, subaccount_id: SUB,
  };
}
const history = (rows) => ({ subaccount_id: SUB, trades: rows.map((t) => ({ ...t, label: "BTC-20261005-A-90000-92000:yes" })), pagination: { count: rows.length, num_pages: 1 } });

function setup({ handlers = {}, url = TESTNET_WS, ...over } = {}) {
  const fake = fakeDerive({
    recorded: frames.frames,
    handlers: {
      "public/get_instrument": instrument,
      "private/send_rfq": { ...shapes["private/send_rfq"], rfq_id: RFQ, valid_until: 1790951400000 },
      "private/rfq_get_best_quote": (p) => (p.rfq_id ? bestQuote({ direction: p.direction }) : { ...bestQuote({ direction: p.direction }), best_quote: null }),
      "private/cancel_rfq": "ok",
      [EXECUTE]: executed(),
      "private/get_trade_history": history([...rec.taker, ...rec.maker]),
      ...handlers,
    },
  });
  const client = createClient({ url, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {}, timeoutMs: 10_000 });
  const fills = [];
  const t = createTicket({
    client, getInstrument: instrumentCache(client), subaccountId: SUB, owner: OWNER, key, legs: LEGS, direction: "buy",
    limit: 3, payout: 20, feeEstimate: 0.6, label: "BTC-20261005-A-90000-92000:yes", mode: "testnet", network: NETWORK,
    onFill: (f) => fills.push(f), sleep: async () => {}, ...over,
  });
  return { fake, t, fills, client };
}

async function quoted(t) {
  await t.start();
  await vi.advanceTimersByTimeAsync(10);
  expect(t.state.phase).toBe("quoted");
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1790949740000); localStorage.clear(); });
afterEach(() => vi.useRealTimers());

describe("testnet fills", () => {
  it("does not dispatch a queued execution after the ticket closes", async () => {
    const { fake, t } = setup();
    await quoted(t);
    const confirming = t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(fake.calls(EXECUTE)).toHaveLength(0);
    const closing = t.close();
    await vi.advanceTimersByTimeAsync(5);
    await Promise.all([confirming, closing]);
    expect(fake.calls(EXECUTE)).toHaveLength(0);
  });

  it("cannot execute a closed ticket while its cancellation is still pending", async () => {
    let release;
    const { fake, t, fills } = setup({ handlers: {
      "private/cancel_rfq": () => new Promise((resolve) => { release = resolve; }),
    } });
    await quoted(t);
    const total = t.state.check.total;
    const closing = t.close();
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
    await t.confirm(total);
    await t.start();
    expect(fake.calls(EXECUTE)).toHaveLength(0);
    expect(fake.calls("private/send_rfq")).toHaveLength(1);
    expect(fills).toHaveLength(0);
    release("ok");
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(t.state.phase).toBe("closed");
  });

  it("still records an already-dispatched execution after the ticket closes", async () => {
    let release;
    const { fake, t, fills } = setup({ handlers: {
      [EXECUTE]: () => new Promise((resolve) => { release = resolve; }),
    } });
    await quoted(t);
    const confirming = t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.calls(EXECUTE)).toHaveLength(1);
    await t.close();
    release(executed());
    await vi.advanceTimersByTimeAsync(1);
    await confirming;
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ rfq_id: RFQ, complete: true });
    expect(fake.calls(EXECUTE)).toHaveLength(1);
  });

  it("fills on the tap and records the fill from Derive's trade history, exactly", async () => {
    const { fake, t, fills } = setup();
    await quoted(t);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(t.state.phase).toBe("filled");
    const sent = fake.calls(EXECUTE);
    expect(sent).toHaveLength(1);
    expect(sent[0].params).toMatchObject({ subaccount_id: SUB, rfq_id: RFQ, direction: "buy", enable_taker_protection: true, label: "BTC-20261005-A-90000-92000:yes", signer: key.address });
    expect(sent[0].params.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(sent[0].params.referral_code).toBeUndefined(); // empty unless VITE_DERIVE_REFERRAL is set
    expect(fake.calls("public/execute_quote_debug")).toHaveLength(0);
    expect(fake.calls("private/get_trade_history")[0].params).toEqual({ subaccount_id: SUB, quote_id: TAKER_QUOTE });
    const f = t.state.fill;
    expect(f).toMatchObject({ source: "trade_history", rfq_id: RFQ, ts: 1790949750.491, premium: 0.95, fees: 0.65125, partial: false, pct: 1 });
    expect(f.legs).toEqual([
      { name: "BTC-20261005-90000-C", act: "buy", planned: 0.01, qty: 0.01, signed_qty: 0.01, price: 121, fee: 0.65125, trade_ids: ["5980561c-3e33-4b4a-8a95-e9f27ffdc313"] },
      { name: "BTC-20261005-92000-C", act: "sell", planned: 0.01, qty: 0.01, signed_qty: -0.01, price: 26, fee: 0, trade_ids: ["6fdabd5d-0d0e-4992-b1ef-c8ea40ab6a26"] },
    ]);
    expect(fills).toHaveLength(1);
    // A full fill leaves nothing to cancel; the day's spend counts the fill with its fees.
    expect(fake.calls("private/cancel_rfq")).toHaveLength(0);
    expect(spentToday(OWNER)).toBeCloseTo(1.6, 2);
    // The referral code goes on the RFQ and the fill when one is set.
    const r = setup({ referral: "COWBOY" });
    await quoted(r.t);
    await r.t.confirm({ quoteId: r.t.state.quote.quote_id, total: r.t.state.check.total, maxFee: r.t.state.check.maxFee });
    expect(r.fake.calls("private/send_rfq")[0].params.referral_code).toBe("COWBOY");
    expect(r.fake.calls(EXECUTE)[0].params).toMatchObject({ referral_code: "COWBOY" });
    expect(r.fake.calls("private/send_rfq")[0].params).toMatchObject({ extra_fee: "0", partial_fill_step: "1" });
  });

  it("records a partial fill as filled, for what filled, and cancels the rest", async () => {
    const half = rec.taker.map((x) => ({ ...x, trade_amount: "0.005", trade_fee: x.trade_fee === "0" ? "0" : "0.5" }));
    const { fake, t } = setup({ handlers: { [EXECUTE]: executed({ pct: "0.5" }), "private/get_trade_history": history(half) } });
    await quoted(t);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(t.state.phase).toBe("filled");
    expect(t.state.fill).toMatchObject({ partial: true, pct: 0.5, premium: 0.475, fees: 0.5 });
    expect(t.state.fill.legs.map((l) => [l.qty, l.planned])).toEqual([[0.005, 0.01], [0.005, 0.01]]);
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
    expect(fake.calls(EXECUTE)).toHaveLength(1);
  });

  it("falls back to execute_quote's own answer when the trade history has not caught up", async () => {
    const { t } = setup({ handlers: { "private/get_trade_history": history([]) } });
    await quoted(t);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(t.state.fill).toMatchObject({ source: "execute_quote", premium: 0.95, fees: 0.65125, trade_ids: [], ts: 1790949750.491 });
  });

  it("says plainly when the quote has expired, was rejected, or Derive is busy, and never re-sends", async () => {
    const cases = [
      [deriveError(11104, "Requested quote or RFQ is not open"), "expired", "That price is no longer open. Nothing was bought or sold."],
      [deriveError(11110, "Quote taker total cost too high"), "rejected", "Derive's screen has a better price. Get a new price."],
      [executed({ status: "cancelled", pct: "0", cancel: "insufficient_margin" }), "rejected", "Not enough USDC in your Saloon account."],
      [deriveError(-32000, "Rate limit exceeded"), "busy", "Derive is busy right now. Nothing was bought or sold. Try again in a moment."],
    ];
    for (const [answer, phase, message] of cases) {
      const { fake, t, fills } = setup({ handlers: { [EXECUTE]: answer } });
      await quoted(t);
      await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
      expect(t.state).toMatchObject({ phase, message });
      expect(message).not.toMatch(BANNED);
      expect(fake.calls(EXECUTE)).toHaveLength(1);
      expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
      expect(fills).toHaveLength(0);
      expect(spentToday(OWNER)).toBe(0);
    }
  });

  it("after a tap with no answer, re-reads the RFQ instead of sending again", async () => {
    let rfqs = { rfqs: [{ rfq_id: RFQ, status: "open", filled_pct: "0" }] };
    const { fake, t } = setup({ handlers: { [EXECUTE]: () => new Promise(() => {}), "private/get_rfqs": () => rfqs } });
    await quoted(t);
    const done = t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    await vi.advanceTimersByTimeAsync(10_001);
    await done;
    expect(t.state.phase).toBe("unknown");
    expect(t.state.message).not.toMatch(BANNED);
    expect(fake.calls(EXECUTE)).toHaveLength(1);
    expect(fake.calls("private/get_rfqs").length).toBeGreaterThan(1);
    rfqs = { rfqs: [{ rfq_id: RFQ, status: "filled", filled_pct: "1" }] };
    await t.recheck();
    expect(t.state.phase).toBe("filled");
    expect(t.state.fill.trade_ids).toHaveLength(2);
    expect(fake.calls(EXECUTE)).toHaveLength(1);
    // An RFQ that ended unfilled says so.
    const s2 = setup({ handlers: { [EXECUTE]: deriveError(9001, "Engine confirmation timeout"), "private/get_rfqs": { rfqs: [{ rfq_id: RFQ, status: "expired", filled_pct: "0" }] } } });
    await quoted(s2.t);
    await s2.t.confirm({ quoteId: s2.t.state.quote.quote_id, total: s2.t.state.check.total, maxFee: s2.t.state.check.maxFee });
    expect(s2.t.state).toMatchObject({ phase: "not_filled", message: "Derive did not fill it. Nothing was bought or sold." });
  });
});

describe("the mainnet guard", () => {
  const MAINNET = { name: "mainnet", enabled: true, wsUrl: "wss://api.derive.xyz/v3/ws", chainId: 1, chainName: "Ethereum" };

  it("allows fills only in a testnet build on the testnet", () => {
    expect(fillsAllowed(NETWORK, "testnet")).toBe(true);
    expect(fillsAllowed(NETWORK, "dryrun")).toBe(false);
    expect(fillsAllowed(NETWORK, "off")).toBe(false);
    expect(fillsAllowed(NETWORKS.mainnet, "testnet")).toBe(false);
    expect(fillsAllowed(MAINNET, "testnet")).toBe(false);
    expect(fillsAllowed({ ...NETWORK, chainId: 1 }, "testnet")).toBe(false);
    expect(fillsAllowed({ ...NETWORK, wsUrl: "wss://api.derive.xyz/v3/ws" }, "testnet")).toBe(false);
    expect(fillsAllowed(undefined, "testnet")).toBe(false);
    expect(NETWORKS.mainnet).toBeUndefined(); // a testnet build carries no mainnet network at all
  });

  it("never calls execute_quote with a mainnet configuration", async () => {
    // The ticket refuses before signing: a mainnet network in a testnet build.
    const a = setup({ network: MAINNET, chainId: 1 });
    await quoted(a.t);
    await a.t.confirm({ quoteId: a.t.state.quote.quote_id, total: a.t.state.check.total, maxFee: a.t.state.check.maxFee });
    expect(a.t.state).toMatchObject({ phase: "error", message: "One tap works on Derive's testnet only." });
    expect(a.fake.log.some((m) => m.method === EXECUTE)).toBe(false);
    expect(a.fills).toHaveLength(0);
    // The client refuses on any endpoint but the testnet's, whatever calls it: nothing reaches the wire.
    const b = setup({ url: "wss://api.derive.xyz/v3/ws" });
    await quoted(b.t);
    await b.t.confirm({ quoteId: b.t.state.quote.quote_id, total: b.t.state.check.total, maxFee: b.t.state.check.maxFee });
    expect(b.t.state.phase).toBe("rejected");
    expect(b.fake.log.some((m) => m.method === EXECUTE)).toBe(false);
    await expect(b.client.call(EXECUTE, { any: 1 }, { safe: false })).rejects.toMatchObject({ code: MAINNET_GUARD });
    expect(b.fake.log.some((m) => m.method === EXECUTE)).toBe(false);
    // A dry-run build never fills, even on the testnet.
    const c = setup({ mode: "dryrun", handlers: { "public/execute_quote_debug": {} } });
    await quoted(c.t);
    await c.t.confirm({ quoteId: c.t.state.quote.quote_id, total: c.t.state.check.total, maxFee: c.t.state.check.maxFee });
    expect(c.fake.log.some((m) => m.method === EXECUTE)).toBe(false);
  });
});

describe("the kill switch", () => {
  it("reads the published state: on by default, unknown values off, nothing until loaded", () => {
    expect(tradingState(null)).toBe("loading");
    expect(tradingState({})).toBe("on");
    expect(tradingState({ trading: "sell_only" })).toBe("sell_only");
    expect(tradingState({ trading: "off" })).toBe("off");
    expect(tradingState({ trading: "maybe" })).toBe("off");
    expect([["on", "buy"], ["on", "sell"], ["sell_only", "buy"], ["sell_only", "sell"], ["off", "buy"], ["off", "sell"], ["loading", "sell"]]
      .map(([s, d]) => tradingAllows(s, d))).toEqual([true, true, false, true, false, false, false]);
  });

  it("sell_only blocks buys and keeps sell backs; off blocks both, before any RFQ", async () => {
    const buy = setup({ trading: () => "sell_only" });
    await buy.t.start();
    expect(buy.t.state).toMatchObject({ phase: "paused", message: "Cowboy has paused new buys. Selling back still works." });
    expect(buy.fake.calls("private/send_rfq")).toHaveLength(0);
    const sell = setup({ trading: () => "sell_only", direction: "sell", limit: 0.5 });
    await quoted(sell.t);
    expect(sell.fake.calls("private/send_rfq")).toHaveLength(1);
    const off = setup({ trading: () => "off", direction: "sell", limit: 0.5 });
    await off.t.start();
    expect(off.t.state.phase).toBe("paused");
    expect(off.t.state.message).toMatch(/paused one-tap trading/);
    expect(off.fake.calls("private/send_rfq")).toHaveLength(0);
  });

  it("checks again at the tap: switched off while a quote was showing, nothing fills", async () => {
    let state = "on";
    const { fake, t } = setup({ trading: () => state });
    await quoted(t);
    state = "off";
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(t.state.phase).toBe("paused");
    expect(fake.calls(EXECUTE)).toHaveLength(0);
    expect(fake.calls("private/cancel_rfq")).toHaveLength(1);
  });
});

describe("the large-trade warnings", () => {
  it("warn over $250 most-you-can-lose per answer and past $1,000 a day, in plain words", () => {
    expect(capGate(250, OWNER)).toMatchObject({ ok: true, warn: null });
    expect(capGate(250.5, OWNER)).toMatchObject({ ok: true, warn: "per_answer", cap: 250 });
    expect(capMessage(capGate(260, OWNER))).toBe("Large trade: you can lose up to $260.00 on this answer. Check the amount before you tap.");
    addSpent(OWNER, 900);
    expect(capGate(150, OWNER)).toMatchObject({ ok: true, warn: "per_day" });
    expect(capMessage(capGate(150, OWNER))).toBe("With this trade you have put $1050.00 into answers today (UTC), over $1,000.");
    // A new UTC day starts again from zero.
    expect(spentToday(OWNER, Date.now() + 86_400_000)).toBe(0);
    for (const c of [capGate(260, OWNER), capGate(150, OWNER)]) expect(capMessage(c)).not.toMatch(BANNED);
  });

  it("never block: a large estimate still asks for a price, and a large firm price still fills", async () => {
    const a = setup({ estimate: 260 });
    await a.t.start();
    expect(a.t.state.phase).not.toBe("capped");
    expect(a.fake.calls("private/send_rfq")).toHaveLength(1);
    addSpent(OWNER, 999);
    const b = setup({ estimate: 0.5 });
    await quoted(b.t);
    await b.t.confirm({ quoteId: b.t.state.quote.quote_id, total: b.t.state.check.total, maxFee: b.t.state.check.maxFee });
    expect(b.t.state.phase).not.toBe("capped");
    expect(b.fake.calls(EXECUTE)).toHaveLength(1);
  });
});

describe("selling back", () => {
  const sold = rec.taker.map((x) => ({ ...x, direction: x.direction === "buy" ? "sell" : "buy", trade_id: `${x.trade_id.slice(0, -4)}5e11`, rfq_id: RFQ,
    trade_price: x.instrument_name.includes("90000") ? "150" : "30", trade_fee: x.instrument_name.includes("90000") ? "0.6" : "0", timestamp: 1790960000000 }));

  it("asks for the opposite package, floors it at Derive's mark without a board price, and records the sale", async () => {
    const { fake, t } = setup({
      direction: "sell", limit: null, payout: 20, tolerance: 0.02,
      handlers: {
        "private/rfq_get_best_quote": (p) => (p.rfq_id ? bestQuote({ direction: "sell", total: "1.2", fee: "0.6" }) : { ...bestQuote({ direction: "sell", total: "1.25" }), best_quote: null }),
        [EXECUTE]: { ...executed(), direction: "sell" },
        "private/get_trade_history": history(sold),
      },
    });
    await quoted(t);
    const mark = fake.calls("private/rfq_get_best_quote")[0].params;
    expect(mark.rfq_id).toBeUndefined();
    expect(mark.direction).toBe("sell");
    // floor = mark 1.25 - 2c x $20 payout = 0.85
    expect(fake.calls("private/send_rfq")[0].params).toMatchObject({ min_total_cost: "0.85", legs: LEGS });
    expect(t.state.check.net).toBeCloseTo(0, 6);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(fake.calls(EXECUTE)[0].params.direction).toBe("sell");
    expect(t.state.fill).toMatchObject({ direction: "sell", premium: -1.2, fees: 0.6 });
    expect(t.state.fill.legs.map((l) => [l.name, l.act])).toEqual([["BTC-20261005-90000-C", "sell"], ["BTC-20261005-92000-C", "buy"]]);
    // A sale does not count toward the day's buying.
    expect(spentToday(OWNER)).toBe(0);
  });
});

describe("reading fills", () => {
  it("keeps missing trade fees unknown instead of reporting an exact zero", () => {
    const f = fillFromTrades(rec.taker.map(({ trade_fee, ...t }) => t), { rfqId: RFQ });
    expect(f.premium).toBe(0.95);
    expect(f.fees).toBeNull();
    expect(f.legs.every((l) => l.fee === null)).toBe(true);
  });
  it("counts repeated trade ids once before aggregating contracts, premiums and fees", () => {
    const once = fillFromTrades(rec.taker, { rfqId: RFQ });
    const duplicated = fillFromTrades([...rec.taker, ...rec.taker], { rfqId: RFQ });
    expect(duplicated).toEqual(once);
    expect(duplicated.legs.map((l) => l.qty)).toEqual([0.01, 0.01]);
    expect(duplicated.premium).toBe(0.95);
    expect(duplicated.fees).toBe(0.65125);
  });

  it("keeps the taker's rows of one RFQ and ignores the maker's", () => {
    const f = fillFromTrades([...rec.maker, ...rec.taker], { rfqId: RFQ });
    expect(f.premium).toBe(0.95);
    expect(f.fees).toBe(0.65125);
    expect(fillFromTrades(rec.maker, { rfqId: RFQ })).toBeNull();
    expect(fillFromExecute(executed({ pct: "0.5" }), LEGS)).toMatchObject({ premium: 0.475, fees: 0.65125 });
  });
});

describe("a key Derive rejects in use", () => {
  it("tells the seat once, from the RFQ, the tap or a cancelled fill, so it can ask for a fresh approval", async () => {
    const cases = [
      [{ "private/send_rfq": deriveError(14026, "Session key not found") }, false],
      [{ [EXECUTE]: deriveError(14030, "Session key expired") }, true],
      [{ [EXECUTE]: executed({ status: "cancelled", pct: "0", cancel: "session_key_deregistered" }) }, true],
    ];
    for (const [handlers, tap] of cases) {
      const dropped = [];
      const { t, fake } = setup({ handlers, onKeyRejected: () => dropped.push(1) });
      if (tap) { await quoted(t); await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee }); } else await t.start();
      expect(dropped).toHaveLength(1);
      expect(t.state.message).toBe("Cowboy's approval has ended. Approve again to continue.");
      expect(fake.calls(EXECUTE).length).toBeLessThanOrEqual(1);
    }
    // Other refusals leave the key alone.
    const dropped = [];
    const { t } = setup({ handlers: { [EXECUTE]: deriveError(11110, "Quote taker total cost too high") }, onKeyRejected: () => dropped.push(1) });
    await quoted(t);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(dropped).toHaveLength(0);
  });
});

describe("a complete fill, or one flagged as not yet complete", () => {
  // Derive's history can catch up one leg at a time: the second (short) leg alone would read as a
  // credit of $0.26 instead of the $0.95 paid.
  const shortLeg = rec.taker.filter((x) => x.instrument_name.includes("92000"));

  it("re-reads while the history holds only one leg of the package, and records the whole package", async () => {
    let reads = 0;
    const { t, fills } = setup({ handlers: { "private/get_trade_history": () => (++reads < 3 ? history(shortLeg) : history([...rec.taker, ...rec.maker])) } });
    await quoted(t);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(t.state.phase).toBe("filled");
    expect(t.state.fill).toMatchObject({ premium: 0.95, fees: 0.65125, complete: true, source: "trade_history" });
    expect(t.state.fill.legs).toHaveLength(2);
    expect(fills[0].premium).toBe(0.95);
  });

  it("falls back to execute_quote's complete legs when the history stays one leg short", async () => {
    const { t } = setup({ handlers: { "private/get_trade_history": history(shortLeg) } });
    await quoted(t);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(t.state.fill).toMatchObject({ source: "execute_quote", premium: 0.95, complete: true });
  });

  it("records it flagged as incomplete when neither the history nor the answer has every leg", async () => {
    const { t, fills } = setup({ handlers: {
      [EXECUTE]: { ...executed(), legs: [{ ...LEGS[1], price: "26" }] },
      "private/get_trade_history": history(shortLeg),
    } });
    await quoted(t);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(t.state.phase).toBe("filled");
    expect(t.state.fill.complete).toBe(false);
    expect(fills[0].complete).toBe(false);
  });

  it("counts a part fill as complete when every leg filled the same share", async () => {
    const half = rec.taker.map((x) => ({ ...x, trade_amount: "0.005" }));
    const { t } = setup({ handlers: { [EXECUTE]: executed({ pct: "0.5" }), "private/get_trade_history": history(half) } });
    await quoted(t);
    await t.confirm({ quoteId: t.state.quote.quote_id, total: t.state.check.total, maxFee: t.state.check.maxFee });
    expect(t.state.fill).toMatchObject({ complete: true, partial: true, premium: 0.475 });
  });
});

describe("a quote worse than Derive's order book (owner's testnet run, 5 October 2026: 11110)", () => {
  const worse = (fn) => ({ "private/rfq_get_best_quote": (p) => ({ ...bestQuote({ direction: p.direction, total: fn() }), orderbook_total_cost: "1.00" }) });

  it("is never offered: the ticket keeps waiting for a better one", async () => {
    let n = 0;
    const { t, fake } = setup({ handlers: worse(() => (n++ < 2 ? "1.10" : "0.95")) });
    await t.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.state.phase).toBe("asking");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.state.phase).toBe("quoted");
    expect(t.state.check.total).toBe(0.95);
    expect(fake.calls(EXECUTE)).toHaveLength(0);
  });

  it("asks again by itself, three requests in all, then says so with both totals in the testnet details", async () => {
    const { t, fake } = setup({ handlers: worse(() => "1.10") });
    await t.start();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(t.state).toMatchObject({ phase: "asking", attempt: 2, attempts: 3 });
    expect(fake.calls("private/send_rfq")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(t.state).toMatchObject({ phase: "blocked", check: { reason: "book_better" } });
    expect(JSON.parse(t.state.detail.data)).toEqual({ quote_total_cost: 1.1, orderbook_total_cost: 1 });
    expect(fake.calls("private/send_rfq")).toHaveLength(3);
    expect(fake.calls("private/cancel_rfq")).toHaveLength(3);
    expect(fake.calls(EXECUTE)).toHaveLength(0);
  });

  it("takes a good quote from a request it sent by itself", async () => {
    let n = 0;
    const { t, fake } = setup({ handlers: worse(() => (fake.calls("private/send_rfq").length >= 2 && n++ >= 0 ? "0.95" : "1.10")) });
    await t.start();
    await vi.advanceTimersByTimeAsync(13_000);
    expect(t.state.phase).toBe("quoted");
    expect(t.state.check.total).toBe(0.95);
    expect(fake.calls("private/send_rfq")).toHaveLength(2);
    // The user's own Ask again starts the count again.
    await t.start();
    expect(t.state.attempt).toBe(1);
  });
});
