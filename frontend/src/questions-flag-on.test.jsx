import React from "react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true }));
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import { SaloonCta } from "./pages/Coin.jsx";

let fetchSpy;
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fetchSpy = vi.fn(() => Promise.reject(new Error("the landing reads no data")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const shell = (page = <p>home</p>) => render(
  <MemoryRouter><Routes><Route element={<Shell />}><Route index element={page} /></Route></Routes></MemoryRouter>);

const shellAt = (path) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route element={<Shell />}><Route path="*" element={<p>page</p>} /></Route></Routes></MemoryRouter>);

it("puts outcomes, follows and positions before the research menu", () => {
  shellAt("/markets");
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  const links = [...nav.querySelectorAll("a")];
  expect(links.map((a) => a.textContent)).toEqual(["SaloonPrice outcomes", "Following", "Positions"]);
  expect(links[0].getAttribute("href")).toBe("/saloon");
  expect(links[0].classList.contains("nav-primary")).toBe(true);
  expect(links[1].getAttribute("href")).toBe("/saloon/following");
  expect(links[2].getAttribute("href")).toBe("/saloon/mine");
  expect(within(nav).getByRole("button", { name: "Research" }).getAttribute("aria-expanded")).toBe("false");
});

it("opens Research as a menu; Escape closes it and returns focus", async () => {
  const user = userEvent.setup();
  shellAt("/markets");
  const btn = screen.getByRole("button", { name: "Research" });
  expect(btn.getAttribute("aria-expanded")).toBe("false");
  await user.click(btn);
  expect(btn.getAttribute("aria-expanded")).toBe("true");
  const menu = screen.getByRole("group", { name: "Research pages" });
  expect([...menu.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Markets", "Radar", "Options", "Traders", "Flow"]);
  expect(menu.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("group", { name: "Research pages" })).toBeNull();
  expect(document.activeElement).toBe(btn);
  await user.click(btn);
  await user.click(screen.getByRole("link", { name: "Markets", exact: true }));
  expect(screen.queryByRole("group", { name: "Research pages" })).toBeNull();
  expect(document.activeElement).toBe(btn);
});

it("marks the active destination: Saloon, Following, Positions, or Research", () => {
  vi.stubGlobal("scrollTo", () => {});
  const active = () => [...document.querySelectorAll(".hdr .active")].map((a) => a.textContent);
  shellAt("/saloon/BTC");
  expect(active()).toEqual(["SaloonPrice outcomes"]);
  cleanup();
  shellAt("/q/BTC-20261009-A-83000-89000");
  expect(active()).toEqual(["SaloonPrice outcomes"]);
  cleanup();
  shellAt("/saloon/mine");
  expect(active()).toEqual(["Positions"]);
  expect(screen.getByRole("link", { name: "Positions" }).getAttribute("aria-current")).toBe("page");
  cleanup();
  shellAt("/saloon/following");
  expect(active()).toEqual(["Following"]);
  expect(screen.getByRole("link", { name: "Following" }).getAttribute("aria-current")).toBe("page");
  for (const path of ["/markets", "/radar", "/options", "/traders", "/flow", "/coin/BTC", "/trader/0xabc"]) {
    cleanup();
    shellAt(path);
    expect(screen.getByRole("button", { name: "Research" }).classList.contains("active"), path).toBe(true);
    expect(document.querySelector(".nav-primary.active, .nav-positions.active")).toBeNull();
  }
});

it("uses the compact landing navigation and opens its Research menu", async () => {
  const user = userEvent.setup();
  const { container } = shell(<Landing />);
  expect(container.querySelector("header").classList.contains("hdr-landing")).toBe(true);
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  const research = within(nav).getByRole("button", { name: "Research" });
  expect(research.getAttribute("aria-expanded")).toBe("false");
  expect(within(nav).queryByRole("group", { name: "Research pages" })).toBeNull();
  await user.click(research);
  const menu = within(nav).getByRole("group", { name: "Research pages" });
  expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/markets", "/radar", "/options", "/traders", "/flow"]);
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(research);
  expect(within(nav).queryByRole("group", { name: "Research pages" })).toBeNull();
});

it("sends the landing into Saloon and anchors how-it-works to the non-executing payout demo", () => {
  const { container } = shell(<Landing />);
  expect(screen.getAllByRole("link", { name: "Enter the Saloon" }).map((a) => a.getAttribute("href"))).toEqual(["/saloon", "/saloon"]);
  expect(screen.getByRole("link", { name: /See how it works/ }).getAttribute("href")).toBe("#how");
  expect(screen.queryByRole("link", { name: "Open the markets" })).toBeNull();
  const intro = screen.getByRole("region", { name: /Pick higher or lower\.\s*Know your cost first\./ });
  expect(intro.id).toBe("how");
  const demo = within(intro).getByRole("region", { name: "See what it pays" });
  expect(within(demo).getByText("Illustration")).not.toBeNull();
  expect(within(demo).getByRole("slider").disabled).toBe(true);
  expect(within(demo).getAllByRole("button", { name: /^(Higher|Lower)$/ }).every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
  expect(within(demo).queryByRole("link")).toBeNull();
  expect(container.querySelector("#research [role=tablist]")).not.toBeNull();
});

it("keeps every reachable landing illustration free of quotes, results and forecast language", () => {
  shell(<Landing />);
  document.querySelectorAll("details").forEach((detail) => { detail.open = true; });
  const copy = [];
  const read = () => copy.push(document.body.textContent,
    ...[...document.querySelectorAll("[aria-label], [aria-valuetext]")].map((el) => `${el.getAttribute("aria-label") || ""} ${el.getAttribute("aria-valuetext") || ""}`));
  for (const tab of screen.getAllByRole("tab")) {
    fireEvent.click(tab);
    read();
    for (const info of screen.getAllByRole("button").filter((button) => button.classList.contains("info"))) {
      fireEvent.click(info); read(); fireEvent.click(info);
    }
  }
  const demo = screen.getByRole("region", { name: "See what it pays" });
  const slider = within(demo).getByRole("slider");
  for (const direction of ["Higher", "Lower"]) {
    fireEvent.click(within(demo).getByRole("button", { name: direction }));
    for (const value of [0, 40, 50, 60, 100]) {
      fireEvent.change(slider, { target: { value: String(value) } });
      read();
    }
  }
  const text = copy.join("\n");
  expect(text).not.toMatch(/\$\s?\d|\d\s?%|\bper ?cent\b/i);
  expect(text).not.toMatch(/\b(will|expect\w*|likely|predict\w*|target\w*|probabilit\w*|odds|forecast\w*|reflex|larsson|torq|edge|alpha|proven)\b/i);
  expect(text).not.toMatch(/\b(ETH|SOL|HYPE|XRP|ADA|ZEC|XAUT|Bitcoin|Ethereum|Solana)\b/);
  expect(text).toContain("Both orders need to fill for its defined cost to apply.");
  expect(text).toContain("A payout below your cost is a loss.");
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("shows the coin page's Saloon link only for a coin with live questions", () => {
  render(<MemoryRouter><SaloonCta und="BTC" live /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /BTC in the Saloon/ }).getAttribute("href")).toBe("/saloon/BTC");
  cleanup();
  const { container } = render(<MemoryRouter><SaloonCta und="ADA" live={false} /></MemoryRouter>);
  expect(container.innerHTML).toBe("");
});
