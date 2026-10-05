// Positions from Derive, the hard cases: a fill first recorded one leg short is repaired on sync;
// records are scoped to the wallet and Derive account they were traded from; recovered sell backs
// each take one entry with the contracts it has left; recovered entries get stable, unique keys.
import { describe, it, expect, beforeEach, vi } from "vitest";
import rec from "../../fixtures/trade/testnet_rfq_trades.json";

vi.mock("../flags.js", () => ({ QUESTIONS_ON: true, TRADE_ON: true, TESTNET_FILLS: true, MAINNET_FILLS: false, ONE_TAP_FILLS: true, tradeMode: () => "testnet" }));
import { fillFromTrades } from "./fills.js";
import { buyRecord, exitFromFill, oneTapKey } from "./record.js";
import { fillsByRfq, recoverFills } from "./sync.js";
import { addPosition, closePosition, closeSummary, exportPositions, forWallet, importPositions, loadPositions, partial, patchPosition, positionFigures, replacePosition, savePositions, settlePosition, valuePosition, _resetMemory } from "../positions.js";
import { exposureGroups, positionExposure } from "../exposure.js";
import { realized, remainingQty } from "../realized.js";

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
    const legacy = buyRecord({ fill: wrong, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    legacy.journal.fill.complete = true; // the older version saved this flag without validating the receipt
    const [saved] = addPosition(legacy, SAVED * 1000);
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

  it("imports the same RFQ's fuller receipt under its existing key, instead of creating a second lot", () => {
    const half = { ...fillFromTrades(shortLeg, { rfqId: rec.rfq_id }), complete: false };
    const [saved] = addPosition(buyRecord({ fill: half, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB }), SAVED * 1000);
    const full = buyRecord({ fill: fillFromTrades(buyRows, { rfqId: rec.rfq_id }), id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    expect(full.key).not.toBe(saved.key);
    addPosition(full, SAVED * 1000 + 1);
    expect(loadPositions("testnet")).toHaveLength(1);
    importPositions(JSON.stringify({ version: 3, networks: { testnet: [full] } }));
    expect(loadPositions("testnet")).toHaveLength(1);
    expect(loadPositions("testnet")[0]).toMatchObject({ key: saved.key, contracts: 0.01, paid: 1.60125 });
    expect(loadPositions("testnet")[0].journal.fill.complete).toBe(true);
  });

  it("imports a complete receipt without losing historical exits from the incomplete copy", () => {
    const half = { ...fillFromTrades(shortLeg, { rfqId: rec.rfq_id }), complete: false };
    const old = buyRecord({ fill: half, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    const settlement = { kind: "settle", qty: 0.01, ts: old.settle_ts, saved_ts: 1791187500, settle_price: 91000,
      gross: 0, gross_basis: "exact", fees: 0, fees_basis: "none", net: 0 };
    const [saved] = addPosition({ ...old, exits: [settlement], settled_at: 1791187500 }, SAVED * 1000);
    const full = buyRecord({ fill: fillFromTrades(buyRows, { rfqId: rec.rfq_id }), id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    importPositions(JSON.stringify({ version: 3, networks: { testnet: [full] } }));
    const [merged] = loadPositions("testnet");
    expect(merged.key).toBe(saved.key);
    expect(merged.journal.fill.complete).toBe(true);
    expect(merged.journal.cost.total).toBe(1.60125);
    expect(merged.exits).toHaveLength(1);
    expect(merged.exits[0]).toMatchObject({ settle_price: 91000, saved_ts: settlement.saved_ts, gross: 10 });
    expect(realized(merged).net).toBeCloseTo(8.39875, 8);
  });
});

describe("incomplete RFQ receipts and synthesized settlement", () => {
  it("withholds full-answer amounts and settlement until every entry leg is confirmed", () => {
    const half = { ...fillFromTrades(shortLeg, { rfqId: rec.rfq_id }), complete: false };
    const [r] = addPosition(buyRecord({ fill: half, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB }), SAVED * 1000);
    expect(partial(r)).toBe(true);
    expect(valuePosition({ ...r, closed_at: 1791187500, proceeds: 500 }, null)).toEqual({ settled: false, partial: true, now: null });
    expect(positionFigures(r, { index: 91000, settlePrice: 91000 })).toMatchObject({ maxPayout: null, expiryNow: null, got: null, pl: null });
    expect(settlePosition(r.key, 91000, 1791187500, "testnet")[0].exits).toEqual([]);
  });

  it("repairs a settlement synthesized from the old one-leg receipt, keeping its original settlement price", () => {
    const half = { ...fillFromTrades(shortLeg, { rfqId: rec.rfq_id }), complete: false };
    const r = buyRecord({ fill: half, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    const oldSettlement = { kind: "settle", qty: 0.01, ts: r.settle_ts, saved_ts: 1791187500, settle_price: 91000,
      gross: 0, gross_basis: "exact", fees: 0, fees_basis: "none", net: 0, mark: null };
    const [saved] = addPosition({ ...r, exits: [oldSettlement], settled_at: 1791187500 }, SAVED * 1000);
    const out = recoverFills(loadPositions("testnet"), fillsByRfq(buyRows), 1791187600, scope);
    expect(out.repairs).toHaveLength(1);
    const fixed = out.repairs[0].record;
    expect(fixed.exits[0]).toMatchObject({ kind: "settle", qty: 0.01, settle_price: 91000, gross: 10, net: 10, saved_ts: oldSettlement.saved_ts });
    expect(realized(fixed).net).toBeCloseTo(10 - 1.60125, 8);
    replacePosition(saved.key, fixed, "testnet");
    expect(recoverFills(loadPositions("testnet"), fillsByRfq(buyRows), 1791187700, scope).repairs).toHaveLength(0);
  });

  it("keeps a partial close receipt pending without consuming inventory, then repairs from both close legs", () => {
    const full = fillFromTrades(buyRows, { rfqId: rec.rfq_id });
    const [r] = addPosition(buyRecord({ fill: full, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB }), SAVED * 1000);
    const rows = sellBack(1);
    const pending = exitFromFill({ ...fillFromTrades(rows.slice(0, 1)), complete: false }, { savedTs: 1790960000 });
    const [saved] = closePosition(r.key, pending, 1790960000, "testnet");
    expect(remainingQty(saved)).toBe(0.01);
    expect(saved.exits[0]).toMatchObject({ qty: 0, receipt_qty: 0.01, complete: false });
    expect(partial(saved)).toBe(true);
    expect(realized(saved).net).toBeNull();
    const out = recoverFills(loadPositions("testnet"), fillsByRfq(rows), 1790960050, scope);
    expect(out.exits).toHaveLength(0);
    expect(out.repairs).toHaveLength(1);
    const fixed = out.repairs[0].record;
    expect(fixed.exits[0]).toMatchObject({ qty: 0.01, complete: true, gross: 1.2, fees: 0.62, net: 0.58 });
    expect(remainingQty(fixed)).toBe(0);
    replacePosition(r.key, fixed, "testnet");
    expect(recoverFills(loadPositions("testnet"), fillsByRfq(rows), 1790960100, scope).repairs).toHaveLength(0);
  });
});

describe("full RFQ receipts with unknown entry fees", () => {
  const feeUnknown = () => buyRecord({ fill: fillFromTrades(buyRows.map(({ trade_fee, ...t }) => t), { rfqId: rec.rfq_id }),
    id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });

  it("retains known gross payout and value while withholding fee-inclusive cost, breakeven and P/L", () => {
    const r = feeUnknown();
    expect(r.journal.fill.complete).toBe(true);
    expect(r.journal.cost).toMatchObject({ premium: 0.95, fees: null, total: null, breakeven: null, breakeven_basis: "unavailable" });
    expect(r.paid).toBeNull();
    const found = { level: { lo: 90000, hi: 92000, fair: 0.5, yes: { sell: 0.6, legs: r.legs.map((n) => [n]) } } };
    const f = positionFigures(r, { found, close: { fees: 0.5 }, index: 91000 });
    expect(f).toMatchObject({ paid: null, maxPayout: 20, valueNow: 11.5, expiryNow: 10, plNow: null, plExpiryNow: null });
    expect(positionFigures(r, { settlePrice: 91000 })).toMatchObject({ got: 10, pl: null });
    expect(positionFigures({ ...r, closed_at: 1790960000, proceeds: 0.58 })).toMatchObject({ got: 0.58, pl: null });
    expect(closeSummary({ premium: 1.2, fees: 0.62 }, r.paid, 10)).toMatchObject({ proceeds: 0.58, pl: null, holdPl: null });
    expect(positionExposure(r)).toMatchObject({ cost: null });
    expect(positionExposure(r).legs).toHaveLength(2);
    expect(exposureGroups([r], SAVED)).toEqual([]);
  });

  it("masks and normalizes saved premium-only paid fields even when the missing-fee receipt otherwise agrees", () => {
    const r = feeUnknown();
    r.paid = r.journal.cost.premium; // older fallback treated the known premium as the total
    r.journal.cost.breakeven = 90095;
    r.journal.cost.breakeven_basis = "before_fees";
    addPosition(r, SAVED * 1000);
    expect(positionFigures(r, { settlePrice: 91000 })).toMatchObject({ paid: null, got: 10, pl: null });
    const history = fillsByRfq(buyRows.map(({ trade_fee, ...t }) => t));
    const out = recoverFills(loadPositions("testnet"), history, 1790950000, scope);
    expect(out.repairs).toHaveLength(1);
    expect(out.repairs[0].record).toMatchObject({ paid: null });
    expect(out.repairs[0].record.journal.cost).toMatchObject({ total: null, breakeven: null, breakeven_basis: "unavailable" });
    replacePosition(r.key, out.repairs[0].record, "testnet");
    expect(recoverFills(loadPositions("testnet"), history, 1790950100, scope).repairs).toHaveLength(0);
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

  it("claims missing scope fields only when every known field agrees with the authoritative account", () => {
    const fill = fillFromTrades(buyRows, { rfqId: rec.rfq_id });
    const base = buyRecord({ fill, id: ID, side: "yes", savedTs: SAVED });
    const rows = [
      { ...base, key: "wallet-only", wallet: WALLET },
      { ...base, key: "account-only", subaccount_id: SUB },
      { ...base, key: "wrong-wallet", wallet: OTHER_WALLET },
      { ...base, key: "wrong-account", subaccount_id: SUB2 },
    ];
    const out = recoverFills(rows, fillsByRfq(buyRows), 1790960500, scope);
    expect(out.claims.map((c) => c.key)).toEqual(["wallet-only", "account-only"]);
    expect(out.claims.every((c) => c.wallet === WALLET && c.subaccount_id === SUB)).toBe(true);
    expect(recoverFills(rows, [], 1790960500, scope).claims).toEqual([]);
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
  const saveBuys = (rows = [...buyRows, ...buyAgain(2)]) => {
    const out = recoverFills([], fillsByRfq(rows), 1790960000, scope);
    out.added.forEach((r) => addPosition(r, 1790960000000));
    return loadPositions("testnet");
  };
  const biggerClose = (qty) => sellBack(1).map((t) => ({ ...t, trade_amount: String(qty) }));
  const apply = (out) => {
    for (const { key, record } of out.repairs) replacePosition(key, record, "testnet");
    for (const { key, exit } of out.exits) closePosition(key, exit, 1790960500, "testnet");
    return loadPositions("testnet");
  };

  it("skips a malformed older receipt marked complete when only authoritative close history is available", () => {
    const badFill = fillFromTrades(shortLeg.map((t) => ({ ...t, rfq_id: "legacy-malformed", timestamp: t.timestamp - 1000 })));
    const bad = buyRecord({ fill: badFill, id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    bad.journal.fill.complete = true;
    addPosition(bad, SAVED * 1000);
    const good = buyRecord({ fill: fillFromTrades(buyRows), id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    addPosition(good, SAVED * 1000);
    const out = recoverFills(loadPositions("testnet"), fillsByRfq(sellBack(1)), 1790960500, scope);
    expect(out.exits.map((x) => x.key)).toEqual([good.key]);
    expect(out.unmatched).toBeUndefined();
  });

  it("reports the entire close as unmatched when every saved entry receipt is malformed", () => {
    const bad = buyRecord({ fill: fillFromTrades(shortLeg), id: ID, side: "yes", savedTs: SAVED, wallet: WALLET, subaccountId: SUB });
    bad.journal.fill.complete = true;
    addPosition(bad, SAVED * 1000);
    const out = recoverFills(loadPositions("testnet"), fillsByRfq(sellBack(1)), 1790960500, scope);
    expect(out.exits).toEqual([]);
    expect(out.unmatched[0].exit).toMatchObject({ qty: 0.01, gross: 1.2, fees: 0.62, net: 0.58 });
  });

  it("retains millisecond chronology so a later same-second buy cannot cover an earlier close", () => {
    const base = 1790950000000;
    const early = buyRows.map((t) => ({ ...t, timestamp: base + 100 }));
    const later = buyAgain(2).map((t) => ({ ...t, timestamp: base + 900 }));
    saveBuys([...later, ...early]); // exchange history is newest first
    const rows = sellBack(1).map((t) => ({ ...t, timestamp: base + 500 }));
    const out = recoverFills(loadPositions("testnet"), fillsByRfq(rows), 1790960500, scope);
    const oldest = loadPositions("testnet").find((p) => p.journal.fill.rfq_id === rec.rfq_id);
    expect(oldest.journal.fill.ts).toBe(1790950000.1);
    expect(out.exits.map((x) => x.key)).toEqual([oldest.key]);
    expect(out.exits[0].exit.ts).toBe(1790950000.5);
  });

  it("allocates one close across entry lots, counting the execution's proceeds and fee only once", () => {
    const list = saveBuys();
    const fills = fillsByRfq(biggerClose(0.02));
    const out = recoverFills(list, fills, 1790960500, scope);
    expect(out.exits.map((x) => x.exit.qty)).toEqual([0.01, 0.01]);
    expect(out.exits.map((x) => x.exit.gross)).toEqual([1.2, 1.2]);
    expect(out.exits.map((x) => x.exit.fees)).toEqual([0.31, 0.31]);
    const after = apply(out);
    expect(after.every((p) => remainingQty(p) === 0)).toBe(true);
    expect(after.reduce((a, p) => a + realized(p).net, 0)).toBeCloseTo(2.4 - 0.62 - 2 * 1.60125, 8);
    expect(recoverFills(after, fills, 1790960600, scope)).toEqual({ added: [], exits: [], repairs: [], claims: [] });
  });

  it("preserves an existing partial close and consumes only each lot's available contracts", () => {
    let list = saveBuys([...buyRows.map((t) => ({ ...t, trade_amount: "0.02" })), ...buyAgain(2)]);
    const prior = { kind: "close", qty: 0.005, ts: 1790950000, saved_ts: 1790950000, gross: 0.6, fees: 0.2, net: 0.4 };
    list = closePosition(list[0].key, prior, 1790950000, "testnet");
    const out = recoverFills(list, fillsByRfq(biggerClose(0.02)), 1790960500, scope);
    expect(out.exits.map((x) => x.exit.qty)).toEqual([0.015, 0.005]);
    expect(out.exits.reduce((a, x) => a + x.exit.gross, 0)).toBeCloseTo(2.4, 12);
    expect(out.exits.reduce((a, x) => a + x.exit.fees, 0)).toBeCloseTo(0.62, 12);
    const after = apply(out);
    expect(after[0].exits[0]).toEqual(prior);
    expect(after.map(remainingQty)).toEqual([0, 0.005]);
  });

  it("repairs old clamped closes across every affected entry lot without multiplying cash on re-sync", () => {
    const list = saveBuys();
    const rows = biggerClose(0.02);
    const full = exitFromFill(fillFromTrades(rows), { savedTs: 1790960500 });
    savePositions([{ ...list[0], exits: [{ ...full, qty: 0.01 }], closed_at: 1790960500, proceeds: full.net }, list[1]], "testnet");
    const out = recoverFills(loadPositions("testnet"), fillsByRfq(rows), 1790960600, scope);
    expect(out.exits).toHaveLength(0);
    expect(out.repairs).toHaveLength(2);
    const after = apply(out);
    expect(after.map(remainingQty)).toEqual([0, 0]);
    expect(after.reduce((a, p) => a + p.exits[0].gross, 0)).toBeCloseTo(2.4, 12);
    expect(after.reduce((a, p) => a + p.exits[0].fees, 0)).toBeCloseTo(0.62, 12);
    expect(recoverFills(after, fillsByRfq(rows), 1790960700, scope).repairs).toHaveLength(0);
  });

  it("allocates a known close onto an entry recovered in the second pass", () => {
    const [first] = saveBuys(buyRows);
    const rows = biggerClose(0.02);
    const full = exitFromFill(fillFromTrades(rows), { savedTs: 1790960500 });
    savePositions([{ ...first, exits: [{ ...full, qty: 0.01 }], closed_at: 1790960500, proceeds: full.net }], "testnet");
    const history = fillsByRfq([...buyRows, ...buyAgain(2), ...rows]);
    const firstPass = recoverFills(loadPositions("testnet"), history, 1790960600, scope);
    expect(firstPass.added).toHaveLength(1);
    expect(firstPass.unmatched[0].exit.qty).toBe(0.01);
    apply(firstPass);
    firstPass.added.forEach((r) => addPosition(r, 1790960600000));
    const secondPass = recoverFills(loadPositions("testnet"), history, 1790960600, scope);
    expect(secondPass.repairs).toHaveLength(1);
    expect(secondPass.exits).toHaveLength(0);
    expect(secondPass.unmatched).toBeUndefined();
    const after = apply(secondPass);
    expect(after.map(remainingQty)).toEqual([0, 0]);
    expect(after.reduce((a, p) => a + p.exits[0].gross, 0)).toBeCloseTo(2.4, 12);
  });

  it("keeps a sell back on the lot the user closed, though an older lot of the same answer is open", () => {
    const list = saveBuys();
    const older = list.find((p) => p.journal.fill.rfq_id === rec.rfq_id);
    const newer = list.find((p) => p.key !== older.key);
    expect(older.journal.fill.ts).toBeLessThan(newer.journal.fill.ts);
    // The user pressed Close on the newer card: the ticket saved the sell back there.
    closePosition(newer.key, exitFromFill(fillFromTrades(sellBack(1)), { savedTs: 1790960100 }), 1790960100, "testnet");
    const fills = fillsByRfq(sellBack(1));
    const after = apply(recoverFills(loadPositions("testnet"), fills, 1790960500, scope));
    expect(remainingQty(after.find((p) => p.key === newer.key))).toBe(0);
    expect(after.find((p) => p.key === newer.key).closed_at).toBeTruthy();
    expect(remainingQty(after.find((p) => p.key === older.key))).toBe(0.01);
    expect(after.find((p) => p.key === older.key).closed_at).toBeUndefined();
    expect(recoverFills(after, fills, 1790960600, scope).repairs).toHaveLength(0);
  });

  it("moves only what its saved lot can no longer hold to the oldest open lot", () => {
    const list = saveBuys();
    const older = list.find((p) => p.journal.fill.rfq_id === rec.rfq_id);
    const newer = list.find((p) => p.key !== older.key);
    const rows = biggerClose(0.02);
    // Saved by an older version: the whole 0.02 sell back on the newer lot, which holds 0.01.
    savePositions([older, { ...newer, exits: [exitFromFill(fillFromTrades(rows), { savedTs: 1790960500 })] }], "testnet");
    const after = apply(recoverFills(loadPositions("testnet"), fillsByRfq(rows), 1790960600, scope));
    const newerExit = after.find((p) => p.key === newer.key).exits[0];
    const olderExit = after.find((p) => p.key === older.key).exits[0];
    expect([newerExit.qty, olderExit.qty]).toEqual([0.01, 0.01]);
    expect([newerExit.allocation_offset, olderExit.allocation_offset]).toEqual([0, 0.01]);
    expect(newerExit.gross + olderExit.gross).toBeCloseTo(2.4, 12);
    expect(newerExit.fees + olderExit.fees).toBeCloseTo(0.62, 12);
    expect(recoverFills(after, fillsByRfq(rows), 1790960700, scope).repairs).toHaveLength(0);
  });

  it("reports cash and quantity beyond eligible inventory instead of attaching them to a smaller entry", () => {
    const list = saveBuys();
    const out = recoverFills(list, fillsByRfq(biggerClose(0.03)), 1790960500, scope);
    expect(out.exits.map((x) => x.exit.qty)).toEqual([0.01, 0.01]);
    expect(out.unmatched[0].exit.qty).toBe(0.01);
    const portions = [...out.exits.map((x) => x.exit), out.unmatched[0].exit];
    expect(portions.reduce((a, e) => a + e.qty, 0)).toBeCloseTo(0.03, 12);
    expect(portions.reduce((a, e) => a + e.gross, 0)).toBeCloseTo(3.6, 12);
    expect(portions.reduce((a, e) => a + e.fees, 0)).toBeCloseTo(0.62, 12);
  });

  it("recalculates the remaining settlement after recovering an earlier partial close", () => {
    let list = saveBuys(buyRows);
    list = settlePosition(list[0].key, 91000, 1791187500, "testnet");
    expect(list[0].exits[0].gross).toBe(10);
    const out = recoverFills(list, fillsByRfq(biggerClose(0.005)), 1791187600, scope);
    const after = apply(out);
    expect(after[0].exits.find((e) => e.kind === "settle")).toMatchObject({ qty: 0.005, gross: 5, net: 5 });
    expect(after[0].exits.find((e) => e.kind === "close")).toMatchObject({ qty: 0.005, gross: 0.6, fees: 0.62 });
    expect(recoverFills(after, fillsByRfq(biggerClose(0.005)), 1791187700, scope).repairs).toHaveLength(0);
  });
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
