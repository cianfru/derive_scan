import { beforeEach, describe, it, expect } from "vitest";
import {
  _resetMemory, addPosition, closePosition, exportPositions, importPositions, loadPositions, migrateRecord, openPart, settlePosition,
} from "./positions.js";
import { breakdownRows, closeEvent, legacyExit, realized, realizedPortion, realizedSummary, remainingQty, settleEvent } from "./realized.js";

const FILL = 1791035700; // 3 Oct 2026 13:55 UTC
const SELL = FILL + 86400;
const S9 = 1791532800;

/** A complete Higher 83-89k package: 0.04 contracts, premium $90 + $2 fees, Derive's mark at entry $88. */
const base = (over = {}) => ({
  key: "k", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04, paid: 92,
  settle_ts: S9, exec: "hand_both", network: "mainnet", exits: [],
  legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"],
  journal: {
    schema: 1, package: { expiry: "20261009" },
    fill: { ts: FILL, legs: [{ name: "BTC-20261009-83000-C", qty: 0.04, signed_qty: 0.04 }, { name: "BTC-20261009-89000-C", qty: 0.04, signed_qty: -0.04 }] },
    cost: { premium: 90, fees: 2, fees_basis: "entered", total: 92 },
    mark: { value: 88, ts: FILL - 600 },
  },
  ...over,
});

const sum = (rows) => Math.round(rows.reduce((a, [, v]) => a + v, 0) * 100) / 100;

describe("J2: realized P/L and its parts", () => {
  it("an early close reconciles: X - E - F equals value change - entry cost - exit cost - fees", () => {
    const e = closeEvent({ qty: 0.04, ts: SELL, savedTs: SELL + 60, gross: 120, fees: 2.5, feesKnown: true, mark: { value: 123, ts: SELL - 300 } });
    const x = realizedPortion(base(), e);
    expect(x.net).toBeCloseTo(120 - 90 - 4.5, 9);
    expect(x.parts.value_change).toBeCloseTo(123 - 88, 9);
    expect(x.parts.entry_vs_mark).toBeCloseTo(2, 9);
    expect(x.parts.exit_vs_mark).toBeCloseTo(3, 9);
    expect(x.parts.fees).toBeCloseTo(4.5, 9);
    const p = x.parts;
    expect(p.value_change - p.entry_vs_mark - p.exit_vs_mark - p.fees).toBeCloseTo(x.net, 9);
    const rows = breakdownRows(x);
    expect(rows.map(([k]) => k)).toEqual(["value_change", "entry_vs_mark", "exit_vs_mark", "fees"]);
    expect(sum(rows)).toBe(25.5);
    expect(x.basis).toMatchObject({ premium: "entered", entry_fees: "entered", exit: "entered", exit_fees: "entered" });
  });

  it("favorable fills make the cost parts add to the result, and a loss reconciles too", () => {
    const fav = realizedPortion(base({ journal: { ...base().journal, mark: { value: 93, ts: FILL } } }),
      closeEvent({ qty: 0.04, ts: SELL, savedTs: SELL, gross: 70, fees: 1, feesKnown: true, mark: { value: 68, ts: SELL } }));
    expect(fav.parts.entry_vs_mark).toBeCloseTo(-3, 9); // paid below the mark
    expect(fav.parts.exit_vs_mark).toBeCloseTo(-2, 9); // sold above the mark
    expect(fav.net).toBeCloseTo(70 - 90 - 3, 9);
    expect(sum(breakdownRows(fav))).toBe(-23);
  });

  it("adds a rounding line when the rounded parts do not add up to the rounded net", () => {
    const x = realizedPortion(base({ journal: { ...base().journal, cost: { premium: 90.004, fees: 2.004, fees_basis: "entered", total: 92.008 }, mark: { value: 88.004, ts: FILL } } }),
      closeEvent({ qty: 0.04, ts: SELL, savedTs: SELL, gross: 120.004, fees: 2.504, feesKnown: true, mark: { value: 123.004, ts: SELL } }));
    const rows = breakdownRows(x);
    expect(sum(rows)).toBeCloseTo(Math.round(x.net * 100) / 100, 9);
  });

  it("settlement replaces the exit with the payout and drops exit cost; no settlement fee", () => {
    const payout = 0.04 * 3000; // 86,000 is half-way through the zone
    const x = realizedPortion(base(), settleEvent({ qty: 0.04, settleTs: S9, savedTs: S9 + 60, settlePrice: 86000, payout }));
    expect(x.net).toBeCloseTo(120 - 92, 9);
    expect(x.parts).toMatchObject({ exit_vs_mark: null });
    expect(x.parts.value_change).toBeCloseTo(120 - 88, 9);
    expect(breakdownRows(x).map(([k]) => k)).toEqual(["value_change", "entry_vs_mark", "fees"]);
    expect(x.basis.exit).toBe("exact");
    expect(x.exit.fees).toBe(0);
  });

  it("missing or distant marks keep the known net and list what is missing instead of a split", () => {
    const far = realizedPortion(base({ journal: { ...base().journal, mark: { value: 88, ts: FILL + 3600 } } }),
      closeEvent({ qty: 0.04, ts: null, savedTs: SELL, gross: 120, fees: 2.5, feesKnown: false, mark: { value: 123, ts: SELL } }));
    expect(far.net).toBeCloseTo(25.5, 9);
    expect(far.parts).toBeNull();
    expect(far.missing).toEqual(["entry_mark_far", "exit_mark_far"]);
    expect(far.estimated).toBe(true);
    const none = realizedPortion(base({ journal: { ...base().journal, mark: null } }),
      closeEvent({ qty: 0.04, ts: SELL, savedTs: SELL, gross: 120, fees: 2.5, feesKnown: true }));
    expect(none.missing).toEqual(["entry_mark", "exit_mark"]);
  });

  it("never counts a fee twice: the entry total is premium plus fees as recorded", () => {
    const x = realizedPortion(base(), closeEvent({ qty: 0.04, ts: SELL, savedTs: SELL, gross: 92, fees: 0, feesKnown: true }));
    expect(x.entry.total).toBeCloseTo(92, 9);
    expect(x.net).toBeCloseTo(0, 9);
  });

  it("a legacy credit package reconciles with signed amounts", () => {
    const credit = base({ journal: { ...base().journal, cost: { premium: -30, fees: 1, fees_basis: "entered", total: -29 }, mark: { value: -31, ts: FILL } } });
    const x = realizedPortion(credit, closeEvent({ qty: 0.04, ts: SELL, savedTs: SELL, gross: -10, fees: 1, feesKnown: true, mark: { value: -9, ts: SELL } }));
    expect(x.net).toBeCloseTo(-10 + 30 - 2, 9);
    expect(sum(breakdownRows(x))).toBe(18);
  });

  it("a partial fill settles on the option that filled, without the package's mark", () => {
    const half = base({ exec: "hand_partial", journal: { ...base().journal,
      fill: { ts: FILL, legs: [{ name: "BTC-20261009-83000-C", qty: 0.04, signed_qty: 0.04 }, { name: "BTC-20261009-89000-C", qty: 0, signed_qty: 0 }] } } });
    _resetMemory();
    localStorage.clear();
    addPosition(half, FILL * 1000);
    const [p] = loadPositions();
    const [s] = settlePosition(p.key, 90000, S9 + 60);
    expect(s.exits[0].gross).toBeCloseTo(0.04 * 7000, 9); // the lone call pays past 89,000
    const x = realized(s).portions[0];
    expect(x.missing).toContain("mark_partial");
    expect(x.net).toBeCloseTo(280 - 92, 9);
  });
});

describe("J2: partial closes, the summary and the store", () => {
  beforeEach(() => { _resetMemory(); localStorage.clear(); });

  it("a partial close leaves the rest open; settlement realizes the rest; the summary counts both", () => {
    addPosition(base(), FILL * 1000);
    const key = loadPositions()[0].key;
    let [p] = closePosition(key, closeEvent({ qty: 0.01, ts: SELL, savedTs: SELL, gross: 30, fees: 1, feesKnown: true, mark: { value: 30.5, ts: SELL } }), SELL);
    expect(p.closed_at).toBeUndefined();
    expect(remainingQty(p)).toBeCloseTo(0.03, 9);
    expect(openPart(p)).toMatchObject({ contracts: 0.03, paid: 92 * 0.75 });
    let r = realized(p);
    expect(r.portions[0].net).toBeCloseTo(30 - 1 - 23, 9); // a quarter of the $92 entry
    expect(r.portions[0].parts.value_change).toBeCloseTo(30.5 - 22, 9);
    [p] = settlePosition(key, 86000, S9 + 60);
    expect(p.exits[1]).toMatchObject({ kind: "settle", settle_price: 86000, fees: 0 });
    expect(p.exits[1].qty).toBeCloseTo(0.03, 9);
    expect(p.exits[1].gross).toBeCloseTo(0.03 * 3000, 9);
    settlePosition(key, 86000, S9 + 120); // recorded once
    r = realized(loadPositions()[0]);
    expect(r.portions).toHaveLength(2);
    expect(r.net).toBeCloseTo(6 + (90 - 69), 9);
    const sumUp = realizedSummary(loadPositions());
    expect(sumUp).toMatchObject({ count: 2, closes: 1, settles: 1, unknown: 0, wins: 2, losses: 0 });
    expect(sumUp.total).toBeCloseTo(27, 9);
  });

  it("closing every contract closes the position with the sum of what came back", () => {
    addPosition(base(), FILL * 1000);
    const key = loadPositions()[0].key;
    const [p] = closePosition(key, closeEvent({ qty: 0.04, ts: SELL, savedTs: SELL, gross: 100, fees: 2, feesKnown: true }), SELL);
    expect(p).toMatchObject({ closed_at: SELL, proceeds: 98 });
    expect(realized(p).net).toBeCloseTo(6, 9);
  });

  it("migrates version 2 records: a sell-back saved with only its amount after fees becomes one exit", () => {
    const v2 = { ...base(), exits: undefined, closed_at: SELL, proceeds: 100 };
    delete v2.exits;
    const m = migrateRecord(v2);
    expect(m.exits).toEqual([legacyExit(v2)]);
    const x = realized(m).portions[0];
    expect(x.net).toBeCloseTo(8, 9);
    expect(x.parts).toBeNull();
    expect(x.missing).toContain("exit_split");
    // A record from before the journal: one amount paid, fees inside.
    const old = { key: "o", id: base().id, side: "no", lo: 83000, hi: 89000, contracts: 0.01, paid: 50, closed_at: SELL, proceeds: 45 };
    const y = realized(migrateRecord(old)).portions[0];
    expect(y.net).toBeCloseTo(-5, 9);
    expect(y.missing[0]).toBe("split");
    expect(realizedSummary([migrateRecord(old)])).toMatchObject({ count: 1, losses: 1 });
  });

  it("imports version 2 files (migrated) and its own version 3 exports, once", () => {
    const v2 = { ...base(), key: "two", closed_at: SELL, proceeds: 100 };
    delete v2.exits;
    importPositions(JSON.stringify({ kind: "cowboy-journal", version: 2, networks: { mainnet: [v2], testnet: [] } }));
    expect(loadPositions()[0].exits).toHaveLength(1);
    addPosition(base(), FILL * 1000);
    const key = loadPositions()[1].key;
    closePosition(key, closeEvent({ qty: 0.01, ts: SELL, savedTs: SELL, gross: 30, fees: 1, feesKnown: true }), SELL);
    const file = exportPositions();
    expect(JSON.parse(file).version).toBe(3);
    // An older copy with fewer exits never replaces the newer one.
    localStorage.clear(); _resetMemory();
    addPosition(base(), FILL * 1000);
    const older = loadPositions();
    importPositions(file);
    importPositions(file);
    const list = loadPositions();
    expect(list.filter((p) => p.key === key)).toHaveLength(1);
    expect(list.find((p) => p.key === key).exits).toHaveLength(1);
    expect(older).toHaveLength(1);
    expect(() => importPositions(JSON.stringify({ kind: "cowboy-journal", version: 4, networks: {} }))).toThrow("newer");
  });
});
