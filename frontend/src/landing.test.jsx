import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";

// The landing shows what Torq does, never what it currently reads, and never what comes next.
const BANNED = /\b(will|expect\w*|likely|predict\w*|target\w*|probabilit\w*|odds|forecast\w*|reflex|larsson|edge|alpha|proven)\b/i;

let fetchSpy;
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fetchSpy = vi.fn(() => Promise.reject(new Error("the landing reads no data")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// The landing inside the app shell, so the header and footer are read too.
function show() {
  return render(<MemoryRouter><Routes><Route element={<Shell />}><Route index element={<Landing />} /></Route></Routes></MemoryRouter>);
}
const landing = (container) => container.querySelector(".torq-landing");

// Every word a visitor can reach: the page, every opened question, every (i) and every accessible name.
function allText(container) {
  container.querySelectorAll("details").forEach((d) => { d.open = true; });
  container.querySelectorAll("button.info").forEach((b) => fireEvent.click(b));
  const labels = [...document.body.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label"));
  return [document.body.textContent, ...labels].join("\n");
}

describe("landing", () => {
  it("has no forecast, edge or provenance words anywhere, including the (i) and the questions", () => {
    const { container } = show();
    expect(container.querySelectorAll("button.info").length).toBe(3);
    expect(container.querySelectorAll("details").length).toBe(4);
    const text = allText(container);
    expect(document.querySelectorAll(".pop").length).toBe(3);
    expect(text).toContain("Our own engine names the regime.");
    expect(container.querySelector(".foot").textContent).toContain("Market data and positioning for research. Not investment advice.");
    expect(text.match(BANNED)).toBeNull();
    expect(text).not.toMatch(/proprietary/i);
  });

  it("shows no money amounts or percentages and reads no data", () => {
    const { container } = show();
    const text = allText(container);
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\bper ?cent\b/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stamps every figure as an illustration, with a full Regime figure", () => {
    const figures = landing(show().container).querySelectorAll("figure.lp-figure");
    expect(figures.length).toBe(4);
    figures.forEach((f) => expect(f.querySelector(".lp-illus")?.textContent).toBe("Illustration"));
    const regime = document.querySelector(".lp-fig-regime");
    expect(regime.querySelector("svg.lp-phase path.ph-price")).not.toBeNull();
    expect(regime.querySelector("line.ph-trend")).not.toBeNull();
    expect(regime.querySelectorAll(".lp-checks li").length).toBe(9);
    const options = document.querySelector(".lp-fig-options");
    for (const cls of [".op-hi", ".op-lo", ".op-call", ".op-put", ".op-pain"]) expect(options.querySelector(cls)).not.toBeNull();
  });

  it("names no coin and links only into the app", () => {
    const page = landing(show().container);
    const text = page.textContent;
    // BTC appears only as a market-wide input of the engine (the BTC check, BTC dominance), never as a reading.
    expect(text).not.toMatch(/\b(ETH|SOL|HYPE|XRP|ADA|ZEC|XAUT|LIT|PUMP|VVV|AAVE|SNX|CC|BNB|DOGE|LINK|Bitcoin|Ethereum|Solana)\b/);
    expect(text.replace(/\bBTC dominance\b|, BTC, /g, "")).not.toMatch(/\bBTC\b/);
    const hrefs = [...page.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(new Set(hrefs)).toEqual(new Set(["/markets", "/traders"]));
  });
});
