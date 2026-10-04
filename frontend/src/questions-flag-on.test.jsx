import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("./lib/flags.js", () => ({ QUESTIONS_ON: true }));
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import { SaloonCta } from "./pages/Coin.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const shell = (page = <p>home</p>) => render(
  <MemoryRouter><Routes><Route element={<Shell />}><Route index element={page} /></Route></Routes></MemoryRouter>);

it("leads the nav with the Saloon and groups the research pages after it", () => {
  vi.stubGlobal("scrollTo", () => {});
  shell();
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  const links = [...nav.querySelectorAll("a")];
  expect(links.map((a) => a.textContent)).toEqual(["Saloon", "Markets", "Radar", "Options", "Traders", "Flow"]);
  expect(links[0].getAttribute("href")).toBe("/saloon");
  expect(links[0].classList.contains("nav-primary")).toBe(true);
  const research = within(nav).getByRole("group", { name: "Research" });
  expect([...research.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Markets", "Radar", "Options", "Traders", "Flow"]);
});

it("sends the landing's primary button into the Saloon", () => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  shell(<Landing />);
  expect(screen.getAllByRole("link", { name: "Enter the Saloon" }).map((a) => a.getAttribute("href"))).toEqual(["/saloon", "/saloon"]);
  expect(screen.getByRole("link", { name: "See how it works" }).getAttribute("href")).toBe("#how");
  expect(screen.queryByRole("link", { name: "Open the markets" })).toBeNull();
});

it("shows the coin page's Saloon link only for a coin with live questions", () => {
  render(<MemoryRouter><SaloonCta und="BTC" live /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /BTC in the Saloon/ }).getAttribute("href")).toBe("/saloon/BTC");
  cleanup();
  const { container } = render(<MemoryRouter><SaloonCta und="ADA" live={false} /></MemoryRouter>);
  expect(container.innerHTML).toBe("");
});
