import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// One glyph for a missing value across the app: the em dash (lib/format.js DASH, ui.jsx Empty).
const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path] ?? null, error: null }) }));
vi.mock("./lib/useElementWidth.js", () => ({ useElementWidth: () => [null, 640] }));
import LeanBar from "./components/LeanBar.jsx";
import CohortExplorer, { ExposureBar } from "./components/CohortExplorer.jsx";
import { PricedRange } from "./components/OptionsViz.jsx";
import Flow from "./pages/Flow.jsx";
import Traders from "./pages/Traders.jsx";
import { DASH } from "./lib/format.js";

afterEach(cleanup);

const DASHLIKE = /^[\s\-‐-―−]+$/;
/** Every text node that is only dash-like glyphs must be exactly one em dash. */
function missingGlyphs(root) {
  const bad = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.textContent;
    if (t.trim() && DASHLIKE.test(t) && t.trim() !== DASH) bad.push(JSON.stringify(t));
  }
  return bad;
}

const now = Math.floor(Date.now() / 1000);
const wallet = "0x1111111111111111111111111111111111111111";

describe("missing values", () => {
  it("DASH is the em dash", () => expect(DASH).toBe("—"));

  it("components render an em dash when their value is missing", () => {
    const { container } = render(<MemoryRouter>
      <LeanBar lean={null} />
      <ExposureBar lean={{ score: null }} />
      <PricedRange index={null} iv30={null} />
      <CohortExplorer through="2026-10-02" valuedAt={now} cohorts={{ pnl: [{ name: "Grinder", wallets: 3, windows: { all: {
        coins: { BTC: { positions: 2, score: null, net_delta_usd: null, gross_delta_usd: null } } } } }], size: [] }} />
    </MemoryRouter>);
    expect(container.querySelectorAll(".empty-dash").length).toBeGreaterThanOrEqual(5);
    expect(missingGlyphs(container)).toEqual([]);
  });

  it("Flow and Traders use the em dash for a missing type, premium and book", () => {
    docs.current = {
      "flow.json": {
        coverage: null, by_coin: {},
        large: [{ ts: now * 1000, kind: "perp", underlying: "BTC", instrument: "BTC-PERP", direction: "buy", notional_usd: 30000, wallet, class: null }],
        wallets: [{ wallet, class: null, perp_notional_usd: 30000, option_notional_usd: 0, premium_bought_usd: 0, premium_sold_usd: 0, realized_pnl_usd: 0 }],
      },
      "traders.json": {
        ready: true, status: "ready", through: "2026-10-02", generated_at: now, ranked_total: 1, cohorts: { pnl: [], size: [] },
        traders: [{ address: wallet, rank: 1, class: "directional", option_pnl: 1000, win_rate: null, premium_traded: 5000, last: "2026-10-02", lean: null }],
      },
    };
    const flow = render(<MemoryRouter><Flow /></MemoryRouter>);
    expect(flow.container.textContent).toContain(DASH);
    expect(missingGlyphs(flow.container)).toEqual([]);
    cleanup();
    const traders = render(<MemoryRouter><Traders /></MemoryRouter>);
    expect(traders.container.textContent).toContain(DASH);
    expect(missingGlyphs(traders.container)).toEqual([]);
  });

  it("no source file writes another dash glyph as a missing value", () => {
    const files = import.meta.glob(["./**/*.jsx", "./**/*.js", "!./**/*.test.*"], { query: "?raw", import: "default", eager: true });
    const hits = [];
    for (const [path, src] of Object.entries(files)) {
      src.split("\n").forEach((line, i) => {
        // a JSX text child, or a string literal, that is only a hyphen, en dash or other non-em dash
        if (/>\s*[-‐-–―]\s*</.test(line) || /(["'`])[‐-–―]\1/.test(line)) hits.push(`${path}:${i + 1}`);
      });
    }
    expect(Object.keys(files).length).toBeGreaterThan(30);
    expect(hits).toEqual([]);
  });
});
