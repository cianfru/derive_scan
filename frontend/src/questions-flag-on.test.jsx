import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true }));
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import { SaloonCta } from "./pages/Coin.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const shell = (page = <p>home</p>) => render(
  <MemoryRouter><Routes><Route element={<Shell />}><Route index element={page} /></Route></Routes></MemoryRouter>);

const shellAt = (path) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route element={<Shell />}><Route path="*" element={<p>page</p>} /></Route></Routes></MemoryRouter>);

it("leads the nav with Saloon, then Positions, then the research pages as a group", () => {
  vi.stubGlobal("scrollTo", () => {});
  shell();
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  const links = [...nav.querySelectorAll("a")];
  expect(links.map((a) => a.textContent)).toEqual(["SaloonPrice outcomes", "Positions", "Markets", "Radar", "Options", "Traders", "Flow"]);
  expect(links[0].getAttribute("href")).toBe("/saloon");
  expect(links[0].classList.contains("nav-primary")).toBe(true);
  expect(links[1].getAttribute("href")).toBe("/saloon/mine");
  const research = within(nav).getByRole("group", { name: "Research" });
  expect([...research.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Markets", "Radar", "Options", "Traders", "Flow"]);
});

it("opens Research as a menu on phones; Escape closes it and returns focus", async () => {
  vi.stubGlobal("scrollTo", () => {});
  const user = userEvent.setup();
  shell();
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
});

it("marks the active destination: Saloon, Positions, or Research for its pages", () => {
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
  for (const path of ["/markets", "/radar", "/options", "/traders", "/flow", "/coin/BTC", "/trader/0xabc"]) {
    cleanup();
    shellAt(path);
    expect(screen.getByRole("button", { name: "Research" }).classList.contains("active"), path).toBe(true);
    expect(document.querySelector(".nav-primary.active, .nav-positions.active")).toBeNull();
  }
});

it("sends the landing's primary button into the Saloon", () => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  shell(<Landing />);
  expect(screen.getAllByRole("link", { name: "Enter the Saloon" }).map((a) => a.getAttribute("href"))).toEqual(["/saloon", "/saloon"]);
  expect(screen.getByRole("link", { name: "See how it works" }).getAttribute("href")).toBe("#how");
  expect(screen.queryByRole("link", { name: "Open the markets" })).toBeNull();
  // The page explains the Saloon it leads into, in plain words and with no prices.
  const intro = screen.getByRole("region", { name: "Pick higher or lower. Know your cost first." });
  expect(intro.textContent).not.toMatch(/\$\d|%|\b(will|expect\w*|likely|predict\w*|probab\w*|odds|chance\w*)\b/i);
});

it("shows the coin page's Saloon link only for a coin with live questions", () => {
  render(<MemoryRouter><SaloonCta und="BTC" live /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /BTC in the Saloon/ }).getAttribute("href")).toBe("/saloon/BTC");
  cleanup();
  const { container } = render(<MemoryRouter><SaloonCta und="ADA" live={false} /></MemoryRouter>);
  expect(container.innerHTML).toBe("");
});
