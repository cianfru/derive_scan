import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as regime from "./lib/regime.js";
import { SIGNAL_HELP, REGIME_HELP } from "./lib/explain.js";
import { RegimeHeader, Readings, Checks, ribbonView } from "./components/RegimePanel.jsx";
import { stackTags } from "./components/CandleChart.jsx";

afterEach(cleanup);

const NAMES = ["bullish_regime", "consensus", "z_range", "no_bear_div", "heat_ok", "no_climax", "funding_ok", "not_greedy", "liquidity_ok"];
const STATUS = { p: "pass", f: "fail", u: "unknown" };
// Rows as published in coins/{UND}.json latest["1d"] on 3 Oct 2026 (fields the panel reads).
function fixture(fields, statuses) {
  const conditions_detail = NAMES.map((name, i) => {
    const status = STATUS[statuses[i]];
    return { name, label: name, desc: name === "heat_ok" ? "< 85" : "Uptrend or Accumulation", status, met: status === "pass", available: status !== "unknown" };
  });
  return { conditions_total: 9, signal_status: "ready", data_status: "ready", is_climax: false, entry_blocked: false, volume_status: "ok", history_bars: 599,
    positioning: { funding_rate: 1.25e-05 }, conditions_detail, ...fields };
}
const BTC = fixture({ underlying: "BTC", signal: "LIGHT_LONG", regime: "MARKUP", zscore: 1.317, heat: 23, heat_direction: 1, heat_phase: "Extension", deviation_pct: 17.37, bmsb_mid: 71997.7, conditions_met: 9 }, "ppppppppp");
const HYPE = fixture({ underlying: "HYPE", signal: "ACCUMULATE", regime: "REACC", zscore: -1.363, heat: 28, heat_direction: 1, deviation_pct: 30.52, bmsb_mid: 68.24, conditions_met: 7 }, "fpfpppppp");
const XAUT = fixture({ underlying: "XAUT", signal: "WAIT", regime: "MARKUP", zscore: 1.069, heat: 9, heat_direction: -1, deviation_pct: -4.14, bmsb_mid: 4321.26, conditions_met: 8, entry_blocked: true, volume_status: "thin" }, "pppppuppp");
const BNB = fixture({ underlying: "BNB", signal: "WAIT", regime: "MARKUP", zscore: 1.2, heat: 20, heat_direction: 1, deviation_pct: 16.57, bmsb_mid: 658.847, conditions_met: 8, entry_blocked: true, volume_status: "thin" }, "pppppuppp");
const CC = fixture({ underlying: "CC", signal: "WAIT", regime: "MARKUP", zscore: 0.148, heat: 6, heat_direction: -1, deviation_pct: -7.31, bmsb_mid: 0.1293, conditions_met: 4, entry_blocked: true,
  volume_status: "thin", data_status: "warming up", signal_status: "unavailable", history_bars: 233 }, "upuuuuppp");
const CTX = { consensus: { "1d": { consensus: "RISK-ON", status: "ready" } }, btc_regime: { "1d": "MARKUP", "4h": "REACC" }, fear_greed: 67, stablecoin_7d_pct: -0.37 };

describe("checks", () => {
  it("returns the nine checks in the engine's order with the app's names and values", () => {
    const list = regime.checks(BTC, CTX);
    expect(list.map((c) => c.name)).toEqual(NAMES);
    expect(list.map((c) => c.label)).toEqual(["Regime", "Market", "Z-score", "BTC", "Heat", "Climax", "Funding", "Fear & Greed", "Stablecoins"]);
    expect(list.map((c) => c.value)).toEqual(["Markup", "Risk-on", "+1.32", "—", "23", "None", "+11.0%", "67", "−0.37% 7d"]);
    expect(list.every((c) => c.status === "pass" && c.rule)).toBe(true);
    expect(regime.checks(XAUT, CTX)[5]).toMatchObject({ value: "Thin volume", status: "unknown" });
    expect(regime.checks(HYPE, CTX)[3].value).toBe("Markup");
  });
  it("never shows the engine's own check text", () => {
    for (const row of [BTC, HYPE, XAUT, BNB, CC]) {
      const text = JSON.stringify(regime.checks(row, CTX));
      expect(text).not.toMatch(/Uptrend/);
    }
  });
  it("hides values that wait on price history while warming up", () => {
    const list = regime.checks(CC, CTX);
    expect(list[0].value).toBe("—");
    expect(list[2].value).toBe("—");
  });
});

describe("whyLine", () => {
  const why = (row) => regime.whyLine(row, regime.checks(row, CTX));
  it("explains each coin's signal from published fields", () => {
    expect(why(BTC)).toBe("Light, not Strong: z-score +1.32 is outside 0 to 1.");
    expect(why(HYPE)).toBe("Staged entry in a pullback: 7 of 9 checks, heat 28.");
    expect(why(XAUT)).toBe("4.1% below its weekly band: long entries are off.");
    expect(why(BNB)).toBe("Derive perp volume too thin for the climax check: entries held.");
    expect(why(CC)).toBe("Price history 233 of 499 bars: no signal yet.");
  });
});

describe("against", () => {
  it("lists failed checks in plain words", () => {
    const list = regime.checks(HYPE, CTX);
    expect(regime.against(HYPE, list, regime.bandGate(HYPE))).toEqual([
      "Regime is Re-accumulation: the check needs Markup or Accumulation",
      "Z-score −1.36: outside −0.5 to +2.5",
    ]);
    expect(regime.against(BTC, regime.checks(BTC, CTX), regime.bandGate(BTC))).toEqual([]);
  });
  it("collapses the history-gated unknowns into one line", () => {
    const notes = regime.against(CC, regime.checks(CC, CTX), regime.bandGate(CC));
    expect(notes).toEqual([
      "Price history 233 of 499 bars: regime, z-score, BTC, heat and climax checks wait for it",
      "Price 7.3% below its weekly band: long entries are off",
    ]);
  });
});

describe("lastRun", () => {
  it("skips missing days without breaking or extending the run", () => {
    expect(regime.lastRun(["A", "B", "B", null, "B"])).toEqual(["B", 3, 1]);
    expect(regime.lastRun(["A", "A", null])).toEqual(["A", 2, 0]);
    expect(regime.lastRun([null, null])).toEqual([null, 0, -1]);
    expect(regime.lastRun([])).toEqual([null, 0, -1]);
  });
});

describe("copy", () => {
  const BANNED = /\b(will|expect|likely|predict|target|probability|odds|Larsson|Reflex|Uptrend|CTO)\b/i;
  const strings = (v, out = []) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
    return out;
  };
  it("no exported string uses forecast words or internal names", () => {
    const all = strings({ ...regime, SIGNAL_HELP, REGIME_HELP });
    for (const row of [BTC, HYPE, XAUT, BNB, CC]) {
      const list = regime.checks(row, CTX);
      all.push(...strings(list), regime.whyLine(row, list), ...regime.against(row, list, regime.bandGate(row)));
    }
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) expect(s, s).not.toMatch(BANNED);
  });
  it("help strings share the regime copy", () => {
    expect(REGIME_HELP.MARKUP).toBe(regime.REGIME_LINE.MARKUP);
    expect(SIGNAL_HELP.WAIT).toBe(`${regime.SIGNAL_LINE.WAIT} Signals describe the engine's rules at this close.`);
    expect(regime.REGIME_COLORS.BLOWOFF).toBe("var(--regime-blowoff)");
  });
});

// A daily history ending at the 3 Oct 00:00 close: Markup since 13 Jul, earlier days Re-accumulation.
const END = Date.UTC(2026, 9, 3) / 1000;
const history = { engine: { "1d": Array.from({ length: 120 }, (_, i) => {
  const ts = END - (119 - i) * 86400;
  return { ts, regime: ts - 86400 >= Date.UTC(2026, 6, 13) / 1000 ? "MARKUP" : "REACC", zscore: 1 + i / 200, heat: 20 };
}) } };

describe("panel", () => {
  it("shows the regime run, the signal's reason and the 4H reading", () => {
    render(<RegimeHeader row={BTC} row4={{ regime: "REACC", signal: "WAIT", data_status: "ready" }} history={history} />);
    expect(screen.getByText("Markup")).toBeTruthy();
    expect(screen.getByText("Above its trend")).toBeTruthy();
    expect(screen.getByText("since 13 Jul · 82d")).toBeTruthy();
    expect(screen.getByText("Light, not Strong: z-score +1.32 is outside 0 to 1.")).toBeTruthy();
    expect(screen.getByText("Re-accumulation")).toBeTruthy();
    expect(document.querySelectorAll(".rh-regime .day-strip i")).toHaveLength(90);
    expect(document.querySelector(".rh-regime .day-strip i:last-child").title).toBe("2 Oct · Markup");
  });
  it("marks a reading that is no longer current", () => {
    render(<RegimeHeader row={{ ...BTC, signal_bar_close_time: END }} row4={null} history={history} current={false} status="ready" />);
    expect(screen.getByText("Stale reading")).toBeTruthy();
    expect(screen.getByText("Last reading at the 3 Oct 00:00 UTC close.")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
  it("keeps the header while warming up", () => {
    render(<RegimeHeader row={CC} row4={null} history={{ engine: { "1d": [] } }} />);
    expect(screen.getByText("Warming up")).toBeTruthy();
    expect(screen.getByText("233 of 499 bars")).toBeTruthy();
    expect(screen.getByText("No signal yet")).toBeTruthy();
  });
  it("lists the checks with an against column only when something does not pass", () => {
    render(<Checks row={HYPE} ctx={CTX} />);
    expect(screen.getByText("7/9")).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBe(11);
    expect(screen.getByText("Against it now")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Rule: / })).toHaveLength(9);
    cleanup();
    render(<Checks row={BTC} ctx={CTX} />);
    expect(screen.getByText("9/9")).toBeTruthy();
    expect(screen.queryByText("Against it now")).toBeNull();
  });
  it("reads the ribbon from the published trail only", () => {
    const candles = Array.from({ length: 100 }, (_, i) => [END - (100 - i) * 86400, 1, 1, 1, 1, 0]);
    const trail = "-".repeat(10) + "b".repeat(49) + "g".repeat(41);
    const view = ribbonView(trail, candles);
    expect(view).toMatchObject({ state: "gold", run: 41, open: false });
    expect(view.cells).toHaveLength(90);
    expect(view.cells.at(-1)).toEqual({ color: "var(--ribbon-gold)", title: "2 Oct · Gold" });
    render(<Readings row={BTC} history={history} ribbon={trail} candles={candles} />);
    expect(screen.getByText("Gold")).toBeTruthy();
    expect(screen.getByText("41d")).toBeTruthy();
    expect(screen.getByText("17.4% above band")).toBeTruthy();
    expect(screen.getByText("+1.32")).toBeTruthy();
  });
});

describe("chart tags", () => {
  it("keeps tags apart from each other and from the range-edge labels, hiding one with no room", () => {
    const placed = stackTags([{ text: "Max pain", y: 100 }, { text: "Call wall", y: 60 }, { text: "Put wall", y: 104 }], [90], 300);
    const byText = Object.fromEntries(placed.map((t) => [t.text, t.top]));
    expect(byText["Call wall"]).toBe(45);
    // Max pain cannot sit above its line (the edge label at 90) so it goes below it; Put wall has no room left.
    expect(byText["Max pain"]).toBe(102);
    expect(byText["Put wall"]).toBeNull();
    const tops = placed.filter((t) => t.top != null).map((t) => t.top);
    for (const a of tops) for (const b of tops) if (a !== b) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(16);
    for (const t of tops) expect(Math.abs(t + 7.5 - 90)).toBeGreaterThanOrEqual(18);
  });
});
