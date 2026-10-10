import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { coinLead, flowLead, marketsLead, optionsLead, radarLead, tradersLead } from "./lib/takeaway.js";
import { viewReading } from "./lib/presentation.js";
import { Lead } from "./components/ui.jsx";
import Chain from "./components/Chain.jsx";
import { BANNED } from "./lib/questions.js";

// Research leads say what the data shows now: no forecast words, and no claim that wallets or
// alignment lead price.
const NO_LEAD_CLAIM = /\b(lead|leads|leading|ahead of) (the )?(price|market|moves?)\b/i;
const check = (lead) => {
  expect(lead.text.length).toBeGreaterThan(20);
  for (const t of [lead.text, lead.note]) { expect(t).not.toMatch(BANNED); expect(t).not.toMatch(NO_LEAD_CLAIM); }
};

const NOW = 1791056000;
const engine = (regime, signal) => ({ engine_comparison: { "1d": { status: "ready", timeframe: "1d", observed_at: NOW - 3600 } }, regime_1d: regime, signal_1d: signal });
const align = (w, o) => ({ version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: { "30d": {
  engine: { status: "ready", state: "up", signal: "LIGHT_LONG", timeframe: "1d", observed_at: NOW - 3600 },
  wallets: w ? { status: "ready", state: w, valuation_at: NOW - 60 } : { status: "insufficient_exposure" },
  options: o ? { status: "ready", state: o, observed_at: NOW - 60 } : { status: "missing_quotes" },
} } });
const coins = [
  { und: "BTC", has_options: true, ...engine("MARKUP", "LIGHT_LONG"), align: align("up", "neutral"), options: { rr25_30d: -0.01, atm_iv_30d: 0.33, status: "ready", ts: NOW - 60 } },
  { und: "ETH", has_options: true, ...engine("MARKUP", "WAIT"), align: align("defensive", null), options: { rr25_30d: 0.02, atm_iv_30d: 0.45, status: "ready", ts: NOW - 60 } },
  { und: "HYPE", has_options: true, ...engine("REACC", "ACCUMULATE"), align: align(null, null), options: { rr25_30d: 0.03, atm_iv_30d: null, status: "stale", ts: NOW - 4000 } },
];

describe("research leads", () => {
  it("Markets: the regime most options markets are in, and the wallet coverage", () => {
    const l = marketsLead({ coins }, NOW);
    expect(l.text).toBe("2 of 3 options markets are trending up on the daily close; 1 is cooling off.");
    expect(l.note).toBe("1 of 3 have no current wallet reading; positioning is context until the options-traders study reports.");
    check(l);
  });
  it("Radar: Smart wallets' delta across markets with a reading", () => {
    const l = radarLead(coins, "30d", NOW);
    expect(l.text).toBe("Smart wallets hold long delta on 1, short delta on 1 of the 2 markets with a current reading.");
    check(l);
    expect(radarLead(coins.map((c) => ({ ...c, align: align(null, null) })), "30d", NOW).text).toMatch(/^No market has a current Smart-wallet reading/);
  });
  it("Options: the richer side of the skew, BTC's priced move, thin and stale quotes", () => {
    const l = optionsLead({ coins });
    expect(l.text).toBe("Calls cost more than puts at 30 days on 2 of 3 markets; BTC's 30-day options price a typical move of ±9.5%.");
    expect(l.note).toMatch(/^Readings are from the \d\d:\d\d UTC snapshot; 1 market has thin quotes; option prices show what the market pays now, not a view\.$/);
    check(l);
  });
  it("Traders and Flow", () => {
    const t = tradersLead({ ranked_total: 2404, traders: [{ tier: "top", option_pnl: 1.2e6 }, { tier: "smart", option_pnl: 5e5 }, { tier: null, option_pnl: 1e5 }] });
    expect(t.text).toBe("2 wallets of the 3 shown are in the Top and Smart tiers, out of 2,404 ranked; the leader is up $1.2M in gross options PnL.");
    expect(t.parts.filter((x) => typeof x !== "string")).toEqual([
      { v: "2", tone: "accent" }, { v: "3", tone: "accent" }, { v: "2,404", tone: "accent" }, { v: "$1.2M", tone: "up" }]);
    check(t);
    const f = flowLead({ coverage: { ready: false, fraction: 0.74 }, by_coin: {
      BTC: { call: { buy_premium_usd: 1000, sell_premium_usd: 500, buy_notional_usd: 9e5 }, put: { buy_premium_usd: 200, sell_premium_usd: 300 } },
      ETH: { call: { buy_premium_usd: 100, buy_notional_usd: 1e5 } } } });
    expect(f.text).toBe("Traders paid $1.3K for options in the last 24 hours: 85% on calls, which pay if the price rises, and 15% on puts, which pay if it falls.");
    expect(f.note).toBe("They sold $800 of options to collect premium. A trade shows who crossed the spread, not a wallet's whole position. The recorder covered 74% of that window.");
    check(f);
  });
  it("Coin: regime and signal, then the layers that have a reading", () => {
    const btc = { latest: { "1d": { regime: "MARKUP", signal: "LIGHT_LONG" } }, engine_comparison: coins[0].engine_comparison, options: {}, alignment: align("up", "neutral") };
    const l = coinLead("BTC", btc, NOW);
    expect(l.text).toBe("BTC is trending up on the daily close, and the daily signal reads Leaning up. Over 30 days, Smart wallets hold long delta and option prices are balanced.");
    check(l);
    const m = coinLead("HYPE", { ...btc, alignment: align(null, null) }, NOW);
    expect(m.note).toMatch(/^No current wallet or options reading for this close yet/);
    check(m);
    expect(coinLead("ADA", { latest: {} }, NOW).text).toBe("ADA has no current daily reading yet.");
  });
  it("renders the lead as two lines", () => {
    const { container } = render(<Lead lead={{ text: "One.", note: "Two." }} />);
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["One.", "Two."]);
  });
});

describe("pipeline states read as plain words", () => {
  it("never shows a raw pipeline label, and explains it in an (i) beside a trade", () => {
    const a = align(null, null);
    a.readings["30d"].options = { status: "stale", observed_at: NOW - 60 };
    a.readings["7d"] = { engine: a.readings["30d"].engine, wallets: { status: "future" }, options: { status: "missing_quotes" } };
    const labels = ["7d", "30d"].flatMap((h) => ["engine", "wallets", "options"].map((k) => viewReading(a, h, k, NOW)));
    for (const r of labels) expect(r.label).not.toMatch(/Missing quotes|Stale reading|Check timestamp|Insufficient data/);
    expect(viewReading(a, "7d", "options", NOW)).toMatchObject({ label: "Not available yet" });
    expect(viewReading(a, "7d", "wallets", NOW)).toMatchObject({ label: "Updating" });
    expect(viewReading(a, "7d", "options", NOW).why).toMatch(/quotes/);
    const { container } = render(<Chain alignment={a} horizon="7d" linked={false} compact />);
    expect(container.textContent).not.toMatch(/Missing quotes|Stale reading|Check timestamp/);
    expect(container.querySelectorAll("button.info").length).toBeGreaterThanOrEqual(2);
  });
});
