import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: false, TESTNET_FILLS: false }));
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";

// The landing explains the product without exposing current readings or implying future returns.
const BANNED = /\b(will|expect\w*|likely|predict\w*|target\w*|probabilit\w*|odds|forecast\w*|reflex|larsson|torq|edge|alpha|proven)\b/i;

let fetchSpy;
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fetchSpy = vi.fn(() => Promise.reject(new Error("the landing reads no data")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Location() {
  const { pathname, hash } = useLocation();
  return <output data-testid="location">{pathname}{hash}</output>;
}
function show() {
  return render(<MemoryRouter><Location /><Routes><Route element={<Shell />}><Route index element={<Landing />} /></Route></Routes></MemoryRouter>);
}

// Visit each panel and its explanations so a hidden tab cannot bypass the public-copy boundary.
function allPublicText() {
  document.querySelectorAll("details").forEach((d) => { d.open = true; });
  const collected = [];
  const capture = () => collected.push(document.body.textContent,
    ...[...document.querySelectorAll("[aria-label], [aria-valuetext]")].map((el) => `${el.getAttribute("aria-label") || ""} ${el.getAttribute("aria-valuetext") || ""}`));
  for (const tab of screen.getAllByRole("tab")) {
    fireEvent.click(tab);
    capture();
    for (const button of screen.getAllByRole("button").filter((el) => el.classList.contains("info"))) {
      fireEvent.click(button);
      capture();
      fireEvent.click(button);
    }
  }
  return collected.join("\n");
}

describe("landing with the Saloon disabled", () => {
  it("keeps its public copy factual across every panel, explanation and FAQ", () => {
    const { container } = show();
    const text = allPublicText();
    expect(text.match(BANNED)).toBeNull();
    expect(text).not.toMatch(/proprietary/i);
    expect(screen.getByRole("heading", { level: 1 }).textContent.replace(/\s+/g, " ")).toMatch(/Know where\s*the herd stands\./);
    expect(text).toContain("Independent readings. Never one blended score.");
    expect(text).toContain("The study of whether these wallets lead price is still underway.");
    expect(container.querySelector(".foot").textContent).toContain("Market data and positioning for research. Not investment advice.");
    expect(container.querySelector(".foot").textContent).toContain("Cowboy is independent and built on Derive");
  });

  it("preserves the owner's accessible neon sign and home identity", () => {
    show();
    const sign = screen.getByRole("img", { name: "Cowboy" });
    expect(sign.classList.contains("neon-sign")).toBe(true);
    expect(sign.querySelector("svg.neon-glass")).not.toBeNull();
    expect(sign.querySelector("svg.neon-lit")).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Cowboy home" }).every((link) => link.getAttribute("href") === "/")).toBe(true);
  });

  it("reveals no prices, market readings or current results and never fetches data", () => {
    show();
    const text = allPublicText();
    expect(text).not.toMatch(/\$\s?\d|\d\s?%|\bper ?cent\b/i);
    expect(text).not.toMatch(/\b(ETH|SOL|HYPE|XRP|ADA|ZEC|XAUT|LIT|PUMP|VVV|AAVE|SNX|CC|BNB|DOGE|LINK|Bitcoin|Ethereum|Solana)\b/);
    // BTC is allowed only as the engine's named market-wide check, never as a featured asset.
    expect(screen.queryByRole("link", { name: /BTC|Bitcoin/ })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("labels each research example as an illustration and keeps layers in their declared order", () => {
    show();
    const tabs = within(screen.getByRole("tablist", { name: "Research layers" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.querySelector(".lp-tab-name").textContent)).toEqual(["Regime", "Wallets", "Options"]);
    for (const tab of tabs) {
      fireEvent.click(tab);
      const panel = screen.getByRole("tabpanel");
      expect(panel.id).toBe(tab.getAttribute("aria-controls"));
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
      const figure = panel.querySelector("figure");
      expect(figure).not.toBeNull();
      expect(within(figure).getByText("Illustration")).not.toBeNull();
      expect(within(panel).getByRole("button", { name: /^More about / })).not.toBeNull();
    }
  });

  it("switches research with arrow, Home and End keys, keeping focus and staying on the landing", async () => {
    const user = userEvent.setup();
    show();
    const tabs = screen.getAllByRole("tab");
    const selected = (index) => {
      expect(document.activeElement).toBe(tabs[index]);
      expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(tabs.map((_, i) => String(i === index)));
      expect(tabs.map((tab) => tab.tabIndex)).toEqual(tabs.map((_, i) => i === index ? 0 : -1));
      expect(screen.getByRole("tabpanel").id).toBe(tabs[index].getAttribute("aria-controls"));
      expect(screen.getByTestId("location").textContent).toBe("/");
    };
    tabs[0].focus();
    selected(0);
    await user.keyboard("{ArrowRight}"); selected(1);
    await user.keyboard("{End}"); selected(2);
    await user.keyboard("{ArrowRight}"); selected(0);
    await user.keyboard("{ArrowLeft}"); selected(2);
    await user.keyboard("{Home}"); selected(0);
  });

  it("leads to Markets and anchors the explanation to research while Saloon is disabled", () => {
    const { container } = show();
    expect(screen.getAllByRole("link", { name: "Open the markets" }).every((link) => link.getAttribute("href") === "/markets")).toBe(true);
    expect(screen.queryByRole("link", { name: "Enter the Saloon" })).toBeNull();
    expect(screen.queryByRole("region", { name: "See what it pays" })).toBeNull();
    const how = screen.getByRole("link", { name: /See how it works/ });
    expect(how.getAttribute("href")).toBe("#how");
    expect(container.querySelector("#how [role=tablist]")).not.toBeNull();
    expect(container.querySelector("#research")).toBeNull();
    expect([...container.querySelectorAll(".cowboy-landing a")].every((a) => /^\/(markets|traders|options)$|^#how$/.test(a.getAttribute("href")))).toBe(true);
  });
});
