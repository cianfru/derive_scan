import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  change,
  selectRows,
  signalLabel,
  csv,
  validateSignals,
  validateSurface,
  price,
  percent,
} from "./data.js";
const data = JSON.parse(
  readFileSync(new URL("./data/signals.json", import.meta.url)),
);
const rows = data.timeframes["4h"].rows;
test("24h returns use six 4h bars or one daily bar, never the full sparkline", () => {
  const row = {
    price: 120,
    sparkline: [50, 100, 102, 104, 106, 108, 110, 120],
  };
  assert.ok(Math.abs(change(row, "4h") - 20) < 1e-8);
  assert.ok(Math.abs(change(row, "1d") - 9.0909090909) < 1e-8);
  assert.equal(change({ price: 12, sparkline: [0, 12] }, "1d"), null);
  assert.equal(change({ price: 12, sparkline: [] }, "4h"), null);
});
test("active signals exclude insufficient data and WAIT", () => {
  const selected = selectRows(rows, { filter: "active" });
  assert.ok(selected.length > 0);
  assert.ok(
    selected.every(
      (r) => r.signal !== "WAIT" && r.data_status !== "not enough data",
    ),
  );
  assert.equal(
    signalLabel({ signal: "STRONG_LONG", data_status: "not enough data" }),
    "Insufficient data",
  );
});
test("watchlist, query and numeric sorting compose without changing source rows", () => {
  const original = rows.map((r) => r.symbol);
  assert.deepEqual(
    selectRows(rows, {
      watchlist: ["BTC-PERP", "ETH-PERP"],
      filter: "watchlist",
      query: "eth",
    }).map((r) => r.symbol),
    ["ETH-PERP"],
  );
  assert.equal(selectRows(rows, { query: "not-a-market" }).length, 0);
  const sorted = selectRows(rows, { sort: "price", direction: -1 });
  assert.ok(sorted.every((r, i) => i === 0 || sorted[i - 1].price >= r.price));
  assert.deepEqual(
    rows.map((r) => r.symbol),
    original,
  );
});
test("CSV exports only selected data and includes history quality and timestamps", () => {
  const result = csv(selectRows(rows, { query: "BTC" }), "4h");
  assert.equal(result.split("\n").length, 2);
  assert.ok(
    result.includes("Data status") &&
      result.includes("Bar close UTC") &&
      result.includes("BTC-PERP"),
  );
  assert.ok(!result.includes("ETH-PERP"));
});
test("malformed remote snapshots are rejected so the last good data survives", () => {
  assert.equal(validateSignals(data), data);
  assert.throws(() => validateSignals({ generated_at: 1, timeframes: {} }));
  assert.throws(() => validateSurface({ ts: 123, features: {} }));
  assert.equal(price(null), "—");
  assert.equal(percent(undefined), "—");
});
