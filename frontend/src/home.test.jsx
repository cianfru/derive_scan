import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import btc from "./fixtures/questions/BTC.json";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path] ?? null, error: null }) }));
import Home, { CARDS } from "./pages/Home.jsx";
import { BANNED, PAUSED_SEC, signed } from "./lib/questions.js";
import { codename } from "./lib/walletName.js";
import { openPnl, pctText } from "./lib/homePnl.js";
import { _resetMemory, follow } from "./lib/follows.js";

const NOW = btc.prices_ts + 60;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW * 1000); });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); _resetMemory(); docs.current = {}; });
const show = () => render(
  <MemoryRouter initialEntries={["/home"]}>
    <Routes><Route path="/home" element={<Home />} /><Route path="*" element={<p>landed</p>} /></Routes>
  </MemoryRouter>,
);
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const text = (sel) => $(sel)?.textContent;

// markets.json: options markets with a current daily engine and wallet reading, one without a wallet
// reading (the radar's strip), a perp without options, and a published regime history that disagrees.
const align = (wallets, score) => ({ version: 2, wallet_coverage: { ready: true, status: "ready" }, readings: { "30d": {
  engine: { status: "ready", state: "up", signal: "WAIT", timeframe: "1d", observed_at: NOW - 3600 },
  wallets: wallets ? { status: "ready", state: wallets, score, gross_delta_usd: 1e6, gross_complete: true, estimated_positions: 0,
    missing_positions: 0, positions: 3, valuation_at: NOW - 60 } : { status: "insufficient_exposure" },
} } });
const coin = (und, regime, z, wallets, score, oi, options = true, observed = NOW - 3600) => ({ und, has_options: options, regime_1d: regime,
  z_1d: z, oi_usd: oi, engine_comparison: { "1d": { status: "ready", timeframe: "1d", observed_at: observed } }, align: align(wallets, score) });
const MARKETS = { bars: { "1d": NOW - 3600 }, breadth_1d: { cols: ["MARKUP", "BLOWOFF", "REACC", "ACCUM", "CAP", "MARKDOWN", "FLAT"], rows: [[NOW - 90000, 0, 0, 0, 0, 0, 9, 0], [NOW - 3600, 0, 0, 0, 0, 0, 9, 0]] },
  coins: [coin("BTC", "MARKUP", 0.8, "up", 0.3, 9e6), coin("ETH", "MARKUP", 0.5, "up", 0.4, 8e6), coin("HYPE", "REACC", -1.7, "up", 0.3, 7e6),
    coin("SOL", "MARKUP", 0.6, "defensive", -0.8, 6e6), coin("ADA", "MARKUP", 1.2, null, null, 1e4), coin("BNB", "MARKDOWN", 2.5, "up", 0.5, 5e6, false)] };
const addr = (c) => `0x${c.repeat(40)}`;
const trader = (c, rank, tier, cls, pnl) => ({ address: addr(c), rank, tier, class: cls, option_pnl: pnl });
const PNL = ["Money Printer", "Smart Money", "Grinder", "Humble Earner", "Exit Liquidity", "Semi-Rekt", "Full Rekt", "Giga-Rekt"];
const TRADERS = { traders: [trader("a", 1, "top", "directional", 10051791), trader("b", 2, null, "income", 3378616), trader("c", 3, null, "hedger", 2011179),
  trader("d", 4, "top", "directional", 929043), trader("e", 5, null, "occasional", 551806), trader("f", 7, "smart", "directional", -495024)],
  cohorts: { pnl: [3, 33, 132, 2353, 6750, 295, 34, 2].map((wallets, i) => ({ name: PNL[i], wallets })) } };
const FLOW = { generated_at: NOW, since: NOW - 86400, coverage: { ready: true, end: NOW }, classes_ready: true,
  by_coin: { BTC: { call: { buy_premium_usd: 300 }, put: { buy_premium_usd: 100 } }, ETH: { call: { buy_premium_usd: 120 }, put: { buy_premium_usd: 480 } } },
  large: [{ ts: (NOW - 3600) * 1000, kind: "option", instrument: "ETH-20261009-3050-P", direction: "buy", premium_usd: 37241 },
    { ts: (NOW - 7200) * 1000, kind: "option", instrument: "BTC-20261030-90000-C", direction: "sell", premium_usd: 5000 },
    { ts: (NOW - 1800) * 1000, kind: "perp", instrument: "BTC-PERP", direction: "buy", premium_usd: 0 }] };
const INDEX = { prices_ts: NOW - 120, coins: [{ und: "BTC", smart: 3 }, { und: "ETH", smart: 1 }] };
const ALL = { "questions/index.json": INDEX, "markets.json": MARKETS, "traders.json": TRADERS, "flow.json": FLOW };

describe("card home", () => {
  it("offers one card per part of Cowboy, each opening its page", () => {
    docs.current = ALL;
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Where do you want to ride?");
    const links = CARDS.map((c) => screen.getByRole("link", { name: new RegExp(`^${c.label}`) }).getAttribute("href"));
    expect(links).toEqual(["/saloon", "/saloon", "/radar", "/traders", "/markets", "/traders/posses", "/flow"]);
    // Screen readers hear each card's figure with its link; the chart bands stay out of it.
    const describe = (label) => document.getElementById(screen.getByRole("link", { name: new RegExp(`^${label}`) }).getAttribute("aria-describedby")).textContent;
    expect(describe("Radar")).toContain("HYPE");
    expect(describe("Radar")).toContain("Most stretched, below trend");
    expect(describe("Markets")).toMatch(/4 ?of ?5.*trending up/);
    expect($$(".hl-band[aria-hidden='true']").length).toBe(4);
  });

  it("Saloon: the open coins and the gold rings, or that prices are paused", () => {
    docs.current = { "questions/index.json": INDEX };
    show();
    expect($$(".home-coins .asset-icon")).toHaveLength(2);
    expect(text(".home-line .sr-only")).toBe("Prices on BTC, ETH");
    expect(text(".home-line-words")).toBe("4 gold rings");
    expect(text(".home-line-words .n")).toBe("4");
    cleanup();
    docs.current = { "questions/index.json": { ...INDEX, paused: true } };
    show();
    expect(text(".home-line")).toBe("Prices paused");
    // Prices older than the Saloon's own pause limit read paused too, as the Saloon page they open does.
    cleanup();
    docs.current = { "questions/index.json": { ...INDEX, prices_ts: NOW - PAUSED_SEC - 60 } };
    show();
    expect(text(".home-line")).toBe("Prices paused");
  });

  it("Saloon: six coin icons at most, then the count of the rest", () => {
    const coins = ["BTC", "ETH", "SOL", "XRP", "HYPE", "XAUT", "ZEC", "ADA"].map((und) => ({ und, smart: 1 }));
    docs.current = { "questions/index.json": { ...INDEX, coins } };
    show();
    expect($$(".home-coins > span")).toHaveLength(6);
    expect(text(".home-more")).toBe("+2");
    expect(text(".home-line .sr-only")).toBe(`Prices on ${coins.map((c) => c.und).join(", ")}`);
    expect(text(".home-line-words")).toBe("8 gold rings");
  });

  it("Radar: the radar page in miniature, the most stretched coin named, long above and short below", () => {
    docs.current = { "markets.json": MARKETS };
    show();
    expect(text(".hl-radar .hl-tick")).toBe("HYPE"); // the largest stretch either way, options markets only
    expect(text(".hl-radar .hl-cap")).toBe("Most stretched, below trend");
    expect($(".hl-radar .hl-pt.hl-lead").title).toBe("HYPE · below trend · Smart wallets long, 30 days");
    const pt = Object.fromEntries($$(".hl-radar .hl-plot .hl-pt").map((p) => [p.title.split(" ·")[0], { x: parseFloat(p.style.left), y: parseFloat(p.style.top) }]));
    expect(Object.keys(pt).sort()).toEqual(["BTC", "ETH", "HYPE", "SOL"]);
    const mid = parseFloat($(".hl-radar .hl-plot").style.height) / 2;
    expect(pt.ETH.y).toBeLessThan(mid); // Smart wallets long: above the line
    expect(pt.SOL.y).toBeGreaterThan(mid); // short: below it
    expect(pt.HYPE.x).toBeLessThan(pt.BTC.x); // below trend on the left
    expect(pt.ETH.x).toBeLessThan(pt.BTC.x);
    // ADA has no wallet reading: never inside the field (where it would read as short); this card is too
    // short for its lane, so it is counted under the field.
    expect(text(".hl-radar .hl-xw-mid")).toBe("1 without a wallet reading");
    expect($$(".hl-radar .hl-pt").some((p) => p.title.startsWith("ADA"))).toBe(false);
  });

  it("Radar: with every wallet reading lapsed, one stretch line and the reason; all near the trend, no hero", () => {
    const lapsed = (c) => ({ ...c, align: { ...c.align, readings: { "30d": { ...c.align.readings["30d"],
      wallets: { ...c.align.readings["30d"].wallets, valuation_at: NOW - 7200 } } } } });
    docs.current = { "markets.json": { ...MARKETS, coins: MARKETS.coins.map(lapsed) } };
    show();
    expect($(".hl-radar .hl-plot").classList.contains("flat")).toBe(true);
    expect($$(".hl-radar .hl-half")).toHaveLength(0);
    expect(text(".hl-radar .hl-cap")).toBe("Most stretched, below trendWallet readings updating");
    expect($$(".hl-radar .hl-pt").map((p) => p.title.split(" ·")[0]).sort()).toEqual(["ADA", "BTC", "ETH", "HYPE", "SOL"]);
    cleanup();
    docs.current = { "markets.json": { ...MARKETS, coins: MARKETS.coins.map((c) => ({ ...c, z_1d: c.z_1d / 20 })) } };
    show();
    expect(text(".hl-radar .hl-word")).toBe("All near their trend");
    expect($(".hl-radar .hl-lead")).toBeNull();
  });

  it("Markets: the options markets in the largest daily regime, not the all-perps history", () => {
    docs.current = { "markets.json": MARKETS };
    show();
    expect(text(".hl-markets .bn")).toBe("4");
    expect(text(".hl-markets .hl-of")).toBe("of 5");
    expect(text(".hl-markets .hl-cap")).toBe("trending upoptions markets · daily close");
    expect($$(".hl-markets .hl-grp").map((g) => [...g.querySelectorAll(".hl-ic")].map((i) => i.title.split(" ·")[0]))).toEqual([["BTC", "ETH", "SOL", "ADA"], ["HYPE"]]);
    // Each group named under its own rule, in its regime's colour.
    expect($$(".hl-markets .hl-grp-name").map((n) => n.textContent)).toEqual(["Trending up 4", "Cooling off 1"]);
    expect($$(".hl-markets .hl-grp").map((g) => g.style.getPropertyValue("--rc"))).toEqual(["var(--up)", "var(--regime-reacc)"]);
  });

  it("Markets: past three regimes the rest is Other, and an incomplete read says so", () => {
    docs.current = { "markets.json": { ...MARKETS, coins: [...MARKETS.coins, coin("XRP", "ACCUM", 0.1, null, null, 3e5), coin("ZEC", "CAP", -0.4, null, null, 2e5),
      coin("LIT", "REACC", -0.2, null, null, 1e5, true, NOW - 3 * 86400)] } };
    show();
    expect($$(".hl-markets .hl-grp-name").map((n) => n.textContent)).toEqual(["Trending up 4", "Cooling off 1", "Other 2"]);
    expect(text(".hl-markets .hl-cap")).toBe("trending up7 of 8 read on the daily close");
  });

  it("Smart traders: Smart-tier wallets only, with their real ranks", () => {
    docs.current = { "traders.json": TRADERS };
    show();
    expect(text(".hl-traders .bn")).toBe("+$10.05M");
    expect($(".hl-traders .bn").classList.contains("up")).toBe(true);
    expect($$(".hl-traders .hl-rank").map((r) => r.textContent)).toEqual(["#1", "#4", "#7"]);
    expect(text(".hl-traders .hl-who .hl-name")).toBe(codename(addr("a")));
    expect(document.body.textContent).not.toContain(codename(addr("b"))); // the income seller
    expect(document.body.textContent).not.toContain(codename(addr("c"))); // the hedger
    const last = $$(".hl-row").at(-1);
    expect(last.querySelector(".n:last-child").textContent).toBe("-$495K");
    expect(last.querySelector(".n:last-child").classList.contains("down")).toBe(true);
    expect(text(".hl-traders .hl-sub")).toBe("gross options P&L");
  });

  it("Smart traders: a wallet without a P&L or rank is skipped, a long codename keeps its full name in a title", () => {
    const rows = [{ ...TRADERS.traders[0], option_pnl: null }, { ...TRADERS.traders[3], rank: null }, ...TRADERS.traders.slice(4)];
    docs.current = { "traders.json": { ...TRADERS, traders: rows } };
    show();
    expect(text(".hl-traders .bn")).toBe("-$495K");
    expect($$(".hl-traders .hl-rank").map((r) => r.textContent)).toEqual(["#7"]);
    expect(document.body.textContent).not.toContain("+—");
    expect($(".hl-traders .hl-who .hl-name").title).toBe(codename(addr("f")));
  });

  it("Posses: the ladder from Legend to Boot Hill and the share in profit", () => {
    docs.current = { "traders.json": TRADERS };
    show();
    expect(text(".hl-posses .bn")).toBe("26%");
    expect($$(".hl-step > .n").map((n) => n.textContent)).toEqual(["3", "33", "132", "2.4K", "6.8K", "295", "34", "2"]);
    expect($$(".hl-step").map((s) => s.title)[0]).toBe("Legend: 3 traders");
    expect($$(".hl-ends span").map((s) => s.textContent)).toEqual(["Legend", "Boot Hill"]);
    expect($$(".hl-step.up")).toHaveLength(4);
    // Square-root heights: the largest posse full, the smallest still a visible step.
    const h = $$(".hl-bar i").map((i) => Number(i.style.getPropertyValue("--h")));
    expect(h[4]).toBe(1);
    expect(h[3]).toBeCloseTo(Math.sqrt(2353 / 6750), 3);
    expect(h[7]).toBeCloseTo(Math.sqrt(2 / 6750), 3);
  });

  it("Options flow: premium bought, the split, one dot per large option trade; none until classes are ready", () => {
    docs.current = { "flow.json": FLOW };
    show();
    expect(text(".hl-options .bn")).toBe("$1K");
    expect(text(".hl-options .hl-split-line")).toBe("42% calls · 58% puts");
    const dots = $$(".hl-strip .hl-dot");
    expect(dots).toHaveLength(2);
    expect(dots.at(-1).title).toBe("ETH 3,050 put · Oct 9 expiry · bought · $37.2K premium");
    expect(dots.at(-1).className).toBe("hl-dot put buy top");
    expect(dots[0].className).toBe("hl-dot call sell");
    // Calls above the line, puts below; the later trade further right.
    const line = parseFloat($(".hl-strip-line").style.top);
    expect(parseFloat(dots[0].style.top)).toBeLessThan(line);
    expect(parseFloat(dots[1].style.top)).toBeGreaterThan(line);
    expect(parseFloat(dots[1].style.left)).toBeGreaterThan(parseFloat(dots[0].style.left));
    expect(text(".hl-strip .hl-xw")).toBe("24h agonow");
    cleanup();
    docs.current = { "flow.json": { ...FLOW, classes_ready: false } };
    show();
    expect(text(".hl-options .bn")).toBe("$1K");
    expect($$(".hl-dot")).toHaveLength(0);
  });

  it("Options flow: an old file names its window instead of the last 24 hours to now", () => {
    const end = NOW - 3 * 3600;
    docs.current = { "flow.json": { ...FLOW, since: end - 86400, coverage: { ready: true, end } } };
    show();
    const at = (t) => { const d = new Date(t * 1000); return `${d.getUTCDate()} ${d.toUTCString().slice(8, 11)} ${d.toISOString().slice(11, 16)}`; };
    expect($$(".hl-options .hl-cap > span")[0].textContent).toBe(`option premium bought, 24h to ${at(end)} UTC`);
    expect(text(".hl-strip .hl-xw")).toBe(`${at(end - 86400)}${at(end)} UTC`);
    expect(document.body.textContent).not.toContain("now");
  });

  it("Your positions: the owner's words when nothing is open, leading to the Saloon", () => {
    show();
    expect(text(".hl-pos .hl-word")).toBe("No open positions");
    expect(text(".hl-pos .hl-cue")).toBe("Pick a side in the Saloon");
    expect($(".home-card .hl-pos .hl-go")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Your positions/ }).getAttribute("href")).toBe("/saloon");
    fireEvent.click(screen.getByRole("button", { name: "More about Your positions" }));
    expect(within($("dialog.home-pop")).getByRole("link", { name: "Enter the Saloon" }).getAttribute("href")).toBe("/saloon");
    // In the pop-out the words are plain text: the button below is the way in, not a look-alike link.
    expect(within($("dialog.home-pop")).getByText("Pick a side in the Saloon").classList.contains("hl-go")).toBe(false);
    fireEvent.click(screen.getAllByRole("article")[1]);
    expect(screen.getByText("landed")).toBeTruthy();
  });

  it("Your positions: the answers followed when nothing is open", () => {
    follow("BTC-20261009-A-83000-89000", "yes", { now: NOW });
    show();
    expect(text(".hl-pos .hl-word")).toBe("No open positions");
    expect(text(".hl-pos .hl-cue")).toBe("1 answer you follow");
    expect(screen.getByRole("link", { name: /^Your positions/ }).getAttribute("href")).toBe("/saloon/mine?tab=following");
  });

  it("Your positions: the P&L of what is open, as Positions values it", () => {
    const p = { key: "a", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
      legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both", settle_ts: 1791532800 };
    localStorage.setItem("cowboy-questions", JSON.stringify([p]));
    docs.current = { "questions/BTC.json": btc };
    show();
    const r = openPnl([p], { BTC: btc }, NOW);
    expect(r.priced).toBe(1);
    expect(text(".hl-pos .bn")).toBe(pctText(r.pct));
    expect($(".hl-pos .bn").classList.contains(r.pct >= 0 ? "up" : "down")).toBe(true);
    expect($$(".hl-pos .hl-cap > span")[0].textContent).toBe("P&L now");
    expect($$(".hl-pos .hl-cap > span")[1].textContent).toBe("1 open");
    // Each open position with its own P&L, green or red (owner: "I want to see the position that I have right now").
    const rows = $$(".hl-plist li");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".hl-pname").textContent).toBe("Higher 86k9 Oct");
    expect(rows[0].querySelector(".hl-pname + .n").textContent).toBe(pctText(r.rows[0].pct));
    expect(rows[0].querySelector(".hl-pname + .n").classList.contains(r.rows[0].pct >= 0 ? "up" : "down")).toBe(true);
    expect(screen.getByRole("link", { name: /^Your positions/ }).getAttribute("href")).toBe("/saloon/mine");
  });

  it("Your positions: lists every open position, largest first, and the card shows three", () => {
    const p = { key: "a", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
      legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both", settle_ts: 1791532800 };
    const list = [p, { ...p, key: "b", paid: 300 }, { ...p, key: "c", paid: 20, side: "no" }, { ...p, key: "d", paid: 50 }];
    localStorage.setItem("cowboy-questions", JSON.stringify(list));
    docs.current = { "questions/BTC.json": btc };
    show();
    const r = openPnl(list, { BTC: btc }, NOW);
    expect(r.rows.map((x) => x.key)).toEqual(["b", "a", "d", "c"]);
    const rows = $$(".home-card .hl-plist li");
    expect(rows.map((li) => li.textContent.slice(0, 6))).toEqual(["Higher", "Higher", "Higher", "+1 mor"]);
    expect(rows[3].textContent).toBe("+1 more");
  });

  it("Your positions: says Not valued yet and lists each with No price now while prices are paused", () => {
    const p = { key: "a", id: "BTC-20261009-A-83000-89000", und: "BTC", side: "yes", lo: 83000, hi: 89000, contracts: 0.04407, paid: 103.01,
      legs: ["BTC-20261009-83000-C", "BTC-20261009-89000-C"], exec: "hand_both", settle_ts: 1791532800 };
    localStorage.setItem("cowboy-questions", JSON.stringify([p, { ...p, key: "b" }]));
    docs.current = { "questions/BTC.json": { ...btc, paused: true } };
    show();
    expect(text(".hl-pos .hl-word")).toBe("Not valued yet");
    expect(text(".hl-pos .hl-cap")).toContain("2 open");
    expect($$(".hl-plist .hl-pnone").map((n) => n.textContent)).toEqual(["No price now", "No price now"]);
    expect(screen.getByRole("button", { name: "Why there is no value now" })).toBeTruthy();
  });

  it("Saloon: the Saloon's own chart from its files, not a picture", () => {
    const bars = Array.from({ length: 40 }, (_, i) => [NOW - (40 - i) * 14400, btc.index, btc.index * 1.01, btc.index * 0.99, btc.index * (1 + Math.sin(i) / 100), 1]);
    docs.current = { "questions/index.json": { prices_ts: btc.prices_ts, coins: [{ und: "BTC", smart: 2 }] }, "questions/BTC.json": btc,
      "coins/BTC.json": { candles: { "4h": bars } } };
    show();
    const chart = $(".home-saloon .hl-saloon svg[role='img']");
    expect(chart).toBeTruthy();
    expect($(".home-saloon img[src*='/home/saloon']")).toBeNull();
    expect(chart.querySelector(".sb-price").getAttribute("d")).toMatch(/^M/);
    const figs = $$(".home-saloon .sb-fig").map((n) => n.textContent);
    expect(figs.length).toBeGreaterThan(0);
    for (const f of figs) expect(f).toMatch(/^\+[\d,.]+%$/);
    // Every bubble's figure is in the chart's own words for screen readers, with its side and level.
    for (const f of figs) expect(chart.getAttribute("aria-label")).toContain(`up to ${f}`);
    expect(chart.getAttribute("aria-label")).toMatch(/^BTC over the last three days, now \$/);
  });

  it("keeps every card's title or says Not available yet when its file is missing or empty", () => {
    const check = () => {
      for (const c of CARDS.filter((x) => !["saloon", "positions"].includes(x.id))) {
        const card = $(`.home-${c.id}`);
        expect(card.querySelector(".hl-title")?.textContent, c.id).toBe(c.title);
        expect(card.querySelector(".hl-cue")?.textContent, c.id).toContain("Not available yet");
      }
    };
    show();
    check();
    cleanup();
    docs.current = { "markets.json": { coins: [] }, "traders.json": { traders: [], cohorts: { pnl: [] } }, "flow.json": { by_coin: {}, large: [] },
      "questions/index.json": { prices_ts: NOW, coins: [] } };
    show();
    check();
    expect($(".home-line")).toBeNull();
  });

  it("opens a card large with the +, the same widget beside the text, and a click on the card goes to its page", () => {
    docs.current = ALL;
    show();
    fireEvent.click(screen.getByRole("button", { name: "More about Smart traders" }));
    const pop = $("dialog.home-pop");
    expect(pop.hasAttribute("open")).toBe(true);
    expect(within(pop).getByRole("link", { name: "Open the leaderboard" }).getAttribute("href")).toBe("/traders");
    // In the pop-out each Smart wallet opens its trader page.
    expect(within(pop).getByRole("link", { name: new RegExp(codename(addr("d"))) }).getAttribute("href")).toBe(`/trader/${addr("d")}`);
    fireEvent.click(within(pop).getByRole("button", { name: "Close" }));
    expect(pop.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "More about Markets" }));
    expect(within(pop).getByText("All perps, last 90 daily closes")).toBeTruthy();
    fireEvent.click(within(pop).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getAllByRole("article")[4]);
    expect(screen.getByText("landed")).toBeTruthy();
  });

  it("uses no forecast words on the cards or in any pop-out, and keeps the positioning rule", () => {
    docs.current = ALL;
    show();
    expect(document.body.textContent).not.toMatch(BANNED);
    for (const c of CARDS) {
      fireEvent.click(screen.getByRole("button", { name: `More about ${c.label}` }));
      const t = $("dialog.home-pop").textContent;
      expect(t).not.toMatch(BANNED);
      if (["saloon", "radar", "traders", "posses"].includes(c.id)) expect(t).toContain("Context, not a signal.");
      fireEvent.click(within($("dialog.home-pop")).getByRole("button", { name: "Close" }));
    }
  });

  it("lets the cards rise in once per tab", () => {
    show();
    expect($(".home").hasAttribute("data-enter")).toBe(true);
    cleanup();
    show();
    expect($(".home").hasAttribute("data-enter")).toBe(false);
  });
});
