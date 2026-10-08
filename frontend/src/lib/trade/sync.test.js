// Saloon stage 2, P6: Positions from Derive and the exact journal records of one-tap fills.
import { describe, it, expect, beforeEach, vi } from "vitest";
import rec from "../../fixtures/trade/testnet_rfq_trades.json";

vi.mock("../flags.js", () => ({ FUND_ANYCHAIN: false, RYSK_MOCK: false, QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true, MAINNET_FILLS: false, ONE_TAP_FILLS: true, tradeMode: () => "testnet" }));
import { createClient } from "./derive.js";
import { fakeDerive } from "./fakeSocket.js";
import { TESTNET_WS } from "./config.js";
import { fillFromTrades } from "./fills.js";
import { buyRecord, exitFromFill, knownRfqs, parseLabel } from "./record.js";
import { expectedByInstrument, fillsByRfq, heldByInstrument, legStatus, pairAnswers, readSaloon, recoverFills, settlementPrice, unexplained } from "./sync.js";
import { addPosition, closePosition, loadPositions, positionStatus, settlePosition, _resetMemory } from "../positions.js";
import { realized } from "../realized.js";

const ID = "BTC-20261005-A-90000-92000";
const label = `${ID}:yes`;
const buyRows = rec.taker.map((t) => ({ ...t, label }));
const fill = { ...fillFromTrades(buyRows, { rfqId: rec.rfq_id }), pct: 1 };
const SAVED = 1790949800;
const sellRows = rec.taker.map((t) => ({ ...t, label: `${label}:close`, rfq_id: "5a5a5a5a-0000-4000-8000-000000000001", quote_id: "5a5a5a5a-0000-4000-8000-000000000002",
  trade_id: `${t.trade_id.slice(0, -4)}aaaa`, direction: t.direction === "buy" ? "sell" : "buy", trade_price: t.instrument_name.includes("90000") ? "160" : "40",
  trade_fee: t.instrument_name.includes("90000") ? "0.62" : "0", timestamp: 1790960000000 }));
const pos = (name, amount) => ({ instrument_name: name, instrument_type: "option", amount: String(amount) });

beforeEach(() => { localStorage.clear(); _resetMemory(); });

describe("exact journal records", () => {
  it("records a one-tap buy from Derive's records, with nothing entered by the user", () => {
    const board = { index: 86667.9, prices_ts: 1790949600, spec: {} };
    const level = { id: ID, lo: 90000, hi: 92000, fair: 0.42 };
    const r = buyRecord({ fill, id: ID, side: "yes", requested: 0.01, level, board, pricesTs: board.prices_ts,
      markets: { generated_at: 1790949000, coins: [] }, estimate: { total: 1.7, ts: board.prices_ts }, savedTs: SAVED });
    expect(r).toMatchObject({ id: ID, und: "BTC", side: "yes", lo: 90000, hi: 92000, contracts: 0.01, exec: "rfq", network: "testnet", v: 2,
      paid: 1.60125, legs: ["BTC-20261005-90000-C", "BTC-20261005-92000-C"], settle_ts: Date.UTC(2026, 9, 5, 8) / 1000 });
    const j = r.journal;
    expect(j).toMatchObject({ source: "derive", entered_by_you: [], network: "testnet" });
    expect(j.fill).toMatchObject({ ts: 1790949750.491, complete: true, premium: 0.95, fees: 0.65125, fees_known: true, rfq_id: rec.rfq_id, filled_pct: 1, source: "trade_history" });
    expect(j.fill.trade_ids).toEqual(["5980561c-3e33-4b4a-8a95-e9f27ffdc313", "6fdabd5d-0d0e-4992-b1ef-c8ea40ab6a26"]);
    expect(j.fill.legs.map((l) => [l.name, l.signed_qty, l.price, l.fee])).toEqual([["BTC-20261005-90000-C", 0.01, 121, 0.65125], ["BTC-20261005-92000-C", -0.01, 26, 0]]);
    expect(j.cost).toMatchObject({ premium: 0.95, fees: 0.65125, fees_basis: "exact", total: 1.60125, breakeven_basis: "exact" });
    expect(j.cost.breakeven).toBeCloseTo(90160.13, 1);
    expect(j.mark).toMatchObject({ per: 0.42, value: 8.4, ts: board.prices_ts, timing: "entry" });
    expect(j.board_estimate).toEqual({ total: 1.7, ts: board.prices_ts });
    expect(j.context.status).toBe("at_fill"); // published before the fill
    // Saved under the testnet journal key, apart from mainnet.
    addPosition(r, SAVED * 1000);
    expect(loadPositions("testnet")).toHaveLength(1);
    expect(loadPositions("mainnet")).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("cowboy-questions:testnet"))[0].journal.fill.rfq_id).toBe(rec.rfq_id);
    expect(positionStatus(loadPositions("testnet")[0]).text).toBe("Bought in one tap");
  });

  it("records a one-tap sell back as an exact J2 exit, and realized P/L reconciles from Derive's figures", () => {
    const r = addPosition(buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED }), SAVED * 1000)[0];
    const sale = fillFromTrades(sellRows);
    const exit = exitFromFill(sale, { mark: { value: 1.25, ts: 1790960000 }, savedTs: 1790960100 });
    expect(exit).toMatchObject({ kind: "close", via: "rfq", qty: 0.01, ts: 1790960000, gross: 1.2, gross_basis: "exact", fees: 0.62, fees_basis: "exact", net: 0.58 });
    const [closed] = closePosition(r.key, exit, 1790960100, "testnet");
    expect(closed.closed_at).toBe(1790960100);
    expect(positionStatus(closed).text).toBe("Closed · sold back in one tap");
    const x = realized(closed);
    expect(x.net).toBeCloseTo(0.58 - 1.60125, 8);
    expect(x.portions[0].basis).toMatchObject({ exit: "exact", exit_fees: "exact", entry_fees: "exact" });
    expect(x.portions[0].estimated).toBe(false);
    expect(knownRfqs([closed])).toEqual(new Set([rec.rfq_id, sale.rfq_id]));
  });

  it("names the answer from the RFQ label", () => {
    expect(parseLabel(label)).toEqual({ id: ID, side: "yes", close: false });
    expect(parseLabel(`${label}:close`)).toEqual({ id: ID, side: "yes", close: true });
    expect(parseLabel("eth-covered-call")).toBeNull();
  });
});

describe("Positions from Derive", () => {
  it("pairs held options into Saloon answers by their legs", () => {
    const held = heldByInstrument([
      pos("BTC-20261005-90000-C", 0.01), pos("BTC-20261005-92000-C", -0.01),
      pos("ETH-20261009-3200-P", 0.5), pos("ETH-20261009-3000-P", -0.5),
      pos("BTC-20261009-1_35-C", 1), { instrument_name: "BTC-PERP", instrument_type: "perp", amount: "1" },
    ]);
    expect(held.has("BTC-PERP")).toBe(false);
    const { answers, rest } = pairAnswers(held);
    expect(answers).toEqual([
      { und: "BTC", expiry: "20261005", side: "yes", lo: 90000, hi: 92000, contracts: 0.01, legs: ["BTC-20261005-90000-C", "BTC-20261005-92000-C"] },
      { und: "ETH", expiry: "20261009", side: "no", lo: 3000, hi: 3200, contracts: 0.5, legs: ["ETH-20261009-3000-P", "ETH-20261009-3200-P"] },
    ]);
    expect(rest).toEqual([{ name: "BTC-20261009-1_35-C", amount: 1 }]);
  });

  it("says for each record whether Derive holds its legs, and lists what no record explains", () => {
    const now = 1790950000;
    const a = addPosition(buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED }), SAVED * 1000)[0];
    const list = loadPositions("testnet");
    expect(expectedByInstrument(list, now)).toEqual(new Map([["BTC-20261005-90000-C", 0.01], ["BTC-20261005-92000-C", -0.01]]));
    const same = heldByInstrument([pos("BTC-20261005-90000-C", 0.01), pos("BTC-20261005-92000-C", -0.01)]);
    expect(legStatus(list, same, now)[a.key]).toEqual({ state: "matches" });
    const less = heldByInstrument([pos("BTC-20261005-90000-C", 0.005), pos("BTC-20261005-92000-C", -0.005), pos("BTC-20261005-94000-C", 0.02), pos("BTC-20261005-96000-C", -0.02)]);
    const s = legStatus(list, less, now)[a.key];
    expect(s.state).toBe("differs");
    expect(s.diff).toEqual([{ name: "BTC-20261005-90000-C", expected: 0.01, held: 0.005 }, { name: "BTC-20261005-92000-C", expected: -0.01, held: -0.005 }]);
    const extra = unexplained(list, less, now);
    expect(extra.answers).toEqual([
      { und: "BTC", expiry: "20261005", side: "yes", lo: 94000, hi: 96000, contracts: 0.02, legs: ["BTC-20261005-94000-C", "BTC-20261005-96000-C"] },
    ]);
    expect(extra.rest.map((r) => r.name)).toEqual(["BTC-20261005-90000-C", "BTC-20261005-92000-C"]);
    expect(legStatus(list, same, Date.UTC(2026, 9, 5, 8, 1) / 1000)[a.key].state).toBe("settled");
  });

  it("adds one-tap fills this browser missed and sell backs as exact exits, once", () => {
    const fills = fillsByRfq([...rec.maker, ...buyRows, ...sellRows]);
    expect(fills.map((f) => f.label)).toEqual([label, `${label}:close`]);
    const { added, exits } = recoverFills([], fills, 1790960200);
    expect(added).toHaveLength(1);
    expect(exits).toHaveLength(0);
    expect(added[0]).toMatchObject({ id: ID, side: "yes", exec: "rfq", recovered: true, paid: 1.60125 });
    expect(added[0].journal.fill.trade_ids).toHaveLength(2);
    // The exit waits for the record: once it is saved, the sell back lands on it.
    const [r] = addPosition(added[0], 1790960200000);
    const again = recoverFills(loadPositions("testnet"), fills, 1790960300);
    expect(again.added).toHaveLength(0);
    expect(again.exits).toEqual([{ key: r.key, exit: expect.objectContaining({ via: "rfq", gross: 1.2, fees: 0.62, rfq_id: "5a5a5a5a-0000-4000-8000-000000000001" }) }]);
    const [closed] = closePosition(r.key, again.exits[0].exit, 1790960300, "testnet");
    expect(recoverFills([closed], fills, 1790960400)).toEqual({ added: [], exits: [], repairs: [], claims: [] });
  });

  it("reads the Saloon account and the testnet's settlement price over the user's connection", async () => {
    const fake = fakeDerive({ handlers: {
      "private/get_positions": { subaccount_id: 86514, positions: [pos("BTC-20261005-90000-C", 0.01), pos("BTC-20261005-92000-C", -0.01)] },
      "private/get_trade_history": { subaccount_id: 86514, trades: buyRows, pagination: { count: 2, num_pages: 1 } },
      "public/get_option_settlement_prices": { expiries: [{ expiry_date: "20261005", price: "91200.5", utc_expiry_sec: 1791187200 }] },
    } });
    const client = createClient({ url: TESTNET_WS, WebSocketImpl: fake.WebSocketImpl, sleep: async () => {} });
    const r = await readSaloon(client, 86514, { sinceSec: 1790949000 });
    expect(r.held.get("BTC-20261005-92000-C")).toBe(-0.01);
    expect(r.trades).toHaveLength(2);
    expect(fake.calls("private/get_trade_history")[0].params).toEqual({ subaccount_id: 86514, from_timestamp: 1790949000000, page: 1, page_size: 100 });
    const price = await settlementPrice(client, "BTC", "20261005");
    expect(price).toBe(91200.5);
    expect(await settlementPrice(client, "BTC", "20261006")).toBeNull();
    // Settled at the testnet's price: the payout from the instruments held, exact.
    const [p] = addPosition(buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED }), SAVED * 1000);
    const [s] = settlePosition(p.key, price, 1791190000, "testnet");
    expect(s.exits[0]).toMatchObject({ kind: "settle", gross: 12.005, gross_basis: "exact" });
  });
});
