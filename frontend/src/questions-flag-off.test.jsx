import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import { SaloonCta } from "./pages/Coin.jsx";
import { QUESTIONS_ON } from "./lib/flags.js";

// With the switch off (the default build) everything stays as before the Saloon existed.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const shell = (page = <p>home</p>) => render(
  <MemoryRouter><Routes><Route element={<Shell />}><Route index element={page} /></Route></Routes></MemoryRouter>);

it("keeps the Saloon out of the nav unless the build switches them on", () => {
  expect(QUESTIONS_ON).toBe(false);
  vi.stubGlobal("scrollTo", () => {});
  const { container } = shell();
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Markets", "Radar", "Options", "Traders", "Flow"]);
  expect(screen.queryByRole("link", { name: "Saloon" })).toBeNull();
  expect(container.querySelector(".nav-divider, .nav-research, .nav-primary")).toBeNull();
});

it("keeps the landing's primary button on the markets and no Saloon link on coin pages", () => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  shell(<Landing />);
  const open = screen.getAllByRole("link", { name: "Open the markets" });
  expect(open.map((a) => a.getAttribute("href"))).toEqual(["/markets", "/markets"]);
  expect(screen.queryByText("Enter the Saloon")).toBeNull();
  cleanup();
  const { container } = render(<MemoryRouter><SaloonCta und="BTC" live /></MemoryRouter>);
  expect(container.innerHTML).toBe("");
});
