import React from "react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";

const flags = vi.hoisted(() => ({ FUND_ANYCHAIN: false, RYSK_MOCK: false, QUESTIONS_ON: true, TESTNET_FILLS: false, MAINNET_FILLS: false, ONE_TAP_FILLS: false, TRADE_ON: false }));
vi.mock("./lib/flags.js", () => flags);
vi.mock("./lib/pilot.js", async (importOriginal) => ({ ...await importOriginal(), oneTapOffered: vi.fn(() => false) }));
import Shell from "./components/Shell.jsx";
import Landing from "./pages/Landing.jsx";
import { SaloonCta } from "./pages/Coin.jsx";
import { oneTapOffered } from "./lib/pilot.js";

let fetchSpy;
beforeEach(() => {
  Object.assign(flags, { FUND_ANYCHAIN: false, RYSK_MOCK: false, QUESTIONS_ON: true, TESTNET_FILLS: false, MAINNET_FILLS: false, ONE_TAP_FILLS: false, TRADE_ON: false });
  vi.mocked(oneTapOffered).mockReturnValue(false);
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

it("leads with the Saloon, then the Markets and Traders menus; My space sits beside the tools", async () => {
  shellAt("/saloon");
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  const links = [...nav.querySelectorAll("a")];
  expect(links.map((a) => a.textContent)).toEqual(["SaloonPrice outcomes"]);
  expect(links[0].getAttribute("href")).toBe("/saloon");
  expect(links[0].classList.contains("nav-primary")).toBe(true);
  expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Markets", "Traders"]);
  for (const b of within(nav).getAllByRole("button")) expect(b.getAttribute("aria-expanded")).toBe("false");
  expect(within(nav).queryByRole("button", { name: "Research" })).toBeNull();
  expect(within(nav).queryByRole("link", { name: /Positions|Following/ })).toBeNull();
  // My space: shown to every visitor, outside the main navigation, beside the theme switch.
  const space = screen.getByRole("button", { name: "My space" });
  expect(nav.contains(space)).toBe(false);
  expect(space.closest(".tools")).toBeTruthy();
});

it("keeps the wallet out of the header without testnet fills", () => {
  const { container } = shellAt("/saloon");
  expect(screen.queryByRole("button", { name: /Connect wallet|^Wallet 0x/ })).toBeNull();
  expect(container.querySelector(".hw, .hdr-wallet, style")).toBeNull();
});

it("opens Markets and Traders as disclosure menus: arrows move, Escape closes and returns focus", async () => {
  const user = userEvent.setup();
  shellAt("/radar");
  const btn = screen.getByRole("button", { name: "Markets" });
  await user.click(btn);
  expect(btn.getAttribute("aria-expanded")).toBe("true");
  const menu = screen.getByRole("group", { name: "Markets pages" });
  expect(btn.getAttribute("aria-controls")).toBe(menu.id);
  expect(within(menu).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual(
    [["Board", "/markets"], ["Radar", "/radar"], ["Options", "/options"], ["Flow", "/flow"]]);
  expect(within(menu).getByRole("link", { name: "Radar" }).getAttribute("aria-current")).toBe("page");
  expect(document.activeElement.textContent).toBe("Board");
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement.textContent).toBe("Radar");
  await user.keyboard("{ArrowUp}{ArrowUp}");
  expect(document.activeElement.textContent).toBe("Flow");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("group", { name: "Markets pages" })).toBeNull();
  expect(document.activeElement).toBe(btn);
  // Keyboard alone opens the other menu; opening one closes the first.
  const traders = screen.getByRole("button", { name: "Traders" });
  await user.click(btn);
  traders.focus();
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("group", { name: "Markets pages" })).toBeNull();
  const tm = screen.getByRole("group", { name: "Traders pages" });
  expect(within(tm).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual(
    [["Leaderboard", "/traders"], ["Posses", "/traders/posses"]]);
  await user.click(within(tm).getByRole("link", { name: "Posses" }));
  expect(screen.queryByRole("group", { name: "Traders pages" })).toBeNull();
  expect(document.activeElement).toBe(traders);
});

it("marks the active section: Saloon, Markets, Traders or My space, underlined, one at a time", () => {
  const active = () => [...document.querySelectorAll(".hdr .active")].map((a) => a.textContent);
  shellAt("/saloon/BTC");
  expect(active()).toEqual(["SaloonPrice outcomes"]);
  cleanup();
  shellAt("/q/BTC-20261009-A-83000-89000");
  expect(active()).toEqual(["SaloonPrice outcomes"]);
  for (const path of ["/saloon/mine", "/saloon/mine?tab=following"]) {
    cleanup();
    shellAt(path);
    expect(active(), path).toEqual(["My space"]);
  }
  for (const path of ["/markets", "/radar", "/options", "/flow", "/coin/BTC"]) {
    cleanup();
    shellAt(path);
    expect(active(), path).toEqual(["Markets"]);
  }
  for (const path of ["/traders", "/traders/posses", "/trader/0xabc"]) {
    cleanup();
    shellAt(path);
    expect(active(), path).toEqual(["Traders"]);
  }
});

it("opens My space with Positions and Following, their counts once there are any", async () => {
  const user = userEvent.setup();
  shellAt("/saloon/mine?tab=following");
  await user.click(screen.getByRole("button", { name: "My space" }));
  const menu = screen.getByRole("group", { name: "My space pages" });
  expect(within(menu).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual(
    [["Positions", "/saloon/mine"], ["Following", "/saloon/mine?tab=following"]]);
  expect(within(menu).getByRole("link", { name: "Following" }).getAttribute("aria-current")).toBe("page");
  expect(within(menu).getByRole("link", { name: "Positions" }).getAttribute("aria-current")).toBeNull();
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "My space" }));
});

it("uses the compact landing navigation with the same menus", async () => {
  const user = userEvent.setup();
  const { container } = shell(<Landing />);
  expect(container.querySelector("header").classList.contains("hdr-landing")).toBe(true);
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  const markets = within(nav).getByRole("button", { name: "Markets" });
  await user.click(markets);
  const menu = within(nav).getByRole("group", { name: "Markets pages" });
  expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/markets", "/radar", "/options", "/flow"]);
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(markets);
  expect(screen.getByRole("button", { name: "My space" })).toBeTruthy();
});

it("sends the landing into Saloon and anchors how-it-works to the non-executing payout demo", () => {
  const { container } = shell(<Landing />);
  expect(screen.getAllByRole("link", { name: "Enter the Saloon" }).map((a) => a.getAttribute("href"))).toEqual(["/saloon", "/saloon"]);
  expect(screen.getByRole("link", { name: /See how it works/ }).getAttribute("href")).toBe("#how");
  expect(screen.queryByRole("link", { name: "Open the markets" })).toBeNull();
  const intro = screen.getByRole("region", { name: /Find your level\.\s*Pick your side\./ });
  expect(intro.id).toBe("how");
  const demo = within(intro).getByRole("region", { name: "Explore an outcome" });
  expect(within(demo).getByText("Illustration")).not.toBeNull();
  // A selected bubble explains its answer immediately; settlement detail stays one tap away.
  expect(within(demo).getAllByRole("button", { name: /^BTC (Higher|Lower),/ })).toHaveLength(6);
  fireEvent.click(within(demo).getByText("Try a settlement price"));
  expect(within(demo).getByRole("slider").disabled).toBe(false);
  expect(within(demo).getAllByRole("button", { name: /^(Higher|Lower)$/ }).map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  expect(within(demo).getByRole("status").textContent).toMatch(/If BTC settles at \$87,000: you get \$147\.70/);
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
  // Outside the worked example the landing shows no prices at all; the example's made-up dollar
  // figures live only inside its region, stamped Illustration.
  const demo = screen.getByRole("region", { name: "Explore an outcome" });
  const outside = document.body.cloneNode(true);
  outside.querySelector(".saloon-demo").remove();
  expect(outside.textContent).not.toMatch(/\$\s?\d|\d\s?%|\bper ?cent\b/i);
  expect(within(demo).getByText("Illustration")).not.toBeNull();
  const slider = within(demo).getByRole("slider");
  for (const direction of ["Higher", "Lower"]) {
    fireEvent.click(within(demo).getByRole("button", { name: direction }));
    for (const value of [79000, 82000, 85000, 87000, 91000]) {
      fireEvent.change(slider, { target: { value: String(value) } });
      read();
    }
  }
  const text = copy.join("\n");
  // Inside the example, returns read "+148%" like the Saloon (owner, 8 October 2026); no other percentage.
  expect(text.replace(/\+\d+%/g, "")).not.toMatch(/\d\s?%|\bper ?cent\b/i);
  expect(text).not.toMatch(/\b(will|expect\w*|likely|predict\w*|target\w*|probabilit\w*|odds|forecast\w*|reflex|larsson|torq|edge|alpha|proven)\b/i);
  expect(outside.textContent).not.toMatch(/\b(ETH|SOL|HYPE|XRP|ADA|ZEC|XAUT|Bitcoin|Ethereum|Solana)\b/);
  expect(text).toContain("Both orders need to fill for its defined cost to apply.");
  expect(text).toContain("A payout below your cost is a loss.");
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("shows the coin page's Saloon link only for a coin with live questions", () => {
  render(<MemoryRouter><SaloonCta und="BTC" live /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /BTC in the Saloon/ }).getAttribute("href")).toBe("/saloon?coin=BTC");
  cleanup();
  const { container } = render(<MemoryRouter><SaloonCta und="ADA" live={false} /></MemoryRouter>);
  expect(container.innerHTML).toBe("");
});

it("carries no Testnet marker in a build without testnet fills", () => {
  shellAt("/saloon");
  expect(document.querySelector(".hdr-testnet")).toBeNull();
  expect(document.querySelector("header").textContent).not.toMatch(/Testnet/);
});

it("never tells visitors to place trades on Derive themselves; before one tap it says one tap is coming (owner, 5 October 2026)", () => {
  const { container } = shell(<Landing />);
  expect(container.textContent).not.toMatch(/place any trade on Derive yourself|placed by you on Derive|two option orders on Derive|lists the two option orders|Trade higher or lower in one tap/);
  expect(container.textContent).toMatch(/One-tap trading is coming/);
  expect(container.textContent).toMatch(/Trades settle on Derive, in your own account\./);
  expect(container.querySelector(".hero-description").textContent).toContain("Trade higher or lower on Derive, with the cost shown before you confirm.");
});

it("describes a dry run as practice without promising fills", () => {
  flags.TRADE_ON = true;
  vi.mocked(oneTapOffered).mockReturnValue(true);
  const { container } = render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(container.querySelector(".hero-description").textContent).toContain("Nothing fills.");
  expect(container.querySelector(".lp-execution-strip").textContent).toContain("This build checks quotes on Derive’s testnet. Nothing fills.");
  expect(container.querySelector(".lp-faq-list").textContent).toContain("checks a quote without placing a trade");
  expect(container.textContent).not.toMatch(/You trade in one tap|both options fill together at one price/);
});

it("labels filled testnet trading as practice with test USDC", () => {
  Object.assign(flags, { TRADE_ON: true, ONE_TAP_FILLS: true, TESTNET_FILLS: true });
  vi.mocked(oneTapOffered).mockReturnValue(true);
  const { container } = render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(container.querySelector(".hero-description").textContent).toContain("Practice higher or lower in one tap with test USDC");
  expect(container.querySelector(".lp-faq-list").textContent).toContain("This build uses test USDC on Derive’s testnet.");
  expect(container.querySelector(".lp-execution-strip").textContent).toContain("Both options fill together, or nothing fills.");
});

it("promises one-tap fills only to a mainnet pilot browser", () => {
  Object.assign(flags, { TRADE_ON: true, ONE_TAP_FILLS: true, MAINNET_FILLS: true });
  const { container, rerender } = render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(container.querySelector(".hero-description").textContent).toContain("Trade higher or lower on Derive, with the cost shown before you confirm.");
  expect(container.querySelector(".lp-faq-list").textContent).not.toContain("You trade in one tap");
  vi.mocked(oneTapOffered).mockReturnValue(true);
  rerender(<MemoryRouter><Landing /></MemoryRouter>);
  expect(container.querySelector(".hero-description").textContent).toContain("Trade higher or lower in one tap");
  expect(container.querySelector(".lp-faq-list").textContent).toContain("You trade in one tap from Cowboy");
  expect(container.textContent).not.toMatch(/testnet|test USDC|Nothing fills\./);
});
