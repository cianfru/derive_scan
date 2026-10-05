// Positions from Derive, the hard cases: a fill first recorded one leg short is repaired on sync;
// records are scoped to the wallet and Derive account they were traded from; recovered sell backs
// each take one entry with the contracts it has left; recovered entries get stable, unique keys.
import { describe, it, expect, beforeEach, vi } from "vitest";
import rec from "../../fixtures/trade/testnet_rfq_trades.json";

vi.mock("../flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true, tradeMode: () => "testnet" }));
import { fillFromTrades } from "./fills.js";
import { buyRecord, oneTapKey } from "./record.js";
import { fillsByRfq, recoverFills } from "./sync.js";
import { addPosition, closePosition, exportPositions, forWallet, importPositions, loadPositions, patchPosition, replacePosition, _resetMemory } from "../positions.js";
import { remainingQty } from "../realized.js";

const ID = "BTC-20261005-A-90000-92000";
const label = `${ID}:yes`;
const WALLET = "0x4201C60C3c85e641c9837588429F59CA57e22bE2";
const OTHER_WALLET = "0x1111111111111111111111111111111111111111";
const SUB = 86514, SUB2 = 86515;
const SAVED = 1790949800;
const buyRows = rec.taker.map((t) => ({ ...t, label }));
const shortLeg = buyRows.filter((t) => t.instrument_name.includes("92000"));
/** Another buy of the same answer: its own RFQ and trade ids. */
const buyAgain = (n) => buyRows.map((t) => ({ ...t, rfq_id: `${rec.rfq_id.slice(0, -2)}0${n}`, quote_id: `q-${n}`, trade_id: `${t.trade_id.slice(0, -2)}0${n}`, timestamp: 1790949750000 + n * 1000 }));
/** A sell back of the whole 0.01 contracts. */
const sellBack = (n) => rec.taker.map((t) => ({ ...t, label: `${label}:close`, rfq_id: `5a5a5a5a-0000-4000-8000-00000000000${n}`, quote_id: `s-${n}`,
  trade_id: `${t.trade_id.slice(0, -4)}aa0${n}`, direction: t.direction === "buy" ? "sell" : "buy", trade_price: t.instrument_name.includes("90000") ? "160" : "40",
  trade_fee: t.instrument_name.includes("90000") ? "0.62" : "0", timestamp: 1790960000000 + n * 1000 }));
const scope = { wallet: WALLET, subaccountId: SUB };

beforeEach(() => { localStorage.clear(); _resetMemory(); });

describe("repairing a fill recorded one leg short", () => {
  it("replaces a known RFQ's incomplete record with Derive's complete trades on sync", () => {
    // What the ticket saved when the history held only the short leg: a credit of $0.26, flagged.
    const half = { ...fillFromTrades(shortLeg, { rfqId: rec.rfq_id }), pct: 1, complete: false };
    const r = buyRecord({ fill: half, id: ID, side: "yes", requested: 0.01, savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    expect(r.journal.fill.complete).toBe(false);
    expect(r.journal.fill.premium).toBe(-0.26);
    const [saved] = addPosition(r, SAVED * 1000);
    const fills = fillsByRfq(buyRows);
    const out = recoverFills(loadPositions("testnet"), fills, 1790950000, scope);
    expect(out.added).toHaveLength(0);
    expect(out.repairs).toHaveLength(1);
    expect(out.repairs[0].key).toBe(saved.key);
    const fixed = out.repairs[0].record;
    expect(fixed.journal.fill).toMatchObject({ complete: true, premium: 0.95, fees: 0.65125, rfq_id: rec.rfq_id });
    expect(fixed.journal.fill.legs).toHaveLength(2);
    expect(fixed.paid).toBeCloseTo(1.60125, 8);
    expect(fixed.key).toBe(saved.key);
    const [after] = replacePosition(saved.key, fixed, "testnet");
    expect(after.journal.fill.premium).toBe(0.95);
    // Once repaired, nothing more to do.
    expect(recoverFills(loadPositions("testnet"), fills, 1790950100, scope).repairs).toHaveLength(0);
  });

  it("repairs a record marked complete whose legs, premium or fees disagree with Derive's trades", () => {
    const wrong = { ...fillFromTrades(shortLeg, { rfqId: rec.rfq_id }), pct: 1 }; // saved by the old ticket as complete
    const [saved] = addPosition(buyRecord({ fill: wrong, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB }), SAVED * 1000);
    expect(saved.journal.fill.complete).toBe(true);
    const out = recoverFills(loadPositions("testnet"), fillsByRfq(buyRows), 1790950000, scope);
    expect(out.repairs.map((x) => x.key)).toEqual([saved.key]);
    expect(out.repairs[0].record.journal.cost.premium).toBe(0.95);
  });

  it("leaves a record alone while Derive's own trades are still one leg short", () => {
    const half = { ...fillFromTrades(shortLeg, { rfqId: rec.rfq_id }), pct: 1, complete: false };
    addPosition(buyRecord({ fill: half, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB }), SAVED * 1000);
    expect(recoverFills(loadPositions("testnet"), fillsByRfq(shortLeg), 1790950000, scope).repairs).toHaveLength(0);
  });
});

describe("records scoped to their wallet and Derive account", () => {
  const fill = { ...fillFromTrades(buyRows, { rfqId: rec.rfq_id }), pct: 1 };

  it("keeps the wallet and account on each one-tap record", () => {
    const r = buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    expect(r).toMatchObject({ wallet: WALLET, subaccount_id: SUB });
  });

  it("never matches a sell back on one account against a record of another", () => {
    addPosition(buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB2 }), SAVED * 1000);
    const out = recoverFills(loadPositions("testnet"), fillsByRfq(sellBack(1)), 1790960500, scope);
    expect(out.exits).toHaveLength(0);
    // nor a record of another wallet on the same account id
    localStorage.clear(); _resetMemory();
    addPosition(buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED, wallet: OTHER_WALLET, subaccountId: SUB }), SAVED * 1000);
    expect(recoverFills(loadPositions("testnet"), fillsByRfq(sellBack(1)), 1790960500, scope).exits).toHaveLength(0);
  });

  it("claims an older record without wallet or account on the first sync that finds its RFQ on that account", () => {
    const old = buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED });
    delete old.wallet; delete old.subaccount_id;
    const [saved] = addPosition(old, SAVED * 1000);
    expect(saved.wallet).toBeUndefined();
    // Another account's trades: not claimed, not matched.
    const elsewhere = recoverFills(loadPositions("testnet"), fillsByRfq(buyAgain(7)), 1790960500, scope);
    expect(elsewhere.claims).toHaveLength(0);
    // Its own RFQ on this account: claimed, and its sell back lands on it.
    const out = recoverFills(loadPositions("testnet"), fillsByRfq([...buyRows, ...sellBack(1)]), 1790960500, scope);
    expect(out.claims).toEqual([{ key: saved.key, wallet: WALLET, subaccount_id: SUB }]);
    expect(out.exits.map((x) => x.key)).toEqual([saved.key]);
    const [claimed] = patchPosition(saved.key, { wallet: WALLET, subaccount_id: SUB }, "testnet");
    expect(claimed).toMatchObject({ wallet: WALLET, subaccount_id: SUB });
  });

  it("shows the connected wallet's records, older unscoped ones and hand-placed ones, not another wallet's", () => {
    const mine = { id: ID, side: "yes", contracts: 1, exec: "rfq", wallet: WALLET.toLowerCase(), subaccount_id: SUB, key: "a" };
    const other = { ...mine, wallet: OTHER_WALLET, key: "b" };
    const otherAccount = { ...mine, subaccount_id: SUB2, key: "c" };
    const legacy = { id: ID, side: "yes", contracts: 1, exec: "rfq", key: "d" };
    const byHand = { id: ID, side: "yes", contracts: 1, exec: "hand_both", key: "e" };
    expect(forWallet([mine, other, otherAccount, legacy, byHand], WALLET).map((r) => r.key)).toEqual(["a", "c", "d", "e"]);
    expect(forWallet([mine, other], null).map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("exports and imports the scoped records under the same journal version", () => {
    addPosition(buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB }), SAVED * 1000);
    const text = exportPositions();
    expect(JSON.parse(text).version).toBe(3);
    localStorage.clear(); _resetMemory();
    importPositions(text);
    expect(loadPositions("testnet")[0]).toMatchObject({ wallet: WALLET, subaccount_id: SUB });
    importPositions(text);
    expect(loadPositions("testnet")).toHaveLength(1);
  });
});

describe("recovery accounting", () => {
  it("matches each recovered sell back to one entry, consuming its contracts", () => {
    const fills = fillsByRfq([...buyRows, ...buyAgain(2)]);
    const { added } = recoverFills([], fills, 1790960000, scope);
    added.forEach((r, i) => addPosition(r, 1790960000000 + i * 1000)); // saved apart: keys differ either way
    const list = loadPositions("testnet");
    expect(list).toHaveLength(2);
    const closes = fillsByRfq([...sellBack(1), ...sellBack(2)]);
    const { exits } = recoverFills(list, closes, 1790960500, scope);
    expect(exits).toHaveLength(2);
    expect(new Set(exits.map((x) => x.key)).size).toBe(2);
    let after = list;
    for (const { key, exit } of exits) after = closePosition(key, exit, 1790960500, "testnet");
    expect(after.every((p) => remainingQty(p) === 0 && p.closed_at)).toBe(true);
    // A third sell back with nothing left open finds no entry.
    expect(recoverFills(after, fillsByRfq(sellBack(3)), 1790960600, scope).exits).toHaveLength(0);
  });

  it("gives recovered entries unique, stable keys from the RFQ and its legs, even when saved in the same instant", () => {
    const fills = fillsByRfq([...buyRows, ...buyAgain(2)]);
    const { added } = recoverFills([], fills, 1790960000, scope);
    const keys = [];
    for (const r of added) keys.push(addPosition(r, 1790960000000).at(-1).key);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toBe(oneTapKey(fills[0]));
    expect(keys[0]).toBe(`rfq:${rec.rfq_id}:BTC-20261005-90000-C+BTC-20261005-92000-C`);
    // The same fill recovered again (another device, a re-sync) is the same record, never a second one.
    addPosition(recoverFills([], fills, 1790970000, scope).added[0], 1790970000000);
    expect(loadPositions("testnet")).toHaveLength(2);
  });
});
