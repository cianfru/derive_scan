// The Saloon's Rysk view: Rysk's levels as bubbles on the coin's chart (sell above the price, buy below),
// each with about what Rysk's smallest size pays now; a bubble opens the panel with the picture of the
// settlement and the ticket held on that level. Rysk is a fake socket with replies saved 10 October 2026.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import assets from "./fixtures/rysk/assets.json";
import inventory from "./fixtures/rysk/inventory.json";
import caps from "./fixtures/rysk/caps.json";
import RyskView from "./components/rysk/RyskView.jsx";
import { ryskBubbles } from "./components/rysk/RyskChart.jsx";
import { premiumEstimate, ryskMarket } from "./lib/rysk/market.js";
import { BANNED } from "./lib/questions.js";

const NET = {
  name: "mainnet", real: true, chainId: 999, chainName: "HyperEVM", apiUrl: "https://rysk.test", rpc: "https://rpc.test/evm", explorer: "https://explorer.test",
  rysk: "0x8c8bcb6d2c0e31c5789253ecc8431ca6209b4e35", marginPool: "0x24a44f1dc25540c62c1196FfC297dFC951C91aB4", usdc: "0xb88339cb7199b77e23db6e890353e22632ba630f",
};
const fake = () => ({
  on: () => () => {}, send: async () => {}, close() {},
  call: async (m) => ({ assets, inventory, caps, positions: [] })[m],
});
const NOW = 1791651704; // 10 October 2026, 17:01:44 UTC: when the live quote was taken
const candles = Array.from({ length: 72 }, (_, i) => { const t = NOW - (72 - i) * 14400, c = 2500 + Math.sin(i / 5) * 40; return [t, c - 5, c + 12, c - 14, c, 1]; });

afterEach(cleanup);

describe("Rysk on the Saloon chart", () => {
  it("prices the bubble from Rysk's listed rate as the firm quote did", () => {
    const eth = ryskMarket("ETH", { assets, inventory, caps }, NET);
    const l = eth.dates[0].call.find((x) => x.strike === 2550);
    // Listed 65.3% on the saved listing; the live quote at 67.9% paid $13.07 for 0.5 ETH.
    expect(premiumEstimate({ ...l, apr: 67.85 }, eth, NOW)).toBeCloseTo(13.07, 0);
  });

  it("puts sales above the price and purchases below, nearest first, none overlapping", () => {
    const eth = ryskMarket("ETH", { assets, inventory, caps }, NET);
    const y = (p) => 1000 - p / 5;
    const [d] = ryskBubbles(eth.dates, { price: 2509, y, R: 26, lo: 2000, hi: 3000, nowSec: NOW, market: eth });
    expect(d.marks.filter((l) => !l.isPut).every((l) => l.strike >= 2509)).toBe(true);
    expect(d.marks.filter((l) => l.isPut).every((l) => l.strike < 2509)).toBe(true);
    const full = d.marks.filter((l) => !l.dot);
    for (const a of full) for (const b of full) if (a !== b) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
  });

  it("opens the panel on a bubble with the picture of both outcomes", async () => {
    const user = userEvent.setup();
    render(<RyskView und="ETH" candles={candles} price={2509} nowSec={NOW} net={NET} socketFactory={fake} provider={null} />);
    const bubble = await screen.findByRole("button", { name: /^Sell ETH at \$2,600 on Fri,? 16 Oct: about \$\d/ });
    expect(screen.getByText(/lock ETH, get paid now/)).toBeTruthy();
    await user.click(bubble);
    const panel = await screen.findByLabelText("Your Rysk trade");
    expect(within(panel).getByRole("heading", { name: "Sell ETH at $2,600" })).toBeTruthy();
    expect(within(panel).getByText("You keep 0.5 ETH")).toBeTruthy();
    expect(within(panel).getByText("You sell 0.5 ETH")).toBeTruthy();
    expect(within(panel).queryByRole("tab", { name: /at a level/ })).toBeNull(); // held on the bubble's level
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("names the coins Rysk lists when this one is not among them", async () => {
    render(<RyskView und="XRP" candles={candles} price={1.4} nowSec={NOW} net={NET} socketFactory={fake} provider={null} />);
    expect(await screen.findByText("Rysk lists no XRP options on HyperEVM.")).toBeTruthy();
    expect(screen.getByText("Rysk lists ETH, HYPE, BTC.")).toBeTruthy();
  });
});
