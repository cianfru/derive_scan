import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const docs = vi.hoisted(() => ({ current: {} }));
vi.mock("./lib/data.js", () => ({ useData: (path) => ({ data: docs.current[path] ?? null, error: null }) }));
import Home, { CARDS } from "./pages/Home.jsx";
import { BANNED } from "./lib/questions.js";

afterEach(cleanup);
const show = () => render(
  <MemoryRouter initialEntries={["/home"]}>
    <Routes><Route path="/home" element={<Home />} /><Route path="*" element={<p>landed</p>} /></Routes>
  </MemoryRouter>,
);

describe("card home", () => {
  it("offers one card per part of Cowboy, each opening its page", () => {
    docs.current = { "questions/index.json": { coins: [{ und: "BTC", smart: 3 }, { und: "ETH", smart: 1 }] },
      "markets.json": { breadth_1d: { cols: ["MARKUP", "BLOWOFF", "REACC", "ACCUM", "CAP", "MARKDOWN", "FLAT"], rows: [[1, 5, 0, 1, 0, 0, 1, 0], [2, 7, 0, 1, 0, 0, 0, 0]] } },
      "radar.json": { coins: { BTC: { z: [0.5, 1.2] }, HYPE: { z: [-1.6, null] } } },
      "flow.json": { generated_at: 1791361898, large: [{ ts: 1791354522193, kind: "option", instrument: "ETH-20261030-3100-C", direction: "buy", notional_usd: 209310 }],
        by_coin: { ETH: { call: { buy_notional_usd: 300 }, put: { buy_notional_usd: 100 } } } },
      "traders.json": { traders: [{ address: "0x" + "a".repeat(40), rank: 1, option_pnl: 10051791 }, { address: "0x" + "b".repeat(40), rank: 2, option_pnl: 3380000 }],
        cohorts: { pnl: [{ name: "Money Printer", wallets: 3, coins: { BTC: { state: "up", gross_delta_usd: 9 }, SOL: { state: "defensive", gross_delta_usd: 2 } } }] } } };
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Where do you want to ride?");
    const links = CARDS.map((c) => screen.getByRole("link", { name: new RegExp(c.label) }).getAttribute("href"));
    expect(links).toEqual(["/saloon", "/saloon/mine", "/radar", "/traders", "/markets", "/traders/posses", "/options"]);
    expect(screen.getByText("2 coins open · 4 gold rings")).toBeTruthy();
    // The live cards: real figures from the published files.
    expect(document.querySelector(".hl-markets .hl-big b").textContent).toBe("7 of 8");
    expect(document.querySelector(".hl-radar .hl-big b").textContent).toBe("HYPE"); // largest stretch either way
    expect(document.querySelectorAll(".hl-radar rect")).toHaveLength(2);
    expect(document.querySelectorAll(".hl-traders li")).toHaveLength(2);
    expect(document.querySelector(".hl-traders li.first b").textContent).toBe("+$10.05M");
    expect(document.querySelector(".hl-posses .hl-big").textContent).toBe("3Legends, and how they lean");
    expect([...document.querySelectorAll(".hl-leans li")].map((l) => [l.className, l.textContent])).toEqual([["up", "Long"], ["defensive", "Short"]]);
    expect(document.querySelector(".hl-options .hl-big b").textContent).toBe("$209.3K");
    expect(document.querySelector(".hl-split-k").textContent).toBe("75% calls bought25% puts bought");
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it("opens a card large with the +, and a click on the card itself goes to its page", () => {
    docs.current = {};
    show();
    fireEvent.click(screen.getByRole("button", { name: "More about Radar" }));
    const pop = document.querySelector("dialog.home-pop");
    expect(pop.hasAttribute("open")).toBe(true);
    expect(within(pop).getByRole("link", { name: "Open the radar" }).getAttribute("href")).toBe("/radar");
    fireEvent.click(within(pop).getByRole("button", { name: "Close" }));
    expect(pop.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getAllByRole("article")[4]);
    expect(screen.getByText("landed")).toBeTruthy();
  });
});
